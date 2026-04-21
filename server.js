require("dotenv").config();
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const compression = require("compression");
const nodemailer = require("nodemailer");
const prisma = require("./lib/prisma");

// ─── EMAIL ────────────────────────────────────────────────────────────────────
const BOOKING_EMAIL = "maisonstella24@gmail.com";

function createMailTransporter() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function sendBookingNotification(booking) {
  const transporter = createMailTransporter();
  if (!transporter) return;
  const methodLabel = booking.paymentMethod === "paypal" ? "PayPal" : "FedaPay (Mobile Money)";
  const html = `
<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><style>
  body{font-family:-apple-system,sans-serif;background:#f4f4f4;margin:0;padding:0}
  .wrap{max-width:560px;margin:2rem auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.1)}
  .hdr{background:#d2553d;padding:2rem;text-align:center;color:#fff}
  .hdr h1{margin:0;font-size:1.4rem;font-weight:700}
  .hdr p{margin:.4rem 0 0;font-size:.9rem;opacity:.85}
  .body{padding:1.75rem}
  .row{display:flex;justify-content:space-between;padding:.6rem 0;border-bottom:1px solid #eee;font-size:.9rem}
  .row:last-child{border-bottom:none}
  .label{color:#767676;font-weight:500}
  .value{color:#222;font-weight:600;text-align:right;max-width:60%}
  .total{background:#fff5f3;border-radius:8px;padding:1rem;margin-top:1.25rem;display:flex;justify-content:space-between;align-items:center}
  .total .label{font-size:1rem;font-weight:600;color:#222}
  .total .price{font-size:1.3rem;font-weight:700;color:#d2553d}
  .ftr{background:#f9f9f9;padding:1.25rem 1.75rem;font-size:.8rem;color:#999;text-align:center;border-top:1px solid #eee}
</style></head><body>
<div class="wrap">
  <div class="hdr">
    <h1>Nouvelle réservation</h1>
    <p>Maison Stella · Avepozo, Lomé</p>
  </div>
  <div class="body">
    <div class="row"><span class="label">Chambre</span><span class="value">${booking.room}</span></div>
    <div class="row"><span class="label">Arrivée</span><span class="value">${booking.checkin}</span></div>
    <div class="row"><span class="label">Départ</span><span class="value">${booking.checkout}</span></div>
    <div class="row"><span class="label">Nuits</span><span class="value">${booking.nights}</span></div>
    <div class="row"><span class="label">Voyageurs</span><span class="value">${booking.guests}</span></div>
    <div class="row"><span class="label">Client</span><span class="value">${booking.fullname || "—"}</span></div>
    <div class="row"><span class="label">Téléphone</span><span class="value">${booking.phone || "—"}</span></div>
    <div class="row"><span class="label">E-mail</span><span class="value">${booking.email || "—"}</span></div>
    <div class="row"><span class="label">Paiement</span><span class="value">${methodLabel}</span></div>
    <div class="total">
      <span class="label">Total encaissé</span>
      <span class="price">${(booking.totalAmount || 0).toLocaleString("fr-FR")} FCFA</span>
    </div>
  </div>
  <div class="ftr">Réservation enregistrée automatiquement — Maison Stella Admin</div>
</div>
</body></html>`;
  try {
    await transporter.sendMail({
      from: `"Maison Stella" <${process.env.SMTP_USER}>`,
      to: BOOKING_EMAIL,
      subject: `Nouvelle réservation – ${booking.room} (${booking.checkin} → ${booking.checkout})`,
      html,
    });
  } catch (e) {
    console.error("Email send error:", e.message);
  }
}

// ─── IN-MEMORY CACHE ─────────────────────────────────────────────────────────
const _cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
function cacheGet(key) {
  const item = _cache.get(key);
  if (!item || Date.now() > item.exp) { _cache.delete(key); return null; }
  return item.val;
}
function cacheSet(key, val, ttl = CACHE_TTL) {
  _cache.set(key, { val, exp: Date.now() + ttl });
}
function cacheInvalidate(prefix) {
  for (const k of _cache.keys()) {
    if (k === prefix || k.startsWith(prefix + ":")) _cache.delete(k);
  }
}

