/**
 * Rasterise the per-theme favicons.
 *
 * The SVGs in public/ are the drawings; this bakes the 32px PNG each one needs
 * for the browsers that do not read SVG icons. Run it after editing any
 * favicon-<theme>.svg:
 *
 *   node scripts/build-favicons.mjs
 *
 * Day's rasters (favicon-16/32.png, favicon.ico, apple-touch-icon.png) are not
 * regenerated here. They were drawn with the mark itself and include an .ico
 * and an inset iOS tile this script has no business re-cutting; the themes need
 * only the one live raster size.
 */
import { readdir, writeFile, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), "../public");

const themed = (await readdir(publicDir))
  .filter((name) => /^favicon-[a-z-]+\.svg$/.test(name));

for (const name of themed) {
  const theme = name.slice("favicon-".length, -".svg".length);
  const out = `favicon-${theme}-32.png`;
  const png = await sharp(await readFile(resolve(publicDir, name)), { density: 384 })
    .resize(32, 32)
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(resolve(publicDir, out), png);
  console.log(`${name} → ${out} (${png.length} bytes)`);
}
