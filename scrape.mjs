/**
 * Scrape Tesco category catalogues + on-pack macros via the public GraphQL
 * gateway (basketeer). Resumable: re-running skips SKUs already in the output.
 *
 * Usage:
 *   npm run scrape
 *   npm run scrape -- --max-pages 10
 *   npm run scrape -- --categories "Food Cupboard,Drinks"
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Basketeer, categoryFacet, MAX_PRODUCT_BATCH_SIZE } from "basketeer";
import { DATA_DIR, PRODUCTS_PATH, INDEX_PATH } from "./scripts/paths.mjs";

const OUT_DIR = DATA_DIR;

/** Maps user browse URLs → Tesco category facet department names. */
const CATEGORIES = [
  { name: "Fresh Food", slug: "fresh-food" },
  { name: "Bakery", slug: "bakery" },
  { name: "Frozen Food", slug: "frozen-food" },
  { name: "Treats & Snacks", slug: "treats-and-snacks" },
  { name: "Food Cupboard", slug: "food-cupboard" },
  { name: "Drinks", slug: "drinks" },
];

const PAGE_SIZE = 48;

function parseArgs(argv) {
  const args = { maxPages: Infinity, categories: null, delayMs: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--max-pages") args.maxPages = Number(argv[++i]);
    else if (a.startsWith("--categories=")) args.categories = a.slice("--categories=".length);
    else if (a === "--categories") {
      // Accept `--categories Food Cupboard,Drinks` (PowerShell-friendly).
      const parts = [];
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) parts.push(argv[++i]);
      args.categories = parts.join(" ");
    } else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

function pickCategories(filter) {
  if (!filter) return CATEGORIES;
  const wanted = new Set(
    filter.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
  return CATEGORIES.filter(
    (c) => wanted.has(c.name.toLowerCase()) || wanted.has(c.slug),
  );
}

async function loadJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    if (err && err.code === "ENOENT") return fallback;
    throw err;
  }
}

async function saveJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function toRecord(product, categories) {
  const macros = product.macros ?? {};
  return {
    sku: product.sku,
    tpnb: product.tpnb,
    title: product.title,
    brand: product.brand,
    imageUrl: product.imageUrl,
    price: product.price?.actual ?? null,
    unitPrice: product.price?.unitPrice ?? null,
    unitOfMeasure: product.price?.unitOfMeasure ?? null,
    available: product.available,
    categories: [...categories].sort(),
    nutritionBasis: product.nutrition?.basis ?? null,
    energyKcal: macros.energyKcal ?? null,
    energyKj: macros.energyKj ?? null,
    protein: macros.protein ?? null,
    fat: macros.fat ?? null,
    saturates: macros.saturates ?? null,
    carbs: macros.carbs ?? null,
    sugars: macros.sugars ?? null,
    fibre: macros.fibre ?? null,
    salt: macros.salt ?? null,
    scrapedAt: new Date().toISOString(),
  };
}

async function collectSkus(client, categories, maxPages) {
  /** @type {Map<string, { sku: string, title: string, categories: Set<string> }>} */
  const bySku = new Map();

  for (const cat of categories) {
    const facet = categoryFacet(cat.name);
    console.log(`\nBrowsing ${cat.name}…`);
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= maxPages) {
      const result = await client.browseCategory(facet, {
        limit: PAGE_SIZE,
        page,
      });
      for (const item of result.results) {
        if (!item.sku) continue;
        const existing = bySku.get(item.sku);
        if (existing) existing.categories.add(cat.name);
        else {
          bySku.set(item.sku, {
            sku: item.sku,
            title: item.title,
            categories: new Set([cat.name]),
          });
        }
      }
      hasMore = result.hasMore;
      console.log(
        `  page ${page}: +${result.results.length} (unique so far ${bySku.size})${hasMore ? "" : " [end]"}`,
      );
      page++;
    }
    if (hasMore && page > maxPages) {
      console.log(`  stopped at --max-pages ${maxPages}`);
    }
  }

  return bySku;
}

