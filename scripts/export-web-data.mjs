/**
 * Export a slim products payload for the web UI.
 *
 * Reads:  $DATA_DIR/products.json  (full scrape, object keyed by sku)
 * Writes: $DATA_DIR/products.web.json  (and optionally web/public for local dev)
 *
 * Usage: node scripts/export-web-data.mjs
 */
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, PRODUCTS_PATH, WEB_PRODUCTS_PATH, DEFAULTS_PATH } from "./paths.mjs";

function toSlim(raw) {
  const values = Array.isArray(raw) ? raw : Object.values(raw);
  return values
    .filter((p) => p && !p.missing)
    .map((p) => ({
      sku: p.sku,
      title: p.title,
      brand: p.brand,
      imageUrl: p.imageUrl ?? null,
      categories: p.categories ?? [],
      nutritionBasis: p.nutritionBasis,
      energyKcal: p.energyKcal,
      protein: p.protein,
      fat: p.fat,
      carbs: p.carbs,
      fibre: p.fibre,
      sugars: p.sugars,
      salt: p.salt,
      price: p.price,
      unitPrice: p.unitPrice ?? null,
      unitOfMeasure: p.unitOfMeasure ?? null,
    }));
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

const src = PRODUCTS_PATH;
if (!(await exists(src))) {
  console.error(`No scrape data at ${src}. Run: npm run scrape`);
  process.exitCode = 1;
  process.exit();
}

const raw = JSON.parse(await readFile(src, "utf8"));
const slim = toSlim(raw);

await mkdir(DATA_DIR, { recursive: true });
await writeFile(WEB_PRODUCTS_PATH, JSON.stringify(slim));
console.log(`Wrote ${slim.length} products → ${WEB_PRODUCTS_PATH}`);

// Local Vite public folder (skipped in Docker when web/public is absent).
const localPublic = path.resolve("web", "public", "products.json");
try {
  await mkdir(path.dirname(localPublic), { recursive: true });
  await writeFile(localPublic, JSON.stringify(slim));
  console.log(`Wrote ${slim.length} products → ${localPublic}`);
} catch {
  // ignore
}

// Also write a defaults copy when requested (release packaging).
if (process.argv.includes("--defaults")) {
  const dest = DEFAULTS_PATH;
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, JSON.stringify(slim));
  console.log(`Wrote ${slim.length} products → ${dest}`);
}
