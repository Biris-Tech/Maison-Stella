const cron = require("node-cron");
const RSSParser = require("rss-parser");
const OpenAI = require("openai");

const rssParser = new RSSParser();
let prisma;
let cronJob = null;

const REWRITE_PROMPT = `Tu es un rédacteur de voyage spécialisé dans le tourisme au Togo et en Afrique de l'Ouest.
Réécris l'article ci-dessous en le reformulant ENTIÈREMENT avec un style éditorial humain, chaleureux et engageant.

Règles impératives :
- NE COPIE PAS le texte original — reformule tout avec tes propres mots
- Adopte un ton personnel, comme un voyageur passionné qui partage ses découvertes
- Varie la longueur des phrases, mêle phrases courtes et longues
- Utilise des expressions naturelles, des tournures orales et des transitions humaines
- Ajoute des détails sensoriels (couleurs, odeurs, sons, textures)
- Structure avec des sous-titres H2 engageants
- Inclus naturellement des mots-clés SEO liés au voyage au Togo, à Lomé, à l'Afrique de l'Ouest
- Article entre 600 et 900 mots
- Le contenu doit être en HTML valide (balises p, h2, h3, ul, li, strong, em uniquement)

Réponds UNIQUEMENT en JSON valide, sans commentaires :
{"title": "Titre accrocheur et SEO", "excerpt": "2-3 phrases de résumé engageant", "content": "<p>Contenu HTML...</p>", "tags": ["tag1", "tag2", "tag3"]}`;

const ROOM_PROMPT = `Tu es un rédacteur de voyage spécialisé dans les hébergements de charme au Togo.
À partir des informations sur cette chambre/suite, rédige un article de blog immersif et descriptif.

Règles :
- Style éditorial humain, chaleureux, comme un carnet de voyage
- Décris l'ambiance, le confort, ce qu'on ressent en y séjournant
- Mentionne les équipements de façon naturelle (pas une liste froide)
- Relie l'expérience à la destination (Lomé, Avepozo, le lac, la culture togolaise)
- 500 à 700 mots
- Sous-titres H2 engageants
- Contenu en HTML (p, h2, h3, strong, em)
- SEO : mots-clés voyage Togo, hébergement Lomé, maison d'hôte Togo

Réponds UNIQUEMENT en JSON valide :
{"title": "Titre accrocheur", "excerpt": "2-3 phrases de résumé", "content": "<p>Contenu HTML...</p>", "tags": ["tag1", "tag2"]}`;

function getClient() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

