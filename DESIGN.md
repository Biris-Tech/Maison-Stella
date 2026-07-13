# Design

Système visuel de Maison Stella. Registre **brand**, plateforme **web**, mobile d'abord.
Direction : **lumineux, aéré, luxueux, éditorial** — le luxe par l'espace et la photographie, pas par l'accumulation d'effets.

## Theme

Clair et chaleureux (ivoire), pas sombre. Grande respiration, marges généreuses, photographie mise en avant. Ton « magazine de voyage haut de gamme » : intime, raffiné, confiant. Le sombre est réservé à de rares blocs (footer), jamais au fond principal.

## Color

Palette resserrée (ivoire + encre + terracotta + laiton), le terracotta en **accent**, jamais en aplat dominant.

- `--ivory` `#FCF9F3` — fond principal, blanc chaud lumineux (pas de crème saturée).
- `--sand` `#F3EADD` — surface chaude secondaire, utilisée avec parcimonie (sections alternées).
- `--ink` `#231A12` — encre brun-noir chaude, texte principal.
- `--ink-soft` `#6A5A4B` — texte secondaire (contraste ≥ 4.5:1 sur ivoire).
- `--terracotta` `#C24A32` — accent de marque : liens, CTA, détails (dosé).
- `--terracotta-deep` `#A03A26` — hover/pressed.
- `--brass` `#A9793C` — filets fins, petites étiquettes, touches de luxe.
- `--forest` `#2F4230` — accent secondaire rare (nature/lac), pour un contrepoint profond.
- `--line` `#E7DCCD` — filets et séparateurs.

Sémantique (succès/erreur) distincte de l'accent. Mode sombre : possible plus tard via tokens ; l'identité par défaut est claire.

## Typography

Contraste serif ↔ sans, la typo est la vedette.

- **Display / titres** : pile serif système à fort caractère — `'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif`. Grands, généreux, `text-wrap: balance`, interlettrage serré (~-0.02em), italique pour l'emphase.
- **Corps / UI** : `'Plus Jakarta Sans'` (déjà chargé) + repli système. Lisible, calme, ~65 caractères par ligne.
- **Étiquettes** : petites capitales espacées (~.2em), en `--brass`, discrètes — **pas** un eyebrow au-dessus de chaque section.
- Échelle : hero clamp jusqu'à ~5.5rem ; titres de section ~2–3.4rem ; corps 1–1.1rem.

## Layout

Éditorial et asymétrique. Largeur max ~1200px, marges larges. Grille pour le 2D, flex pour le 1D. Rythme vertical varié (sections qui respirent, pas une cadence mécanique). Photographie plein cadre ou en grands blocs. Mobile d'abord : une colonne, cibles ≥ 44px, CTA de réservation accessible sans long scroll.

## Components

- **Boutons** : pilule ou coin doux (rayon ≤ 12–16px), terracotta plein pour le primaire, contour fin pour le secondaire. Hover subtil.
- **Barre de réservation** : posée, claire, sur ombre douce ; dates + voyageurs + CTA. Fonctionnelle (formulaire réel).
- **Cartes chambres** : menées par la photo, chrome minimal, prix en évidence (FCFA), un seul accent par carte. Pas de grille de cartes toutes identiques : varier tailles/mises en avant.
- **Filets** : hairline `--line` ou `--brass` plutôt que des bordures épaisses ; jamais de bordure latérale colorée décorative.
- Rayons cartes 12–16px (pas de sur-arrondi), ombres douces (blur ≤ ~24px, jamais bordure + grosse ombre ensemble).

## Motion

Minimale et élégante. Apparition douce au chargement / au scroll (fondu + léger décalage), hover feutré sur cartes et liens. Rien qui clignote ou tourne en continu. Toujours un repli `@media (prefers-reduced-motion: reduce)`.