const { FedaPay, Transaction } = require("fedapay");

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ─── VIEW ENGINE ──────────────────────────────────────────────────────────────
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(compression());

// Images : cache long (noms horodatés = immutables)
app.use("/image", express.static(path.join(__dirname, "public/image"), {
  maxAge: "30d", etag: true, lastModified: true,
}));
// CSS/JS : cache 1 jour
app.use("/css", express.static(path.join(__dirname, "public/css"), {
  maxAge: "1d", etag: true,
}));
app.use("/js", express.static(path.join(__dirname, "public/js"), {
  maxAge: "1d", etag: true,
}));
// Reste des assets statiques
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h", etag: true }));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Inject SEO locals dans toutes les vues
app.use((req, res, next) => {
  res.locals.baseUrl = BASE_URL;
  res.locals.canonical = BASE_URL + req.path;
  next();
});
app.use(
  session({
    secret: process.env.SESSION_SECRET || "stella-secret-2026",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 },
  }),
);

// ─── MULTER (upload photos) ───────────────────────────────────────────────────
const imageStorage = multer.diskStorage({
  destination: (_req, _file, cb) =>
    cb(null, path.join(__dirname, "public/image")),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(
      null,
      `room-${Date.now()}-${Math.random().toString(36).substr(2, 5)}${ext}`,
    );
  },
});
const uploadImages = multer({
  storage: imageStorage,
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Images uniquement"));
  },
  limits: { fileSize: 15 * 1024 * 1024 },
});

