# Maison Stella — À faire

Liste de travail du projet. Cases cochées = déjà fait (sur branche, non fusionné).

## Méthode

- **Design / refonte** (harmonisation, admin, champs, page « Services », identité visuelle) → menés avec **`/impeccable` + Opus**, objectif : une refonte **époustouflante** et cohérente de bout en bout. Pas de sous-agents, pas de branches éparpillées.
- Ce fichier est **tenu à jour au fil de l'avancement** (cases cochées + push).

---

## 🔴 Sécurité (prioritaire)

- [x] **Montant de paiement recalculé côté serveur** — un client pouvait payer un prix arbitraire (montant pris du navigateur). — branche `fix/paiement-securite`
- [x] **Anti double-réservation** — aucune vérification que la chambre est libre sur les dates. — branche `fix/disponibilite`
- [x] **Mot de passe admin en clair supprimé** — `Setting.adminPlain` (« stella2026 »). — branche `fix/mdp-admin-en-clair`
- [ ] **Callback FedaPay à sécuriser** — il fait confiance au `status` passé dans l'URL sans revérifier la transaction auprès de l'API FedaPay.
- [ ] **Borner le nombre de voyageurs** par la capacité réelle de la chambre (`guests` non contrôlé).

## 📋 Demandes du responsable (note vocale)

- [x] **Refonte du site public** — accueil, chambres, fiche chambre, blog : direction lumineuse & éditoriale, logo, chambres + articles de démo. — branche `feat/refonte`
- [x] **Page « Nos services »** — refondue en section éditoriale sur l'accueil (branche `feat/refonte`).
- [x] **Harmoniser l'admin** — back-office aligné sur le terracotta (branche `feat/refonte`).
- [x] **Pages résultat de paiement** (succès / annulation) — refondues (branche `feat/refonte`).
- [x] **Gestion des champs (admin)** — éditeur structuré (checklist équipements + chips, liste dynamique composition, menu type de lit). — branche `feat/refonte`
- [ ] **Intégration du paiement** — vérifier que FedaPay + PayPal fonctionnent bien de bout en bout.
- [x] **Blog automatique (IA)** — infrastructure complète : branche `feat/blog-auto`
   - [x] Moteur de génération IA (`lib/blog-auto.js`) avec prompts anti-détection + SEO
   - [x] **Source 1 · Chambres** : génère un article descriptif par chambre (données DB)
   - [x] **Source 2 · Flux RSS** : récupère, reformule et publie des articles tourisme
   - [x] **CTA en pied d'article** : personnalisable (texte + lien)
   - [x] **Back-office admin** : page `/admin/blog/auto` (config, flux RSS, logs, génération manuelle)
   - [x] **Mode de publication configurable** : brouillon (validation humaine) ou auto
   - [x] Planificateur cron (node-cron), configurable depuis l'admin — **100 % automatique** (défaut : 8h & 18h chaque jour, aucune action manuelle requise)
   - [x] Test de connexion API intégré
   - [x] **Visible depuis le site public** : section « Journal » sur l'accueil, lien dans le menu + pied de page, pages `/blog` ajoutées au `sitemap.xml`
   ⚠️ *Prêt à fonctionner — il suffit d'ajouter `OPENAI_API_KEY=sk-...` dans `.env`.*
- [ ] **Google Search Console** — vérifier le site, soumettre le sitemap, suivre l'indexation. ⛔ *Bloqué : besoin que le site soit déployé en prod.*

## ♿ Accessibilité (trouvé à l'évaluation)

- [ ] Lier chaque `<label>` à son champ (`for`/`id`) — recherche, contact, réservation.
- [ ] Focus clavier visible sur les widgets de réservation (`outline:none` sans remplacement).
- [ ] Bouton burger nommé (`aria-label`).
- [ ] Galerie photo de la chambre navigable au clavier.
- [ ] Contrastes < 4.5:1 (texte gris `--muted`, copyright du footer).
- [ ] Cibles tactiles < 44×44px (burger, chips, favoris).

## 🎯 Conversion / tunnel de réservation

- [ ] **État vide** sur `/chambres` (aujourd'hui grille vide sans message si aucune chambre).
- [ ] **Avis réels** — « 4.9 · 12 avis » est codé en dur et identique sur toutes les chambres.
- [ ] **Persistance des dates** — la recherche du hero ne se reporte pas jusqu'à la fiche chambre.
- [ ] **CTA de réservation sticky en mobile** (aujourd'hui enterré sous la galerie).
- [ ] **Aide au choix du paiement** — guider FedaPay (local) vs PayPal (international).

## ⚡ Performance & nettoyage

- [ ] **Images WebP/AVIF + `srcset`** — le pipeline `sharp` existe déjà, il manque la génération multi-format.
- [ ] Supprimer `views/layout.ejs` — code mort (aucune route ne l'utilise).

---

## Notes

- **`main` = prod**, en **MySQL**. Rien n'a été fusionné : le site est dans son état d'origine.
- Les 3 correctifs de sécurité vivent sur leurs branches respectives, prêts à être revus/fusionnés.
- ⚠️ `fix/paiement-securite` et `fix/disponibilite` touchent les mêmes zones (bloc `createOrder` PayPal + route `create-order`) → à **réconcilier au moment du merge** (fusionner le paiement d'abord).
- Faux positifs écartés pendant l'audit : le SEO des pages publiques est correct (meta/OpenGraph/JSON-LD présents), et il n'y a pas de bug `baseUrl` sur le blog (un middleware fournit déjà `baseUrl`).
