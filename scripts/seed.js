require('dotenv').config();
const path = require('path');
const fs = require('fs');
const prisma = require('../lib/prisma');

async function main() {
  console.log('🌱 Seeding MongoDB Atlas depuis les fichiers JSON...\n');

  // ─── ROOMS ────────────────────────────────────────────────────────────────
  const rooms = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/rooms.json'), 'utf8'));
  for (const room of rooms) {
    const { id, ...data } = room;
    await prisma.room.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
    console.log(`  ✅ Chambre : ${room.name}`);
  }

  // ─── SETTINGS ─────────────────────────────────────────────────────────────
  const settings = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/settings.json'), 'utf8'));
  const { adminPassword, ...settingsData } = settings; // exclure champs parasites
  await prisma.setting.upsert({
    where: { id: 'main' },
    update: settingsData,
    create: { id: 'main', ...settingsData },
  });
  console.log(`  ✅ Paramètres du site`);

  // ─── BOOKINGS ─────────────────────────────────────────────────────────────
  const bookings = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/bookings.json'), 'utf8'));
  for (const b of bookings) {
    const { id, ...bData } = b;
    await prisma.booking.upsert({
      where: { id },
      update: { ...bData, createdAt: new Date(b.createdAt) },
      create: { id, ...bData, createdAt: new Date(b.createdAt) },
    });
    console.log(`  ✅ Réservation : ${b.fullname || b.id}`);
  }

  console.log('\n🎉 Seed terminé avec succès !');
}

main()
  .catch(e => { console.error('❌ Erreur seed :', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