// ─── IMAGE COMPRESSION ────────────────────────────────────────────────────────
async function compressImage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  try {
    let pipeline = sharp(filePath)
      .rotate()
      .resize(2000, 2000, { fit: "inside", withoutEnlargement: true });
    if (ext === ".jpg" || ext === ".jpeg") {
      pipeline = pipeline.jpeg({ quality: 85, mozjpeg: true });
    } else if (ext === ".png") {
      pipeline = pipeline.png({ compressionLevel: 9 });
    } else if (ext === ".webp") {
      pipeline = pipeline.webp({ quality: 85 });
    } else {
      pipeline = pipeline.jpeg({ quality: 85 });
    }
    const buf = await pipeline.toBuffer();
    await fs.promises.writeFile(filePath, buf);
  } catch (e) {
    console.error("Compression error:", e.message);
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function slugify(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function requireAdmin(req, res, next) {
  if (req.session?.admin) return next();
  res.redirect("/admin/login");
}

async function injectUnreadCount(_req, res, next) {
  try {
    res.locals.unreadCount = await prisma.contactMessage.count({ where: { read: false } });
  } catch { res.locals.unreadCount = 0; }
  next();
}
app.use("/admin", injectUnreadCount);

// PayPal helpers
const PAYPAL_BASE =
  process.env.PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

async function getPayPalToken() {
  const credentials = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`,
  ).toString("base64");
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await res.json();
  return data.access_token;
}

// XOF → EUR (taux fixe : 1 EUR = 655.957 XOF)
function xofToEur(xof) {
  return Math.ceil((xof / 655.957) * 100) / 100;
}

// ─── PUBLIC ROUTES ────────────────────────────────────────────────────────────

app.get("/robots.txt", (_req, res) => {
  res.type("text/plain");
  res.send(`User-agent: *\nAllow: /\nDisallow: /admin/\nSitemap: ${BASE_URL}/sitemap.xml\n`);
});

app.get("/sitemap.xml", async (_req, res) => {
  let rooms = cacheGet("rooms:all");
  if (!rooms) {
    rooms = await prisma.room.findMany({ where: { active: true } });
    cacheSet("rooms:all", rooms);
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${BASE_URL}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
  <url><loc>${BASE_URL}/chambres</loc><changefreq>daily</changefreq><priority>0.9</priority></url>
  ${rooms.map((r) => `<url><loc>${BASE_URL}/chambre/${r.id}</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>`).join("\n  ")}
</urlset>`;
  res.set("Content-Type", "application/xml");
  res.set("Cache-Control", "public, max-age=3600");
  res.send(xml);
});

app.get("/", async (_req, res) => {
  let settings = cacheGet("settings");
  let rooms = cacheGet("rooms:all");
  if (!settings || !rooms) {
    [rooms, settings] = await Promise.all([
      prisma.room.findMany({ where: { active: true } }),
      prisma.setting.findUnique({ where: { id: "main" } }),
    ]);
    cacheSet("settings", settings);
    cacheSet("rooms:all", rooms);
  }
  const featured = rooms.filter((r) => r.featured).slice(0, 3);
  res.render("index", { rooms, featured, settings, page: "home" });
});

app.get("/chambres", async (_req, res) => {
  let settings = cacheGet("settings");
  let rooms = cacheGet("rooms:all");
  if (!settings || !rooms) {
    [rooms, settings] = await Promise.all([
      prisma.room.findMany({ where: { active: true } }),
      prisma.setting.findUnique({ where: { id: "main" } }),
    ]);
    cacheSet("settings", settings);
    cacheSet("rooms:all", rooms);
  }
  res.render("rooms", { rooms, settings, page: "rooms" });
});

app.get("/chambre/:id", async (req, res) => {
  const cacheKey = `room:${req.params.id}`;
  let settings = cacheGet("settings");
  let room = cacheGet(cacheKey);
  if (!settings || !room) {
    [room, settings] = await Promise.all([
      prisma.room.findFirst({ where: { id: req.params.id, active: true } }),
      prisma.setting.findUnique({ where: { id: "main" } }),
    ]);
    if (settings) cacheSet("settings", settings);
    if (room) cacheSet(cacheKey, room);
  }
  if (!room) return res.redirect("/chambres");
  res.render("room-detail", {
    room,
    settings,
    page: "rooms",
    paypalClientId: process.env.PAYPAL_CLIENT_ID || "",
  });
});

// ─── PAYMENT ROUTES ───────────────────────────────────────────────────────────

// FedaPay – initialiser et rediriger
app.post("/payment/fedapay/init", async (req, res) => {
  const {
    room,
    roomId,
    checkin,
    checkout,
    fullname,
    phone,
    email,
    guests,
    nights,
    totalAmount,
  } = req.body;
  try {
    FedaPay.setApiKey(process.env.FEDAPAY_SECRET_KEY);
    FedaPay.setEnvironment(process.env.FEDAPAY_ENV || "sandbox");

    const nameParts = (fullname || "Client").trim().split(" ");
    const transaction = await Transaction.create({
      description: `Réservation – ${room} · ${nights} nuit(s)`,
      amount: parseInt(totalAmount),
      currency: { iso: "XOF" },
      callback_url: `${BASE_URL}/payment/fedapay/callback`,
      customer: {
        firstname: nameParts[0],
        lastname: nameParts.slice(1).join(" ") || nameParts[0],
        email: email || undefined,
        phone_number: phone
          ? { number: phone.replace(/\s/g, ""), country: "TG" }
          : undefined,
      },
    });

    // Stocker la réservation en session pour la créer après paiement
    req.session.pendingBooking = {
      room,
      roomId,
      checkin,
      checkout,
      fullname,
      phone,
      email,
      guests: parseInt(guests) || 1,
      nights: parseInt(nights) || 1,
      totalAmount: parseInt(totalAmount),
      paymentMethod: "fedapay",
    };
    req.session.fedapayTxId = transaction.id;

    const token = await transaction.generateToken();
    res.redirect(token.url);
  } catch (err) {
    console.error("FedaPay error:", err);
    res.redirect("/payment/cancel?error=fedapay");
  }
});

// FedaPay – callback après paiement
app.get("/payment/fedapay/callback", async (req, res) => {
  const { id, status } = req.query;
  try {
    FedaPay.setApiKey(process.env.FEDAPAY_SECRET_KEY);
    FedaPay.setEnvironment(process.env.FEDAPAY_ENV || "sandbox");

    if (status === "approved" && req.session.pendingBooking) {
      const booking = req.session.pendingBooking;
      await prisma.booking.create({
        data: {
          id: Date.now().toString(),
          ...booking,
          status: "confirmed",
          paymentStatus: "paid",
          paymentId: String(id),
        },
      });
      req.session.pendingBooking = null;
      req.session.fedapayTxId = null;
      sendBookingNotification({ ...booking, paymentMethod: "fedapay" }).catch(() => {});
      return res.redirect("/payment/success?method=fedapay");
    }
    res.redirect("/payment/cancel?method=fedapay");
  } catch (err) {
    console.error("FedaPay callback error:", err);
    res.redirect("/payment/cancel?error=1");
  }
});

// PayPal – créer un ordre
app.post("/payment/paypal/create-order", async (req, res) => {
  try {
    const { amountEur } = req.body;
    const token = await getPayPalToken();
    const response = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            amount: { currency_code: "EUR", value: String(amountEur) },
            description: "Maison Stella – Réservation chambre",
          },
        ],
      }),
    });
    const order = await response.json();
    res.json({ id: order.id });
  } catch (err) {
    console.error("PayPal create-order error:", err);
    res.status(500).json({ error: "Erreur PayPal" });
  }
});

