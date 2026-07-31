/**
 * Fetch nutrition for SKUs, including multipack flavour tables that basketeer
 * does not request (details.nutrition is often empty for selection boxes).
 *
 * For multipacks we average per-100g macros across flavours that publish a table.
 */
import { PUBLIC_API_KEY, ENDPOINT, MAX_PRODUCT_BATCH_SIZE } from "basketeer";
import { extractMacros, parseNutritionRows } from "./nutrition.mjs";

const NUTRITION_FIELDS = `
  tpnc tpnb title brandName defaultImageUrl isForSale
  price { actual unitPrice unitOfMeasure }
  details {
    packSize { value units }
    nutrition { name value1 value2 value3 value4 }
    ingredients
  }
  multiPackDetails {
    name
    nutritionInfo { name value1 value2 value3 value4 }
  }
`.trim();

function buildQuery(count) {
  const variables = Array.from(
    { length: count },
    (_, i) => `$tpnc${i}: String!`,
  ).join(", ");
  const products = Array.from(
    { length: count },
    (_, i) => `p${i}: product(tpnc: $tpnc${i}) { ${NUTRITION_FIELDS} }`,
  ).join("\n  ");
  return `query GetProductsNutrition(${variables}) {\n  ${products}\n}`;
}

function rowsFromNutritionInfo(info) {
  return (info ?? []).map((r) => ({
    name: typeof r.name === "string" ? r.name.trim() : r.name,
    value1:
      typeof r.value1 === "string" ? r.value1.trim() : (r.value1 ?? null),
    value2:
      typeof r.value2 === "string" ? r.value2.trim() : (r.value2 ?? null),
    value3:
      typeof r.value3 === "string" ? r.value3.trim() : (r.value3 ?? null),
  }));
}

function averageMacros(list) {
  if (!list.length) return null;
  const keys = [
    "energyKcal",
    "energyKj",
    "protein",
    "fat",
    "saturates",
    "carbs",
    "sugars",
    "fibre",
    "salt",
  ];
  const out = {};
  let basis = "unknown";
  for (const key of keys) {
    const nums = list
      .map((x) => x.macros[key])
      .filter((v) => typeof v === "number");
    out[key] = nums.length
      ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100
      : null;
  }
  for (const x of list) {
    if (x.basis && x.basis !== "unknown") {
      basis = x.basis;
      break;
    }
  }
  return { basis, macros: out };
}

/**
 * Prefer classic details.nutrition; else average multipack flavour tables.
 * @returns {{ nutritionBasis: string|null, energyKcal: number|null, protein: number|null, ... }}
 */
export function macrosFromProductNode(node) {
  if (!node) {
    return extractMacros(null);
  }

  const classic = node.details?.nutrition ?? [];
  if (Array.isArray(classic) && classic.length) {
    return extractMacros({
      nutrition: { raw: classic },
      raw: { details: { nutrition: classic } },
    });
  }

  const packs = node.multiPackDetails ?? [];
  const parsed = [];
  for (const pack of packs) {
    const rows = rowsFromNutritionInfo(pack.nutritionInfo);
    const p = parseNutritionRows(rows);
    if (
      p &&
      typeof p.macros.energyKcal === "number" &&
      typeof p.macros.protein === "number"
    ) {
      parsed.push(p);
    }
  }

  if (parsed.length) {
    const avg = averageMacros(parsed);
    return {
      nutritionBasis: avg.basis !== "unknown" ? avg.basis : "per_100g",
      multipackAverage: true,
      multipackFlavours: packs.map((p) => p.name).filter(Boolean),
      ...avg.macros,
    };
  }

  return extractMacros({
    nutrition: { raw: classic },
    raw: { details: { nutrition: classic } },
  });
}

/**
 * @param {string[]} skus
 * @returns {Promise<Map<string, { node: object, macros: object }>>}
 */
export async function fetchProductsNutrition(skus) {
  /** @type {Map<string, { node: object, macros: object }>} */
  const out = new Map();
  const unique = [...new Set(skus.filter(Boolean))];

  for (let i = 0; i < unique.length; i += MAX_PRODUCT_BATCH_SIZE) {
    const batch = unique.slice(i, i + MAX_PRODUCT_BATCH_SIZE);
    const variables = Object.fromEntries(
      batch.map((sku, idx) => [`tpnc${idx}`, sku]),
    );
    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-apikey": PUBLIC_API_KEY,
        "x-mfe-name": "mfe-pdp",
        origin: "https://www.tesco.com",
        referer: "https://www.tesco.com/",
        "x-tesco-operation-name": "GetProductsNutrition",
      },
      body: JSON.stringify({
        operationName: "GetProductsNutrition",
        query: buildQuery(batch.length),
        variables,
      }),
    });
    const j = await r.json();
    // Partial failures: some aliases may be null; don't throw on mixed errors.
    for (let idx = 0; idx < batch.length; idx++) {
      const node = j.data?.[`p${idx}`];
      if (!node?.tpnc) continue;
      out.set(String(node.tpnc), {
        node,
        macros: macrosFromProductNode(node),
      });
    }
  }

  return out;
}
