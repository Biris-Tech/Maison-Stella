require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const prisma  = require('./lib/prisma');

const { FedaPay, Transaction } = require('fedapay');

const app  = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ─── VIEW ENGINE ──────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'stella-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// ─── MULTER (upload photos) ───────────────────────────────────────────────────
const imageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(__dirname, 'public/image')),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `room-${Date.now()}-${Math.random().toString(36).substr(2, 5)}${ext}`);
  }
});
const uploadImages = multer({
  storage: imageStorage,
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Images uniquement'));
  },
  limits: { fileSize: 15 * 1024 * 1024 }
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function slugify(str) {
  return str.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function requireAdmin(req, res, next) {
  if (req.session?.admin) return next();
  res.redirect('/admin/login');
}

// PayPal helpers
const PAYPAL_BASE = process.env.PAYPAL_ENV === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

async function getPayPalToken() {
  const credentials = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`
  ).toString('base64');
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  const data = await res.json();
  return data.access_token;
}

// XOF → EUR (taux fixe : 1 EUR = 655.957 XOF)
function xofToEur(xof) { return Math.ceil((xof / 655.957) * 100) / 100; }

// ─── PUBLIC ROUTES ────────────────────────────────────────────────────────────

app.get('/', async (_req, res) => {
  const [rooms, settings] = await Promise.all([
    prisma.room.findMany({ where: { active: true } }),
    prisma.setting.findUnique({ where: { id: 'main' } })
  ]);
  const featured = rooms.filter(r => r.featured).slice(0, 3);
  res.render('index', { rooms, featured, settings, page: 'home' });
});

app.get('/chambres', async (_req, res) => {
  const [rooms, settings] = await Promise.all([
    prisma.room.findMany({ where: { active: true } }),
    prisma.setting.findUnique({ where: { id: 'main' } })
  ]);
  res.render('rooms', { rooms, settings, page: 'rooms' });
});

app.get('/chambre/:id', async (req, res) => {
  const [room, settings] = await Promise.all([
    prisma.room.findFirst({ where: { id: req.params.id, active: true } }),
    prisma.setting.findUnique({ where: { id: 'main' } })
  ]);
  if (!room) return res.redirect('/chambres');
  res.render('room-detail', {
    room, settings, page: 'rooms',
    paypalClientId: process.env.PAYPAL_CLIENT_ID || ''
  });
});

// ─── PAYMENT ROUTES ───────────────────────────────────────────────────────────

// FedaPay – initialiser et rediriger
app.post('/payment/fedapay/init', async (req, res) => {
  const { room, roomId, checkin, checkout, fullname, phone, email, guests, nights, totalAmount } = req.body;
  try {
    FedaPay.setApiKey(process.env.FEDAPAY_SECRET_KEY);
    FedaPay.setEnvironment(process.env.FEDAPAY_ENV || 'sandbox');

    const nameParts = (fullname || 'Client').trim().split(' ');
    const transaction = await Transaction.create({
      description: `Réservation – ${room} · ${nights} nuit(s)`,
      amount: parseInt(totalAmount),
      currency: { iso: 'XOF' },
      callback_url: `${BASE_URL}/payment/fedapay/callback`,
      customer: {
        firstname: nameParts[0],
        lastname: nameParts.slice(1).join(' ') || nameParts[0],
        email: email || undefined,
        phone_number: phone ? { number: phone.replace(/\s/g, ''), country: 'TG' } : undefined
      }
    });

    // Stocker la réservation en session pour la créer après paiement
    req.session.pendingBooking = {
      room, roomId, checkin, checkout, fullname, phone, email,
      guests: parseInt(guests) || 1,
      nights: parseInt(nights) || 1,
      totalAmount: parseInt(totalAmount),
      paymentMethod: 'fedapay'
    };
    req.session.fedapayTxId = transaction.id;

    const token = await transaction.generateToken();
    res.redirect(token.url);
  } catch (err) {
    console.error('FedaPay error:', err);
    res.redirect('/payment/cancel?error=fedapay');
  }
});

// FedaPay – callback après paiement
app.get('/payment/fedapay/callback', async (req, res) => {
  const { id, status } = req.query;
  try {
    FedaPay.setApiKey(process.env.FEDAPAY_SECRET_KEY);
    FedaPay.setEnvironment(process.env.FEDAPAY_ENV || 'sandbox');

    if (status === 'approved' && req.session.pendingBooking) {
      const booking = req.session.pendingBooking;
      await prisma.booking.create({
        data: {
          id: Date.now().toString(),
          ...booking,
          status: 'confirmed',
          paymentStatus: 'paid',
          paymentId: String(id)
        }
      });
      req.session.pendingBooking = null;
      req.session.fedapayTxId = null;
      return res.redirect('/payment/success?method=fedapay');
    }
    res.redirect('/payment/cancel?method=fedapay');
  } catch (err) {
    console.error('FedaPay callback error:', err);
    res.redirect('/payment/cancel?error=1');
  }
});

// PayPal – créer un ordre
app.post('/payment/paypal/create-order', async (req, res) => {
  try {
    const { amountEur } = req.body;
    const token = await getPayPalToken();
    const response = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: { currency_code: 'EUR', value: String(amountEur) },
          description: 'Maison Stella – Réservation chambre'
        }]
      })
    });
    const order = await response.json();
    res.json({ id: order.id });
  } catch (err) {
    console.error('PayPal create-order error:', err);
    res.status(500).json({ error: 'Erreur PayPal' });
  }
});

// PayPal – capturer le paiement et créer la réservation
app.post('/payment/paypal/capture', async (req, res) => {
  const { orderID, room, roomId, checkin, checkout, fullname, phone, email, guests, nights, totalAmount } = req.body;
  try {
    const token = await getPayPalToken();
    const response = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${orderID}/capture`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    const capture = await response.json();

    if (capture.status === 'COMPLETED') {
      await prisma.booking.create({
        data: {
          id: Date.now().toString(),
          room, roomId, checkin, checkout, fullname, phone, email,
          guests: parseInt(guests) || 1,
          nights: parseInt(nights) || 1,
          totalAmount: parseInt(totalAmount),
          status: 'confirmed',
          paymentMethod: 'paypal',
          paymentStatus: 'paid',
          paymentId: orderID
        }
      });
      res.json({ success: true });
    } else {
      res.json({ success: false, error: 'Paiement non complété' });
    }
  } catch (err) {
    console.error('PayPal capture error:', err);
    res.status(500).json({ error: 'Erreur PayPal capture' });
  }
});