// PayPal – capturer le paiement et créer la réservation
app.post("/payment/paypal/capture", async (req, res) => {
  const {
    orderID,
    room,
    roomId,
    checkin,
    checkout,
    fullname,
    phone,
    email,
    guests,
    nights,
    totalAmount,
  } = req.body;
  try {
    const token = await getPayPalToken();
    const response = await fetch(
      `${PAYPAL_BASE}/v2/checkout/orders/${orderID}/capture`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );
    const capture = await response.json();

    if (capture.status === "COMPLETED") {
      await prisma.booking.create({
        data: {
          id: Date.now().toString(),
          room,
          roomId,
          checkin,
          checkout,
          fullname,
          phone,
          email,
          guests: parseInt(guests) || 1,
          nights: parseInt(nights) || 1,
          totalAmount: parseInt(totalAmount),
          status: "confirmed",
          paymentMethod: "paypal",
          paymentStatus: "paid",
          paymentId: orderID,
        },
      });
      sendBookingNotification({ room, checkin, checkout, fullname, phone, email, guests: parseInt(guests) || 1, nights: parseInt(nights) || 1, totalAmount: parseInt(totalAmount), paymentMethod: "paypal" }).catch(() => {});
      res.json({ success: true });
    } else {
      res.json({ success: false, error: "Paiement non complété" });
    }
  } catch (err) {
    console.error("PayPal capture error:", err);
    res.status(500).json({ error: "Erreur PayPal capture" });
  }
});

app.get("/payment/success", async (req, res) => {
  const settings = await prisma.setting.findUnique({ where: { id: "main" } });
  res.render("payment/success", {
    settings,
    method: req.query.method || "unknown",
    page: "",
  });
});

app.get("/payment/cancel", async (req, res) => {
  const settings = await prisma.setting.findUnique({ where: { id: "main" } });
  res.render("payment/cancel", {
    settings,
    method: req.query.method || "",
    page: "",
  });
});

