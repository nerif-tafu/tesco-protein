/**
 * Scrape Tesco category catalogues + on-pack macros via the public GraphQL
 * gateway (basketeer). Walks every leaf aisle under the grocery roots (from
 * Query.taxonomy) — top-level department browse alone is incomplete.
 *
 * Resumable: re-running skips SKUs already in the output.
 *
 * Usage:
 *   npm run scrape
 *   npm run scrape -- --max-pages 10
 *   npm run scrape -- --categories "Food Cupboard,Drinks"
 *   npm run scrape -- --refresh-taxonomy
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Basketeer, MAX_PRODUCT_BATCH_SIZE } from "basketeer";
import {
  PRODUCTS_PATH,
  INDEX_PATH,
  BROWSE_INDEX_PATH,
} from "./scripts/paths.mjs";
import { extractMacros } from "./scripts/nutrition.mjs";
import { ROOTS } from "./scripts/facets.mjs";
import { loadOrFetchTaxonomy } from "./scripts/fetch-taxonomy.mjs";
import { fetchProductsNutrition } from "./scripts/fetch-product-nutrition.mjs";

const CATEGORIES = ROOTS;
const PAGE_SIZE = 48;
const BROWSE_SAVE_EVERY = 50;

function parseArgs(argv) {
  const args = {
    maxPages: Infinity,
    categories: null,
    refreshTaxonomy: false,
    freshBrowse: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--max-pages") args.maxPages = Number(argv[++i]);
    else if (a.startsWith("--categories=")) args.categories = a.slice("--categories=".length);
    else if (a === "--categories") {
      const parts = [];
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) parts.push(argv[++i]);
      args.categories = parts.join(" ");
    } else if (a === "--refresh-taxonomy") args.refreshTaxonomy = true;
    else if (a === "--fresh-browse") args.freshBrowse = true;
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

function pickCategories(filter) {
  if (!filter) return CATEGORIES;
  const wanted = new Set(
    filter
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
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

function toRecord(node, categories, nutrition) {
  const macros = nutrition ?? extractMacros({ raw: { details: node?.details } });
  const hasMacros =
    macros.energyKcal != null && macros.protein != null;
  return {
    sku: node.tpnc ?? node.sku,
    tpnb: node.tpnb ?? null,
    title: node.title,
    brand: node.brandName ?? node.brand ?? null,
    imageUrl: node.defaultImageUrl ?? node.imageUrl ?? null,
    price: node.price?.actual ?? null,
    unitPrice: node.price?.unitPrice ?? null,
    unitOfMeasure: node.price?.unitOfMeasure ?? null,
    available: node.isForSale ?? node.available ?? null,
    categories: [...categories].sort(),
    nutritionBasis: macros.nutritionBasis,
    energyKcal: macros.energyKcal,
    energyKj: macros.energyKj,
    protein: macros.protein,
    fat: macros.fat,
    saturates: macros.saturates,
    carbs: macros.carbs,
    sugars: macros.sugars,
    fibre: macros.fibre,
    salt: macros.salt,
    multipackAverage: macros.multipackAverage || undefined,
    multipackFlavours: macros.multipackFlavours || undefined,
    nutritionChecked: hasMacros,
    scrapedAt: new Date().toISOString(),
  };
}

function serializeBrowse(bySku) {
  /** @type {Record<string, { title: string, categories: string[] }>} */
  const out = {};
  for (const [sku, meta] of bySku) {
    out[sku] = {
      title: meta.title,
      categories: [...meta.categories].sort(),
    };
  }
  return out;
}

function restoreBrowse(raw) {
  /** @type {Map<string, { sku: string, title: string, categories: Set<string> }>} */
  const bySku = new Map();
  for (const [sku, meta] of Object.entries(raw ?? {})) {
    bySku.set(sku, {
      sku,
      title: meta.title,
      categories: new Set(meta.categories ?? []),
    });
  }
  return bySku;
}

async function saveBrowseProgress(bySku, aisleIndex, targetsLen, roots) {
  await saveJson(BROWSE_INDEX_PATH, {
    updatedAt: new Date().toISOString(),
    aisleIndex,
    targetsLen,
    roots: [...roots],
    count: bySku.size,
    bySku: serializeBrowse(bySku),
  });
}

/**
 * Browse every leaf aisle under the selected department roots.
 * Products are tagged with the root department name (e.g. "Food Cupboard").
 * Empty / broken aisles (GraphQL `product-not-found`) are skipped.
 */
