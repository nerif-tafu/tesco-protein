/**
 * Re-fetch products missing kcal and/or protein that have not yet been
 * nutrition-checked (includes multipack flavour tables).
 *
 * Skips SKUs with `nutritionChecked: true` unless `--force` or
 * `--recheck-empty` is passed.
 *
 * Usage:
 *   node scripts/repair-nutrition.mjs
 *   node scripts/repair-nutrition.mjs --recheck-empty
 *   node scripts/repair-nutrition.mjs --force
 */
import { MAX_PRODUCT_BATCH_SIZE } from "basketeer";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { PRODUCTS_PATH, DATA_DIR } from "./paths.mjs";
import { fetchProductsNutrition } from "./fetch-product-nutrition.mjs";

const AUDIT_PATH = path.join(DATA_DIR, "nutrition-audit.json");
const force = process.argv.includes("--force");
const recheckEmpty = process.argv.includes("--recheck-empty");

const products = JSON.parse(await readFile(PRODUCTS_PATH, "utf8"));
const needsRepair = Object.values(products).filter((p) => {
  if (p.missing || !p.sku) return false;
  if (p.protein != null && p.energyKcal != null) return false;
  if (force || recheckEmpty) return true;
  return !p.nutritionChecked;
});

console.log(
  `Auditing/repairing ${needsRepair.length} products with missing macros` +
    (force
      ? " (--force)"
      : recheckEmpty
        ? " (--recheck-empty)"
        : " (skipping nutritionChecked)") +
    "…",
);

if (!needsRepair.length) {
  console.log("Nothing to repair.");
  process.exit();
}

const audit = {
  updatedAt: new Date().toISOString(),
  totalChecked: needsRepair.length,
  parseFixed: [],
  noNutritionData: [],
  labelIncomplete: [],
  stillParseFail: [],
  fetchMissing: [],
  multipackFixed: [],
};

function classify(existing, node, nutrition) {
  const classic = node?.details?.nutrition ?? [];
  const packs = node?.multiPackDetails ?? [];
  const packRows = packs.flatMap((p) => p.nutritionInfo ?? []);
  const rows = classic.length ? classic : packRows;
  const entry = {
    sku: existing.sku,
    title: existing.title ?? node?.title ?? null,
    categories: existing.categories ?? [],
    before: { energyKcal: existing.energyKcal, protein: existing.protein },
    after: { energyKcal: nutrition.energyKcal, protein: nutrition.protein },
    rowCount: rows.length,
    multipackAverage: Boolean(nutrition.multipackAverage),
  };

  if (nutrition.protein != null && nutrition.energyKcal != null) {
    if (nutrition.multipackAverage) audit.multipackFixed.push(entry);
    else audit.parseFixed.push(entry);
    return "fixed";
  }
  if (!rows.length) {
    audit.noNutritionData.push(entry);
    return "none";
  }
  audit.labelIncomplete.push(entry);
  return "incomplete";
}

let fixed = 0;
let stillNull = 0;

for (let i = 0; i < needsRepair.length; i += MAX_PRODUCT_BATCH_SIZE) {
  const batch = needsRepair.slice(i, i + MAX_PRODUCT_BATCH_SIZE);
  let fetched;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      fetched = await fetchProductsNutrition(batch.map((p) => p.sku));
      break;
    } catch (err) {
      const msg = String(err?.message ?? err);
      if (attempt === 4) throw err;
      const wait = 1000 * attempt * attempt;
      console.warn(
        `  batch at ${i} failed (${msg.slice(0, 80)}…) — retry ${attempt}/3 in ${wait}ms`,
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  for (const existing of batch) {
    const hit = fetched.get(existing.sku);
    if (!hit) {
      stillNull++;
      audit.fetchMissing.push({ sku: existing.sku, title: existing.title });
      products[existing.sku] = {
        ...existing,
        nutritionChecked: true,
        scrapedAt: new Date().toISOString(),
      };
      continue;
    }

    const nutrition = hit.macros;
    const verdict = classify(existing, hit.node, nutrition);
    const next = {
      ...existing,
      title: hit.node.title ?? existing.title,
      brand: hit.node.brandName ?? existing.brand,
      price: hit.node.price?.actual ?? existing.price ?? null,
      unitPrice: hit.node.price?.unitPrice ?? existing.unitPrice ?? null,
      unitOfMeasure:
        hit.node.price?.unitOfMeasure ?? existing.unitOfMeasure ?? null,
      available: hit.node.isForSale ?? existing.available,
      nutritionBasis: nutrition.nutritionBasis ?? existing.nutritionBasis,
      energyKcal: nutrition.energyKcal,
      energyKj: nutrition.energyKj,
      protein: nutrition.protein,
      fat: nutrition.fat,
      saturates: nutrition.saturates,
      carbs: nutrition.carbs,
      sugars: nutrition.sugars,
      fibre: nutrition.fibre,
      salt: nutrition.salt,
      multipackAverage: nutrition.multipackAverage || undefined,
      multipackFlavours: nutrition.multipackFlavours || undefined,
      nutritionChecked: true,
      scrapedAt: new Date().toISOString(),
    };
    products[existing.sku] = next;
    if (verdict === "fixed") fixed++;
    else stillNull++;
  }

  const done = Math.min(i + batch.length, needsRepair.length);
  if (done % 150 < MAX_PRODUCT_BATCH_SIZE || done === needsRepair.length) {
    console.log(
      `  ${done}/${needsRepair.length} (fixed ${fixed}, still incomplete ${stillNull})`,
    );
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(PRODUCTS_PATH, JSON.stringify(products, null, 2) + "\n");
  }
}

const summary = {
  totalChecked: audit.totalChecked,
  parseFixed: audit.parseFixed.length,
  multipackFixed: audit.multipackFixed.length,
  noNutritionData: audit.noNutritionData.length,
  labelIncomplete: audit.labelIncomplete.length,
  stillParseFail: audit.stillParseFail.length,
  fetchMissing: audit.fetchMissing.length,
};

await mkdir(DATA_DIR, { recursive: true });
await writeFile(PRODUCTS_PATH, JSON.stringify(products, null, 2) + "\n");
await writeFile(
  AUDIT_PATH,
  JSON.stringify({ ...audit, summary }, null, 2) + "\n",
);

console.log(`\nDone.`);
console.log(summary);
console.log(`Audit → ${AUDIT_PATH}`);
if (audit.multipackFixed.length) {
  console.log(`\nMultipack averages (sample):`);
  for (const e of audit.multipackFixed.slice(0, 5)) {
    console.log(
      `  - ${e.title}: ${e.after.protein}g P / ${e.after.energyKcal} kcal`,
    );
  }
}
console.log(`Next: npm run sync-catalogue`);