// ─── CONTACT FORM ────────────────────────────────────────────────────────────
app.post("/contact", async (req, res) => {
  const { firstname, lastname, phone, message } = req.body;
  if (!firstname || !lastname || !message) {
    return res.status(400).json({ error: "Champs requis manquants." });
  }
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  await prisma.contactMessage.create({ data: { id, firstname, lastname, phone: phone || null, message } });

  const transporter = createMailTransporter();
  if (transporter) {
    transporter.sendMail({
      from: `"Maison Stella" <${process.env.SMTP_USER}>`,
      to: BOOKING_EMAIL,
      subject: `Nouveau message de ${firstname} ${lastname}`,
      html: `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><style>
body{font-family:-apple-system,sans-serif;background:#f4f4f4;margin:0;padding:0}
.wrap{max-width:520px;margin:2rem auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.1)}
.hdr{background:#d2553d;padding:1.75rem;text-align:center;color:#fff}
.hdr h1{margin:0;font-size:1.3rem;font-weight:700}
.body{padding:1.75rem}
.row{padding:.55rem 0;border-bottom:1px solid #eee;font-size:.9rem;display:flex;justify-content:space-between}
.row:last-child{border-bottom:none}
.label{color:#767676;font-weight:500}.value{color:#222;font-weight:600}
.msg{background:#f9f9f9;border-radius:8px;padding:1rem;margin-top:1rem;font-size:.9rem;line-height:1.6;white-space:pre-wrap}
.ftr{background:#f9f9f9;padding:1rem 1.75rem;font-size:.8rem;color:#999;text-align:center;border-top:1px solid #eee}
</style></head><body>
<div class="wrap">
  <div class="hdr"><h1>Nouveau message de contact</h1></div>
  <div class="body">
    <div class="row"><span class="label">Nom</span><span class="value">${firstname} ${lastname}</span></div>
    ${phone ? `<div class="row"><span class="label">Téléphone</span><span class="value">${phone}</span></div>` : ""}
    <div class="msg">${message.replace(/</g, "&lt;")}</div>
  </div>
  <div class="ftr">Maison Stella · Avepozo, Lomé</div>
</div></body></html>`,
    }).catch(() => {});
  }

  res.json({ ok: true });
});

// ─── ADMIN AUTH ───────────────────────────────────────────────────────────────

app.get("/admin", requireAdmin, (_req, res) =>
  res.redirect("/admin/dashboard"),
);

app.get("/admin/login", (req, res) => {
  if (req.session.admin) return res.redirect("/admin/dashboard");
  res.render("admin/login", { error: null });
});

app.post("/admin/login", async (req, res) => {
  const { password } = req.body;
  const settings = await prisma.setting.findUnique({ where: { id: "main" } });
  if (password === (settings?.adminPlain || "stella2026")) {
    req.session.admin = true;
    return res.redirect("/admin/dashboard");
  }
  res.render("admin/login", { error: "Mot de passe incorrect." });
});

app.get("/admin/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/admin/login");
});

// ─── ADMIN DASHBOARD ──────────────────────────────────────────────────────────

app.get("/admin/dashboard", requireAdmin, async (_req, res) => {
  const [rooms, bookings, settings] = await Promise.all([
    prisma.room.findMany(),
    prisma.booking.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.setting.findUnique({ where: { id: "main" } }),
  ]);
  const stats = {
    totalRooms: rooms.filter((r) => r.active).length,
    totalBookings: bookings.length,
    pendingBookings: bookings.filter((b) => b.paymentStatus === "unpaid")
      .length,
    confirmedBookings: bookings.filter((b) => b.paymentStatus === "paid")
      .length,
  };
  res.render("admin/dashboard", {
    stats,
    bookings: bookings.slice(0, 10),
    settings,
  });
});

// ─── ADMIN CHAMBRES ───────────────────────────────────────────────────────────

app.get("/admin/chambres", requireAdmin, async (req, res) => {
  const [rooms, settings] = await Promise.all([
    prisma.room.findMany(),
    prisma.setting.findUnique({ where: { id: "main" } }),
  ]);
  res.render("admin/rooms", {
    rooms,
    settings,
    success: req.query.success || null,
    error: req.query.error || null,
  });
});

// Modifier une chambre – page dédiée
app.get("/admin/chambres/edit/:id", requireAdmin, async (req, res) => {
  const [room, settings] = await Promise.all([
    prisma.room.findUnique({ where: { id: req.params.id } }),
    prisma.setting.findUnique({ where: { id: "main" } }),
  ]);
  if (!room) return res.redirect("/admin/chambres?error=Chambre+introuvable");
  res.render("admin/room-edit", {
    room,
    settings,
    success: req.query.success || null,
    error: req.query.error || null,
  });
});

