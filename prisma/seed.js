const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.setting.findUnique({ where: { id: 'main' } });
  if (existing) return;

  await prisma.setting.create({
    data: {
      id: 'main',
      siteName: 'Maison Stella',
      tagline: 'Résidence de Charme à Lomé',
      description: "Une retraite d'exception nichée au cœur d'Avepozo. Élégance, intimité et service personnalisé.",
      address: 'Avepozo, Lomé, Togo',
      phone: '+228 71 59 51 36',
      email: 'contact@maisonstella.tg',
      heroImage: 'IMG_0497 Large.jpeg',
      aboutText: "Maison Stella est une résidence de charme fondée avec l'ambition de faire vivre à chaque hôte une expérience authentique et raffinée à Lomé. Chaque détail a été pensé pour votre confort.",
      aboutText2: "Niché à Avepozo, au bord du lac, notre établissement allie l'âme d'une maison familiale au standing d'un boutique hôtel haut de gamme.",
      adminPlain: 'stella2026',
      services: [
        { icon: '🏊‍♂️', title: 'Piscine Privée', desc: 'Accès exclusif à notre piscine entourée de verdure, disponible 24h/24.' },
        { icon: '👨‍🍳', title: 'Chef Cuisinier', desc: 'Notre chef prépare des menus sur mesure mettant en valeur la cuisine locale et internationale.' },
        { icon: '🍹', title: 'Bar & Restaurant', desc: 'Cocktails artisanaux, vins sélectionnés et restauration légère dans notre espace lounge.' },
        { icon: '📶', title: 'Internet Haut Débit', desc: 'Connexion WiFi fibre dans toutes les chambres et espaces communs.' },
        { icon: '🛏️', title: 'Service Ménage Quotidien', desc: 'Votre chambre est préparée chaque jour avec soin. Blanchisserie disponible sur demande.' },
        { icon: '🌿', title: 'Jardin Tropical', desc: 'Un jardin luxuriant pour événements privés, détente ou profiter de l\'air du lac.' }
      ]
    }
  });

  console.log('✅ Settings initialisés');
}

main().catch(console.error).finally(() => prisma.$disconnect());