function slugify(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildCTA(config) {
  const text = config.ctaText || "Réservez votre séjour à Maison Stella.";
  const link = config.ctaLink || "/chambres";
  return `<div style="background:#FCF9F3;border-left:4px solid #C24A32;padding:1.5rem;margin-top:2rem;border-radius:8px;"><p style="margin:0 0 0.75rem;font-weight:600;color:#1a1a1a;">${text}</p><p style="margin:0;"><a href="${link}" style="color:#C24A32;font-weight:600;text-decoration:underline;">Découvrir nos chambres →</a></p></div>`;
}

async function callAI(config, systemPrompt, userContent) {
  const client = getClient();
  if (!client) throw new Error("OPENAI_API_KEY manquante");

  const resp = await client.chat.completions.create({
    model: config.aiModel || "gpt-4o-mini",
    temperature: 0.8,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
  });

  return JSON.parse(resp.choices[0].message.content);
}

async function log(action, source, details, success = true, postId = null) {
  try {
    await prisma.blogAutoLog.create({
      data: { action, source, details, success, postId },
    });
  } catch (e) {
    console.error("Blog auto log error:", e.message);
  }
}

async function generateFromRSS(config) {
  const feeds = config.rssFeeds || [];
  if (!feeds.length) return { generated: 0, errors: [] };

  let generated = 0;
  const errors = [];

  for (const feed of feeds) {
    try {
      const parsed = await rssParser.parseURL(feed.url);
      const items = (parsed.items || []).slice(0, 3);

      for (const item of items) {
        const sourceUrl = item.link || item.guid || "";
        const existing = await prisma.blogPost.findFirst({
          where: { sourceUrl, source: "rss" },
        });
        if (existing) continue;

        const originalContent = item.contentSnippet || item.content || item.summary || "";
        if (!originalContent || originalContent.length < 100) continue;

        const userMsg = `Titre original : ${item.title || "Sans titre"}\nSource : ${feed.name || feed.url}\n\nContenu original :\n${originalContent.substring(0, 3000)}`;

        const result = await callAI(config, REWRITE_PROMPT, userMsg);

        let slug = slugify(result.title || item.title);
        const existingSlug = await prisma.blogPost.findUnique({ where: { slug } });
        if (existingSlug) slug = `${slug}-${Date.now().toString(36)}`;

        const content = result.content + buildCTA(config);
        const status = config.publicationMode === "auto" ? "published" : "draft";

        const post = await prisma.blogPost.create({
          data: {
            title: result.title || item.title,
            slug,
            excerpt: result.excerpt || "",
            content,
            authorId: "system",
            authorName: "Maison Stella",
            status,
            tags: result.tags || [],
            source: "rss",
            sourceUrl,
            aiGenerated: true,
            publishedAt: status === "published" ? new Date() : null,
          },
        });

        await log("generate_rss", feed.name || feed.url, `Article "${result.title}" généré depuis RSS`, true, post.id);
        generated++;
      }
    } catch (e) {
      const msg = `Erreur flux "${feed.name || feed.url}": ${e.message}`;
      errors.push(msg);
      await log("error_rss", feed.name || feed.url, msg, false);
    }
  }

  return { generated, errors };
}

async function generateFromRooms(config) {
  if (!config.roomArticles) return { generated: 0, errors: [] };

  const rooms = await prisma.room.findMany({ where: { active: true } });
  let generated = 0;
  const errors = [];

  for (const room of rooms) {
    const existing = await prisma.blogPost.findFirst({
      where: { sourceUrl: `room:${room.id}`, source: "room" },
    });
    if (existing) continue;

    try {
      const amenities = Array.isArray(room.amenities) ? room.amenities : [];
      const composition = Array.isArray(room.composition) ? room.composition : [];

      const userMsg = `Chambre : ${room.name}
Type de lit : ${room.bedType}
Capacité : ${room.capacity} personnes
Prix : ${room.price.toLocaleString("fr-FR")} FCFA / nuit
Description : ${room.desc}
Composition : ${composition.join(", ")}
Équipements : ${amenities.join(", ")}
Lieu : Maison Stella, Avepozo, Lomé, Togo`;

      const result = await callAI(config, ROOM_PROMPT, userMsg);

      let slug = slugify(result.title || room.name);
      const existingSlug = await prisma.blogPost.findUnique({ where: { slug } });
      if (existingSlug) slug = `${slug}-${Date.now().toString(36)}`;

      const images = Array.isArray(room.images) ? room.images : [];
      const coverImage = images[0] || "";
      const content = result.content + buildCTA(config);
      const status = config.publicationMode === "auto" ? "published" : "draft";

      const post = await prisma.blogPost.create({
        data: {
          title: result.title || room.name,
          slug,
          excerpt: result.excerpt || "",
          content,
          coverImage,
          authorId: "system",
          authorName: "Maison Stella",
          status,
          tags: result.tags || [],
          source: "room",
          sourceUrl: `room:${room.id}`,
          aiGenerated: true,
          publishedAt: status === "published" ? new Date() : null,
        },
      });

      await log("generate_room", room.name, `Article "${result.title}" généré pour la chambre "${room.name}"`, true, post.id);
      generated++;
    } catch (e) {
      const msg = `Erreur chambre "${room.name}": ${e.message}`;
      errors.push(msg);
      await log("error_room", room.name, msg, false);
    }
  }

  return { generated, errors };
}

async function runGeneration() {
  const config = await prisma.blogAutoConfig.findUnique({ where: { id: "main" } });
  if (!config) return { rss: { generated: 0, errors: [] }, rooms: { generated: 0, errors: [] } };

  const client = getClient();
  if (!client) {
    const msg = "Génération annulée : OPENAI_API_KEY manquante";
    await log("skip", "", msg, false);
    await prisma.blogAutoConfig.update({
      where: { id: "main" },
      data: { lastRunAt: new Date(), lastRunLog: msg },
    });
    return { error: msg };
  }

  const rssResult = await generateFromRSS(config);
  const roomResult = await generateFromRooms(config);

  const total = rssResult.generated + roomResult.generated;
  const allErrors = [...rssResult.errors, ...roomResult.errors];
  const summary = `${total} article(s) généré(s)${allErrors.length ? ` · ${allErrors.length} erreur(s)` : ""}`;

  await prisma.blogAutoConfig.update({
    where: { id: "main" },
    data: { lastRunAt: new Date(), lastRunLog: summary },
  });

  await log("run_complete", "", summary, allErrors.length === 0);
  return { rss: rssResult, rooms: roomResult, summary };
}

async function testConnection() {
  const client = getClient();
  if (!client) return { ok: false, error: "OPENAI_API_KEY non configurée dans .env" };

  try {
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 20,
      messages: [{ role: "user", content: "Réponds OK." }],
    });
    return { ok: true, model: resp.model, message: resp.choices[0].message.content };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function startScheduler() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
  }

  prisma.blogAutoConfig
    .findUnique({ where: { id: "main" } })
    .then((config) => {
      if (!config || !config.enabled) return;

      const schedule = config.cronSchedule || "0 8,18 * * *";
      if (!cron.validate(schedule)) {
        console.error(`Blog auto: planning cron invalide "${schedule}"`);
        return;
      }

      cronJob = cron.schedule(schedule, async () => {
        console.log(`[Blog Auto] Génération planifiée lancée — ${new Date().toISOString()}`);
        try {
          const result = await runGeneration();
          console.log(`[Blog Auto] Terminé: ${result.summary || "aucun résultat"}`);
        } catch (e) {
          console.error("[Blog Auto] Erreur:", e.message);
        }
      });

      console.log(`[Blog Auto] Planificateur actif — planning: "${schedule}"`);
    })
    .catch((e) => {
      console.error("Blog auto scheduler init error:", e.message);
    });
}

function restartScheduler() {
  startScheduler();
}

function init(prismaInstance) {
  prisma = prismaInstance;
  startScheduler();
}

module.exports = {
  init,
  runGeneration,
  testConnection,
  restartScheduler,
};
