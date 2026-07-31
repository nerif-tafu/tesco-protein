/**
 * Re-fetch products missing kcal and/or protein that have not yet been
 * nutrition-checked, re-parse, rewrite data/products.json, and write an audit.
 *
 * Skips SKUs with `nutritionChecked: true` unless `--force` is passed.
 *
 * Usage:
 *   node scripts/repair-nutrition.mjs
 *   node scripts/repair-nutrition.mjs --force
 */
import { Basketeer, MAX_PRODUCT_BATCH_SIZE } from "basketeer";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { PRODUCTS_PATH, DATA_DIR } from "./paths.mjs";
import { extractMacros } from "./nutrition.mjs";

const AUDIT_PATH = path.join(DATA_DIR, "nutrition-audit.json");
const force = process.argv.includes("--force");

const products = JSON.parse(await readFile(PRODUCTS_PATH, "utf8"));
const needsRepair = Object.values(products).filter(
  (p) =>
    !p.missing &&
    p.sku &&
    (p.protein == null || p.energyKcal == null) &&
    (force || !p.nutritionChecked),
);

console.log(
  `Auditing/repairing ${needsRepair.length} products with missing macros` +
    (force ? " (--force)" : " (skipping nutritionChecked)") +
    "…",
);

if (!needsRepair.length) {
  console.log("Nothing to repair.");
  process.exit();
}

const client = new Basketeer();
const audit = {
  updatedAt: new Date().toISOString(),
  totalChecked: needsRepair.length,
  /** Had rows; parser now yields both kcal + protein. */
  parseFixed: [],
  /** No nutrition rows on the PDP at all. */
  noNutritionData: [],
  /** Has rows, but label never states kcal and/or protein (not a parse miss). */
  labelIncomplete: [],
  /** Has rows that look like they contain macros, but we still can't parse both. */
  stillParseFail: [],
  /** SKU disappeared from the API. */
  fetchMissing: [],
};

function rowLooksLikeMacro(rows) {
  return (rows ?? []).some((r) => {
    const n = String(r?.name ?? "");
    const v = String(r?.value1 ?? "");
    return /energy|kcal|protein|fat|carb|sugar|salt|fibre|fiber|trace|negligible/i.test(
      `${n} ${v}`,
    );
  });
}

function classify(existing, product, nutrition) {
  const rows = product?.nutrition?.raw ?? [];
  const entry = {
    sku: existing.sku,
    title: existing.title ?? product?.title ?? null,
    categories: existing.categories ?? [],
    before: { energyKcal: existing.energyKcal, protein: existing.protein },
    after: { energyKcal: nutrition.energyKcal, protein: nutrition.protein },
    rowCount: rows.length,
  };

  if (nutrition.protein != null && nutrition.energyKcal != null) {
    audit.parseFixed.push(entry);
    return "fixed";
  }
  if (!rows.length) {
    audit.noNutritionData.push(entry);
    return "none";
  }

  // Did the raw table mention the missing field(s)?
  const blob = rows
    .map((r) => `${r?.name ?? ""} ${r?.value1 ?? ""}`)
    .join("\n")
    .toLowerCase();
  const needsKcal = nutrition.energyKcal == null;
  const needsProt = nutrition.protein == null;
  const mentionsKcal = /kcal|energy/.test(blob);
  const mentionsProt = /protein|negligible/.test(blob);

  if (
    (needsKcal && mentionsKcal) ||
    (needsProt && mentionsProt && !/negligible amounts of/i.test(blob))
  ) {
    // Protein mentioned but not parsed — or energy mentioned but not parsed.
    // Negligible-amounts lines are handled; if still null after that, treat as incomplete.
    if (needsKcal && mentionsKcal) {
      audit.stillParseFail.push({
        ...entry,
        sampleRows: rows.slice(0, 12).map((r) => ({
          name: r.name,
          value1: r.value1,
        })),
      });
      return "parse_fail";
    }
  }

  if (!rowLooksLikeMacro(rows) && rows.length > 0) {
    audit.labelIncomplete.push(entry);
    return "incomplete";
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
      fetched = await client.getProducts(batch.map((p) => p.sku));
      break;
    } catch (err) {
      const msg = String(err?.message ?? err);
      if (attempt === 4) throw err;
      const wait = 1000 * attempt * attempt;
      console.warn(`  batch at ${i} failed (${msg.slice(0, 80)}…) — retry ${attempt}/3 in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  const bySku = new Map(fetched.map((p) => [p.sku, p]));

  for (const existing of batch) {
    const product = bySku.get(existing.sku);
    if (!product) {
      stillNull++;
      audit.fetchMissing.push({
        sku: existing.sku,
        title: existing.title,
      });
      continue;
    }
    const nutrition = extractMacros(product);
    const verdict = classify(existing, product, nutrition);
    const next = {
      ...existing,
      title: product.title ?? existing.title,
      brand: product.brand ?? existing.brand,
      price: product.price?.actual ?? existing.price ?? null,
      unitPrice: product.price?.unitPrice ?? existing.unitPrice ?? null,
      unitOfMeasure:
        product.price?.unitOfMeasure ?? existing.unitOfMeasure ?? null,
      available: product.available ?? existing.available,
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
      `  ${done}/${needsRepair.length} (parse-fixed ${fixed}, still incomplete ${stillNull})`,
    );
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(PRODUCTS_PATH, JSON.stringify(products, null, 2) + "\n");
  }
}

const summary = {
  totalChecked: audit.totalChecked,
  parseFixed: audit.parseFixed.length,
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
if (audit.stillParseFail.length) {
  console.log(`\nRemaining parse-fail samples:`);
  for (const e of audit.stillParseFail.slice(0, 8)) {
    console.log(`  - ${e.title} (${e.sku})`);
    console.log(`    rows: ${JSON.stringify(e.sampleRows)}`);
  }
}
console.log(`Next: npm run export-web && npm run export-defaults`);