// Créer une chambre – formulaire
app.get("/admin/chambres/nouvelle", requireAdmin, async (_req, res) => {
  const settings = await prisma.setting.findUnique({ where: { id: "main" } });
  res.render("admin/room-create", { settings, error: null });
});

// Créer une chambre – traitement
app.post(
  "/admin/chambres/nouvelle",
  requireAdmin,
  uploadImages.array("images", 20),
  async (req, res) => {
    const {
      name,
      price,
      capacity,
      bedType,
      desc,
      badge,
      featured,
      composition,
      amenities,
    } = req.body;
    try {
      let id = slugify(name);
      // Garantir l'unicité de l'ID
      const existing = await prisma.room.findUnique({ where: { id } });
      if (existing) id = `${id}-${Date.now().toString(36)}`;

      const imageFiles = req.files || [];
      await Promise.all(
        imageFiles.map((f) =>
          compressImage(path.join(__dirname, "public/image", f.filename))
        )
      );
      const images = imageFiles.map((f) => f.filename);

      await prisma.room.create({
        data: {
          id,
          name,
          price: parseInt(price),
          capacity: parseInt(capacity),
          bedType,
          desc,
          badge: badge || "",
          featured: featured === "on",
          active: true,
          composition: composition
            ? composition
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
          amenities: amenities
            ? amenities
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
          images,
        },
      });
      cacheInvalidate("rooms");
      res.redirect("/admin/chambres?success=Chambre+créée+avec+succès");
    } catch (err) {
      console.error(err);
      const settings = await prisma.setting.findUnique({
        where: { id: "main" },
      });
      res.render("admin/room-create", {
        settings,
        error: "Erreur lors de la création.",
      });
    }
  },
);

// Créer chambre sans images – réponse JSON (pour upload AJAX progressif)
app.post(
  "/admin/chambres/nouvelle/json",
  requireAdmin,
  uploadImages.none(),
  async (req, res) => {
    const { name, price, capacity, bedType, desc, badge, featured, composition, amenities } = req.body;
    try {
      let id = slugify(name);
      const existing = await prisma.room.findUnique({ where: { id } });
      if (existing) id = `${id}-${Date.now().toString(36)}`;
      await prisma.room.create({
        data: {
          id, name,
          price: parseInt(price),
          capacity: parseInt(capacity),
          bedType, desc,
          badge: badge || "",
          featured: featured === "on",
          active: true,
          composition: composition ? composition.split("\n").map((s) => s.trim()).filter(Boolean) : [],
          amenities: amenities ? amenities.split("\n").map((s) => s.trim()).filter(Boolean) : [],
          images: [],
        },
      });
      cacheInvalidate("rooms");
      res.json({ id });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Erreur lors de la création" });
    }
  },
);

// Activer / désactiver
app.post("/admin/chambres/toggle/:id", requireAdmin, async (req, res) => {
  const room = await prisma.room.findUnique({ where: { id: req.params.id } });
  if (room)
    await prisma.room.update({
      where: { id: room.id },
      data: { active: !room.active },
    });
  cacheInvalidate("rooms");
  const back = req.get("Referer") || "/admin/chambres";
  res.redirect(back);
});

// Modifier les infos texte
app.post("/admin/chambres/update/:id", requireAdmin, async (req, res) => {
  const {
    name,
    price,
    capacity,
    bedType,
    desc,
    badge,
    featured,
    composition,
    amenities,
  } = req.body;
  try {
    await prisma.room.update({
      where: { id: req.params.id },
      data: {
        name,
        bedType,
        desc,
        badge: badge || "",
        price: parseInt(price),
        capacity: parseInt(capacity),
        featured: featured === "on",
        composition: composition
          ? composition
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
        amenities: amenities
          ? amenities
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
      },
    });
    cacheInvalidate("rooms");
    res.redirect(
      `/admin/chambres/edit/${req.params.id}?success=Modifications+enregistrées`,
    );
  } catch {
    res.redirect(
      `/admin/chambres/edit/${req.params.id}?error=Erreur+lors+de+la+mise+à+jour`,
    );
  }
});