app.get('/payment/success', async (req, res) => {
  const settings = await prisma.setting.findUnique({ where: { id: 'main' } });
  res.render('payment/success', { settings, method: req.query.method || 'unknown', page: '' });
});

app.get('/payment/cancel', async (req, res) => {
  const settings = await prisma.setting.findUnique({ where: { id: 'main' } });
  res.render('payment/cancel', { settings, method: req.query.method || '', page: '' });
});

// ─── ADMIN AUTH ───────────────────────────────────────────────────────────────

app.get('/admin', requireAdmin, (_req, res) => res.redirect('/admin/dashboard'));

app.get('/admin/login', (req, res) => {
  if (req.session.admin) return res.redirect('/admin/dashboard');
  res.render('admin/login', { error: null });
});

app.post('/admin/login', async (req, res) => {
  const { password } = req.body;
  const settings = await prisma.setting.findUnique({ where: { id: 'main' } });
  if (password === (settings?.adminPlain || 'stella2026')) {
    req.session.admin = true;
    return res.redirect('/admin/dashboard');
  }
  res.render('admin/login', { error: 'Mot de passe incorrect.' });
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

// ─── ADMIN DASHBOARD ──────────────────────────────────────────────────────────

app.get('/admin/dashboard', requireAdmin, async (_req, res) => {
  const [rooms, bookings, settings] = await Promise.all([
    prisma.room.findMany(),
    prisma.booking.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.setting.findUnique({ where: { id: 'main' } })
  ]);
  const stats = {
    totalRooms: rooms.filter(r => r.active).length,
    totalBookings: bookings.length,
    pendingBookings: bookings.filter(b => b.paymentStatus === 'unpaid').length,
    confirmedBookings: bookings.filter(b => b.paymentStatus === 'paid').length
  };
  res.render('admin/dashboard', { stats, bookings: bookings.slice(0, 10), settings });
});

// ─── ADMIN CHAMBRES ───────────────────────────────────────────────────────────

app.get('/admin/chambres', requireAdmin, async (req, res) => {
  const [rooms, settings] = await Promise.all([
    prisma.room.findMany(),
    prisma.setting.findUnique({ where: { id: 'main' } })
  ]);
  res.render('admin/rooms', { rooms, settings, success: req.query.success || null, error: req.query.error || null });
});

// Modifier une chambre – page dédiée
app.get('/admin/chambres/edit/:id', requireAdmin, async (req, res) => {
  const [room, settings] = await Promise.all([
    prisma.room.findUnique({ where: { id: req.params.id } }),
    prisma.setting.findUnique({ where: { id: 'main' } })
  ]);
  if (!room) return res.redirect('/admin/chambres?error=Chambre+introuvable');
  res.render('admin/room-edit', { room, settings, success: req.query.success || null, error: req.query.error || null });
});

// Créer une chambre – formulaire
app.get('/admin/chambres/nouvelle', requireAdmin, async (_req, res) => {
  const settings = await prisma.setting.findUnique({ where: { id: 'main' } });
  res.render('admin/room-create', { settings, error: null });
});

// Créer une chambre – traitement
app.post('/admin/chambres/nouvelle', requireAdmin, uploadImages.array('images', 20), async (req, res) => {
  const { name, price, capacity, bedType, desc, badge, featured, composition, amenities } = req.body;
  try {
    let id = slugify(name);
    // Garantir l'unicité de l'ID
    const existing = await prisma.room.findUnique({ where: { id } });
    if (existing) id = `${id}-${Date.now().toString(36)}`;

    const images = (req.files || []).map(f => f.filename);

    await prisma.room.create({
      data: {
        id,
        name,
        price: parseInt(price),
        capacity: parseInt(capacity),
        bedType,
        desc,
        badge: badge || '',
        featured: featured === 'on',
        active: true,
        composition: composition ? composition.split('\n').map(s => s.trim()).filter(Boolean) : [],
        amenities: amenities ? amenities.split('\n').map(s => s.trim()).filter(Boolean) : [],
        images
      }
    });
    res.redirect('/admin/chambres?success=Chambre+créée+avec+succès');
  } catch (err) {
    console.error(err);
    const settings = await prisma.setting.findUnique({ where: { id: 'main' } });
    res.render('admin/room-create', { settings, error: 'Erreur lors de la création.' });
  }
});

// Activer / désactiver
app.post('/admin/chambres/toggle/:id', requireAdmin, async (req, res) => {
  const room = await prisma.room.findUnique({ where: { id: req.params.id } });
  if (room) await prisma.room.update({ where: { id: room.id }, data: { active: !room.active } });
  const back = req.get('Referer') || '/admin/chambres';
  res.redirect(back);
});

// Modifier les infos texte
app.post('/admin/chambres/update/:id', requireAdmin, async (req, res) => {
  const { name, price, capacity, bedType, desc, badge, featured, composition, amenities } = req.body;
  try {
    await prisma.room.update({
      where: { id: req.params.id },
      data: {
        name, bedType, desc,
        badge: badge || '',
        price: parseInt(price),
        capacity: parseInt(capacity),
        featured: featured === 'on',
        composition: composition ? composition.split('\n').map(s => s.trim()).filter(Boolean) : undefined,
        amenities: amenities ? amenities.split('\n').map(s => s.trim()).filter(Boolean) : undefined
      }
    });
    res.redirect(`/admin/chambres/edit/${req.params.id}?success=Modifications+enregistrées`);
  } catch {
    res.redirect(`/admin/chambres/edit/${req.params.id}?error=Erreur+lors+de+la+mise+à+jour`);
  }
});

// Upload de nouvelles photos
app.post('/admin/chambres/:id/images', requireAdmin, uploadImages.array('images', 20), async (req, res) => {
  const room = await prisma.room.findUnique({ where: { id: req.params.id } });
  if (!room) return res.redirect('/admin/chambres?error=Chambre+introuvable');
  const newImages = (req.files || []).map(f => f.filename);
  await prisma.room.update({
    where: { id: room.id },
    data: { images: [...room.images, ...newImages] }
  });
  res.redirect(`/admin/chambres/edit/${room.id}?success=Photos+ajoutées`);
});

// Supprimer une photo
app.post('/admin/chambres/:id/images/delete', requireAdmin, async (req, res) => {
  const { image } = req.body;
  const room = await prisma.room.findUnique({ where: { id: req.params.id } });
  if (room) {
    await prisma.room.update({
      where: { id: room.id },
      data: { images: room.images.filter(img => img !== image) }
    });
    const filePath = path.join(__dirname, 'public/image', image);
    if (fs.existsSync(filePath) && image.startsWith('room-')) fs.unlinkSync(filePath);
  }
  res.redirect(`/admin/chambres/edit/${req.params.id}?success=Photo+supprimée`);
});

// Supprimer une chambre
app.post('/admin/chambres/delete/:id', requireAdmin, async (req, res) => {
  await prisma.room.delete({ where: { id: req.params.id } });
  res.redirect('/admin/chambres?success=Chambre+supprimée');
});

// ─── ADMIN RESERVATIONS ───────────────────────────────────────────────────────

app.get('/admin/reservations', requireAdmin, async (_req, res) => {
  const [bookings, settings] = await Promise.all([
    prisma.booking.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.setting.findUnique({ where: { id: 'main' } })
  ]);
  res.render('admin/bookings', { bookings, settings });
});

app.post('/admin/reservations/status/:id', requireAdmin, async (req, res) => {
  await prisma.booking.update({ where: { id: req.params.id }, data: { status: req.body.status } });
  res.redirect('/admin/reservations');
});

app.post('/admin/reservations/delete/:id', requireAdmin, async (req, res) => {
  await prisma.booking.delete({ where: { id: req.params.id } });
  res.redirect('/admin/reservations');
});

// ─── ADMIN PARAMETRES ─────────────────────────────────────────────────────────

app.get('/admin/parametres', requireAdmin, async (req, res) => {
  const settings = await prisma.setting.findUnique({ where: { id: 'main' } });
  res.render('admin/settings', { settings, success: req.query.success || null });
});

app.post('/admin/parametres', requireAdmin, async (req, res) => {
  const { siteName, tagline, description, address, phone, email, aboutText, aboutText2, heroImage, adminPlain } = req.body;
  const data = { siteName, tagline, description, address, phone, email, aboutText, aboutText2, heroImage };
  if (adminPlain?.trim()) data.adminPlain = adminPlain.trim();
  await prisma.setting.update({ where: { id: 'main' }, data });
  res.redirect('/admin/parametres?success=1');
});

// ─── START ────────────────────────────────────────────────────────────────────
// app.listen(PORT, () => {
//   console.log(`\n✅ Maison Stella → http://localhost:${PORT}`);
//   console.log(`🔐 Admin panel  → http://localhost:${PORT}/admin`);
//   console.log(`   Mot de passe: stella2026\n`);
// });

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on ${BASE_URL}`);
});
