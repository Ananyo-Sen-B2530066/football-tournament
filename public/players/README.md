# Player images

Drop one image per player here, named after the player's **id**.

- ids are assigned in registration order: `p-1`, `p-2`, `p-3`, …
- you can also give them any id you like via the Setup tab (the owner page's
  "Player images" checklist shows the exact filename each player expects)

Accepted extensions: `.jpg` `.png` `.webp` (probed in that order).

Resolution order used by the app:

1. URL from `PLAYER_IMAGES` in `config/tournament.config.ts` (or the `avatar`
   column of the imported Players sheet)
2. a local file in this folder
3. a coloured monogram of the gamer-tag's initials — so a missing or broken
   image can never disrupt the live show

Square images (1:1) look best; anything is cropped to a circle via CSS.

`EXAMPLE-p-1.svg` … `EXAMPLE-p-5.svg` are sample avatars showing the expected look — rename one to `p-1.svg` (or drop a real `p-1.jpg`) to use it. Files named `EXAMPLE-*` are never picked up automatically.