async function hydrateNutrition(client, bySku, productsBySku) {
  const pending = [...bySku.keys()].filter((sku) => !productsBySku.has(sku));
  console.log(
    `\nHydrating nutrition for ${pending.length} new SKUs ` +
      `(${productsBySku.size} already cached, batch size ${MAX_PRODUCT_BATCH_SIZE})…`,
  );

  let ok = 0;
  let failed = 0;
  for (let i = 0; i < pending.length; i += MAX_PRODUCT_BATCH_SIZE) {
    const batch = pending.slice(i, i + MAX_PRODUCT_BATCH_SIZE);
    try {
      const products = await client.getProducts(batch);
      const got = new Set(products.map((p) => p.sku));
      for (const product of products) {
        const meta = bySku.get(product.sku);
        productsBySku.set(
          product.sku,
          toRecord(product, meta?.categories ?? new Set()),
        );
        ok++;
      }
      for (const sku of batch) {
        if (!got.has(sku)) {
          // Discontinued / missing — remember so we don't retry forever.
          const meta = bySku.get(sku);
          productsBySku.set(sku, {
            sku,
            title: meta?.title ?? null,
            categories: [...(meta?.categories ?? [])].sort(),
            missing: true,
            scrapedAt: new Date().toISOString(),
          });
          failed++;
        }
      }
    } catch (err) {
      console.error(`  batch failed at offset ${i}: ${err.message ?? err}`);
      throw err;
    }

    const done = Math.min(i + batch.length, pending.length);
    if (done % 75 < MAX_PRODUCT_BATCH_SIZE || done === pending.length) {
      console.log(`  ${done}/${pending.length} fetched (${ok} ok, ${failed} missing)`);
      await saveJson(PRODUCTS_PATH, Object.fromEntries(productsBySku));
      await saveJson(INDEX_PATH, {
        updatedAt: new Date().toISOString(),
        count: productsBySku.size,
        skus: [...productsBySku.keys()],
      });
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node scrape.mjs [--max-pages N] [--categories "A,B"]`);
    console.log(`Categories: ${CATEGORIES.map((c) => c.name).join(", ")}`);
    return;
  }

  const categories = pickCategories(args.categories);
  if (!categories.length) {
    console.error("No matching categories. Use names from --help.");
    process.exitCode = 1;
    return;
  }

  console.log(
    `Categories: ${categories.map((c) => c.name).join(", ")}` +
      (Number.isFinite(args.maxPages) ? ` | max pages/category: ${args.maxPages}` : " | all pages"),
  );

  const client = new Basketeer();
  const bySku = await collectSkus(client, categories, args.maxPages);

  // Merge category tags into any already-cached products that reappear.
  const cached = await loadJson(PRODUCTS_PATH, {});
  /** @type {Map<string, object>} */
  const productsBySku = new Map(Object.entries(cached));
  for (const [sku, meta] of bySku) {
    const existing = productsBySku.get(sku);
    if (!existing) continue;
    const merged = new Set([
      ...(existing.categories ?? []),
      ...meta.categories,
    ]);
    existing.categories = [...merged].sort();
    if (!existing.title && meta.title) existing.title = meta.title;
  }

  await hydrateNutrition(client, bySku, productsBySku);

  await saveJson(PRODUCTS_PATH, Object.fromEntries(productsBySku));
  await saveJson(INDEX_PATH, {
    updatedAt: new Date().toISOString(),
    count: productsBySku.size,
    skus: [...productsBySku.keys()],
  });

  const withMacros = [...productsBySku.values()].filter(
    (p) => p.energyKcal != null && p.protein != null,
  ).length;
  console.log(
    `\nDone. ${productsBySku.size} products saved → ${PRODUCTS_PATH}` +
      ` (${withMacros} with usable kcal+protein).`,
  );
  try {
    const { spawnSync } = await import("node:child_process");
    const exported = spawnSync(process.execPath, ["scripts/export-web-data.mjs"], {
      stdio: "inherit",
    });
    if (exported.status !== 0) {
      console.warn("Web export skipped/failed — run: npm run export-web");
    }
  } catch {
    console.warn("Web export skipped — run: npm run export-web");
  }
  console.log(`Rank: npm run rank  |  UI: npm run dev`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