// Upload de nouvelles photos (batch – fallback sans JS)
app.post(
  "/admin/chambres/:id/images",
  requireAdmin,
  uploadImages.array("images", 20),
  async (req, res) => {
    const room = await prisma.room.findUnique({ where: { id: req.params.id } });
    if (!room) return res.redirect("/admin/chambres?error=Chambre+introuvable");
    const fileList = req.files || [];
    await Promise.all(
      fileList.map((f) =>
        compressImage(path.join(__dirname, "public/image", f.filename))
      )
    );
    const newImages = fileList.map((f) => f.filename);
    await prisma.room.update({
      where: { id: room.id },
      data: { images: [...room.images, ...newImages] },
    });
    cacheInvalidate(`room:${room.id}`);
    res.redirect(`/admin/chambres/edit/${room.id}?success=Photos+ajoutées`);
  },
);

// Upload d'une photo unique – JSON (pour progression AJAX)
app.post(
  "/admin/chambres/:id/images/single",
  requireAdmin,
  uploadImages.single("image"),
  async (req, res) => {
    const room = await prisma.room.findUnique({ where: { id: req.params.id } });
    if (!room) return res.status(404).json({ error: "Chambre introuvable" });
    if (!req.file) return res.status(400).json({ error: "Aucun fichier reçu" });
    const filename = req.file.filename;
    await compressImage(path.join(__dirname, "public/image", filename));
    await prisma.room.update({
      where: { id: room.id },
      data: { images: [...room.images, filename] },
    });
    cacheInvalidate(`room:${room.id}`);
    res.json({ filename, url: `/image/${filename}` });
  },
);

// Supprimer une photo
app.post(
  "/admin/chambres/:id/images/delete",
  requireAdmin,
  async (req, res) => {
    const { image } = req.body;
    const room = await prisma.room.findUnique({ where: { id: req.params.id } });
    if (room) {
      await prisma.room.update({
        where: { id: room.id },
        data: { images: room.images.filter((img) => img !== image) },
      });
      const filePath = path.join(__dirname, "public/image", image);
      if (fs.existsSync(filePath) && image.startsWith("room-"))
        fs.unlinkSync(filePath);
    }
    cacheInvalidate(`room:${req.params.id}`);
    res.redirect(
      `/admin/chambres/edit/${req.params.id}?success=Photo+supprimée`,
    );
  },
);

// Supprimer une chambre
app.post("/admin/chambres/delete/:id", requireAdmin, async (req, res) => {
  await prisma.room.delete({ where: { id: req.params.id } });
  cacheInvalidate("rooms");
  res.redirect("/admin/chambres?success=Chambre+supprimée");
});

// ─── ADMIN RESERVATIONS ───────────────────────────────────────────────────────

app.get("/admin/reservations", requireAdmin, async (_req, res) => {
  const [bookings, settings] = await Promise.all([
    prisma.booking.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.setting.findUnique({ where: { id: "main" } }),
  ]);
  res.render("admin/bookings", { bookings, settings });
});

app.post("/admin/reservations/status/:id", requireAdmin, async (req, res) => {
  await prisma.booking.update({
    where: { id: req.params.id },
    data: { status: req.body.status },
  });
  res.redirect("/admin/reservations");
});

app.post("/admin/reservations/delete/:id", requireAdmin, async (req, res) => {
  await prisma.booking.delete({ where: { id: req.params.id } });
  res.redirect("/admin/reservations");
});

// ─── ADMIN PARAMETRES ─────────────────────────────────────────────────────────

app.get("/admin/parametres", requireAdmin, async (req, res) => {
  const settings = await prisma.setting.findUnique({ where: { id: "main" } });
  res.render("admin/settings", {
    settings,
    success: req.query.success || null,
  });
});