async function collectSkus(client, categories, leaves, maxPages, { freshBrowse }) {
  const wantedRoots = new Set(categories.map((c) => c.name));
  const targets = leaves.filter((n) => wantedRoots.has(n.names[0]));
  const rootKey = [...wantedRoots].sort().join("|");

  let startIdx = 0;
  /** @type {Map<string, { sku: string, title: string, categories: Set<string> }>} */
  let bySku = new Map();

  if (!freshBrowse) {
    const prev = await loadJson(BROWSE_INDEX_PATH, null);
    if (
      prev?.bySku &&
      prev.targetsLen === targets.length &&
      (prev.roots ?? []).join("|") === rootKey &&
      Number(prev.aisleIndex) > 0 &&
      Number(prev.aisleIndex) < targets.length
    ) {
      bySku = restoreBrowse(prev.bySku);
      startIdx = Number(prev.aisleIndex);
      console.log(
        `\nResuming browse from aisle ${startIdx + 1}/${targets.length} ` +
          `(${bySku.size} SKUs cached in ${BROWSE_INDEX_PATH})`,
      );
    }
  }

  if (startIdx === 0) {
    console.log(
      `\nBrowsing ${targets.length} leaf aisles under ${[...wantedRoots].join(", ")}…`,
    );
  }

  for (let aisleIdx = startIdx; aisleIdx < targets.length; aisleIdx++) {
    const leaf = targets[aisleIdx];
    const n = aisleIdx + 1;
    const root = leaf.names[0];
    const label = leaf.names.join(" › ");
    let page = 1;
    let hasMore = true;
    let added = 0;
    let skipped = false;

    while (hasMore && page <= maxPages) {
      let result;
      try {
        result = await client.browseCategory(leaf.id, {
          limit: PAGE_SIZE,
          page,
        });
      } catch (err) {
        const msg = String(err?.message ?? err);
        // Empty / retired shelves often return this instead of an empty page.
        if (/product-not-found/i.test(msg)) {
          console.log(`  [${n}/${targets.length}] ${label}: skip (${msg})`);
          skipped = true;
          break;
        }
        throw err;
      }
      for (const item of result.results) {
        if (!item.sku) continue;
        const existing = bySku.get(item.sku);
        if (existing) existing.categories.add(root);
        else {
          bySku.set(item.sku, {
            sku: item.sku,
            title: item.title,
            categories: new Set([root]),
          });
          added++;
        }
      }
      hasMore = result.hasMore;
      page++;
    }

    if (!skipped && (n % 25 === 0 || n === targets.length || added > 0)) {
      console.log(
        `  [${n}/${targets.length}] ${label}: +${added} new` +
          (page - 1 > 1 ? ` (${page - 1} pages)` : "") +
          ` (unique ${bySku.size})`,
      );
    }
    if (!skipped && hasMore && page > maxPages) {
      console.log(`  stopped aisle early at --max-pages ${maxPages}: ${label}`);
    }

    if (n % BROWSE_SAVE_EVERY === 0 || n === targets.length) {
      await saveBrowseProgress(bySku, n, targets.length, wantedRoots);
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
      const fetched = await fetchProductsNutrition(batch);
      for (const sku of batch) {
        const hit = fetched.get(sku);
        const meta = bySku.get(sku);
        if (!hit) {
          productsBySku.set(sku, {
            sku,
            title: meta?.title ?? null,
            categories: [...(meta?.categories ?? [])].sort(),
            missing: true,
            scrapedAt: new Date().toISOString(),
          });
          failed++;
          continue;
        }
        productsBySku.set(
          sku,
          toRecord(hit.node, meta?.categories ?? new Set(), hit.macros),
        );
        ok++;
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
    console.log(
      `Usage: node scrape.mjs [--max-pages N] [--categories "A,B"] [--refresh-taxonomy] [--fresh-browse]`,
    );
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
      (Number.isFinite(args.maxPages)
        ? ` | max pages/aisle: ${args.maxPages}`
        : " | all pages"),
  );

  // Prefer committed catalogue when local data/ is empty or behind.
  try {
    const { spawnSync } = await import("node:child_process");
    spawnSync(process.execPath, ["scripts/seed-from-catalogue.mjs"], {
      stdio: "inherit",
    });
  } catch {
    /* catalogue optional */
  }

  const taxonomy = await loadOrFetchTaxonomy({ force: args.refreshTaxonomy });
  console.log(
    `Taxonomy: ${taxonomy.leaves.length} leaf aisles` +
      (taxonomy.updatedAt ? ` (updated ${taxonomy.updatedAt})` : ""),
  );

  const client = new Basketeer();
  const bySku = await collectSkus(
    client,
    categories,
    taxonomy.leaves,
    args.maxPages,
    { freshBrowse: args.freshBrowse },
  );

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
    const exported = spawnSync(
      process.execPath,
      ["scripts/export-web-data.mjs"],
      { stdio: "inherit" },
    );
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
