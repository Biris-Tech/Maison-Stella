# Maison Stella — À faire

Liste de travail du projet. Cases cochées = déjà fait (sur branche, non fusionné).

---

## 🔴 Sécurité (prioritaire)

- [x] **Montant de paiement recalculé côté serveur** — un client pouvait payer un prix arbitraire (montant pris du navigateur). — branche `fix/paiement-securite`
- [x] **Anti double-réservation** — aucune vérification que la chambre est libre sur les dates. — branche `fix/disponibilite`
- [x] **Mot de passe admin en clair supprimé** — `Setting.adminPlain` (« stella2026 »). — branche `fix/mdp-admin-en-clair`
- [ ] **Callback FedaPay à sécuriser** — il fait confiance au `status` passé dans l'URL sans revérifier la transaction auprès de l'API FedaPay.
- [ ] **Borner le nombre de voyageurs** par la capacité réelle de la chambre (`guests` non contrôlé).

## 📋 Demandes du responsable (note vocale)

- [ ] **Admin / gestion des champs** — revoir la saisie des champs de chambre, harmoniser le design du site.
- [ ] **Page « Nos services »** — retravailler pour la conversion (donner envie de réserver).
- [ ] **Intégration du paiement** — vérifier que FedaPay + PayPal fonctionnent bien de bout en bout.
- [ ] **Blog automatique (OpenAI)** — 1 article/jour généré à partir des chambres, optimisé SEO, prompt « anti-détection IA ». ⛔ *Bloqué : besoin d'une clé OpenAI.*
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