app.post("/admin/parametres", requireAdmin, async (req, res) => {
  const {
    siteName,
    tagline,
    description,
    address,
    phone,
    email,
    aboutText,
    aboutText2,
    heroImage,
    adminPlain,
  } = req.body;
  const data = {
    siteName,
    tagline,
    description,
    address,
    phone,
    email,
    aboutText,
    aboutText2,
    heroImage,
  };
  if (adminPlain?.trim()) data.adminPlain = adminPlain.trim();
  await prisma.setting.update({ where: { id: "main" }, data });
  cacheInvalidate("settings");
  res.redirect("/admin/parametres?success=1");
});

// ─── MESSAGES DE CONTACT ─────────────────────────────────────────────────────
app.get("/admin/messages", requireAdmin, async (req, res) => {
  const settings = await prisma.setting.findUnique({ where: { id: "main" } });
  const messages = await prisma.contactMessage.findMany({ orderBy: { createdAt: "desc" } });
  res.render("admin/messages", { settings, messages });
});

app.post("/admin/messages/:id/read", requireAdmin, async (req, res) => {
  await prisma.contactMessage.update({ where: { id: req.params.id }, data: { read: true } });
  res.redirect("/admin/messages");
});

app.post("/admin/messages/:id/delete", requireAdmin, async (req, res) => {
  await prisma.contactMessage.delete({ where: { id: req.params.id } });
  res.redirect("/admin/messages");
});

// ─── MÉDIATHÈQUE ─────────────────────────────────────────────────────────────
const IMAGE_EXTS = /\.(jpg|jpeg|png|webp|gif)$/i;

app.get("/admin/media", requireAdmin, async (_req, res) => {
  const settings = await prisma.setting.findUnique({ where: { id: "main" } });
  res.render("admin/media", { settings });
});

app.get("/admin/media/list", requireAdmin, async (_req, res) => {
  const imageDir = path.join(__dirname, "public/image");
  const files = fs.readdirSync(imageDir).filter((f) => IMAGE_EXTS.test(f));
  const rooms = await prisma.room.findMany({ select: { images: true } });
  const usedSet = new Set(rooms.flatMap((r) => r.images));
  const list = files
    .map((filename) => {
      const stats = fs.statSync(path.join(imageDir, filename));
      return { filename, url: `/image/${encodeURIComponent(filename)}`, size: stats.size, date: stats.mtime, inUse: usedSet.has(filename) };
    })
    .sort((a, b) => b.date - a.date);
  res.json(list);
});

app.post("/admin/media/upload", requireAdmin, uploadImages.array("images", 30), async (req, res) => {
  const files = req.files || [];
  await Promise.all(files.map((f) => compressImage(path.join(__dirname, "public/image", f.filename))));
  res.json({ files: files.map((f) => ({ filename: f.filename, url: `/image/${encodeURIComponent(f.filename)}` })) });
});

app.post("/admin/media/delete", requireAdmin, async (req, res) => {
  const { filename } = req.body;
  if (!filename || !filename.startsWith("room-")) return res.status(400).json({ error: "Fichier non supprimable" });
  const filePath = path.join(__dirname, "public/image", filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  res.json({ success: true });
});

// Ajouter des images depuis la médiathèque à une chambre
app.post("/admin/chambres/:id/images/from-library", requireAdmin, async (req, res) => {
  const room = await prisma.room.findUnique({ where: { id: req.params.id } });
  if (!room) return res.status(404).json({ error: "Chambre introuvable" });
  const filenames = Array.isArray(req.body.filenames) ? req.body.filenames : [req.body.filenames].filter(Boolean);
  const toAdd = filenames.filter((f) => typeof f === "string" && f.length > 0);
  if (toAdd.length) {
    await prisma.room.update({ where: { id: room.id }, data: { images: [...room.images, ...toAdd] } });
    cacheInvalidate(`room:${room.id}`);
  }
  res.json({ success: true });
});

// ─── START ────────────────────────────────────────────────────────────────────
// app.listen(PORT, () => {
//   console.log(`\n✅ Maison Stella → http://localhost:${PORT}`);
//   console.log(`🔐 Admin panel  → http://localhost:${PORT}/admin`);
//   console.log(`   Mot de passe: stella2026\n`);
// });

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on ${BASE_URL}`);
});
