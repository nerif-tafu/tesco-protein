/**
 * Rank scraped Tesco products by vegetarian protein density (g protein / kcal).
 *
 * Usage:
 *   npm run rank
 *   npm run rank -- --min-kcal 20 --top 50 --csv
 *   npm run rank -- --vegan
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, PRODUCTS_PATH } from "./scripts/paths.mjs";

const OUT_JSON = path.join(DATA_DIR, "veggie-protein-rank.json");
const OUT_CSV = path.join(DATA_DIR, "veggie-protein-rank.csv");

/**
 * Title keywords that usually mean animal flesh / fish (not dairy/eggs).
 * Vegetarian = no meat/fish; vegan mode also drops dairy/egg terms.
 */
/** Animal flesh / fish markers. Generic "burger"/"sausage" omitted — plant versions are common. */
const MEAT_FISH = [
  "beef",
  "steak",
  "lamb",
  "mutton",
  "pork",
  "bacon",
  "ham ",
  " ham",
  "gammon",
  "salami",
  "pepperoni",
  "chorizo",
  "prosciutto",
  "pancetta",
  "pastrami",
  "krakowska",
  "kabanos",
  "chorizo",
  "sausage",
  "chicken",
  "turkey",
  "duck",
  "goose",
  "poultry",
  "meatball",
  "meat ball",
  "hot dog",
  "frankfurter",
  "liver",
  "kidney",
  "tripe",
  "oxtail",
  "venison",
  "rabbit",
  "rump",
  "sirloin",
  "brisket",
  "ribeye",
  "fillet steak",
  "wiejska",
  "kielbasa",
  "chorizo",
  "fish",
  "hake",
  "salmon",
  "tuna",
  "cod",
  "haddock",
  "mackerel",
  "sardine",
  "anchov",
  "prawn",
  "shrimp",
  "crab",
  "lobster",
  "mussel",
  "oyster",
  "clam",
  "scallop",
  "squid",
  "calamari",
  "seafood",
  "shellfish",
  "kipper",
  "whitebait",
  "pollock",
  "basa",
  "sea bass",
  "sea bream",
  "trout",
  "swordfish",
  "surimi",
  "plaice",
  "coleys",
  "coley",
  "seabass",
  "seabream",
  // Dried / cured / cuts that omit species in the title
  "biltong",
  "bresaola",
  "jerky",
  "sopocka",
  "speck",
  "coppa",
  "guanciale",
  "mortadella",
  "nduja",
  "loin",
  "breast",
  "thigh",
  "drumstick",
  "wing ",
  " wings",
  "slower grown",
  "wiltshire cured",
  "air dried",
  "air-dried",
  "cured beef",
  "dried beef",
  "beef jerky",
  "pork loin",
  "loin joint",
  "smoked loin",
  "diced breast",
  "mince beef",
  "beef mince",
  "lamb mince",
  "pork mince",
  "turkey mince",
  "chicken mince",
  "kebab",
  "spatchcock",
  "zywiecka",
  "podsuszana",
];

const DAIRY_EGG = [
  "milk",
  "cheese",
  "butter",
  "cream",
  "yoghurt",
  "yogurt",
  "fromage",
  "whey",
  "casein",
  "egg",
  "mayonnaise",
  "custard",
  "honey",
  "kvarg",
  "quark",
  "skyr",
  "lindahls",
  "ufit",
  "protein drink",
  "protein milkshake",
  "protein pudding",
  "milkshake",
  "curd",
  "cottage cheese",
  "greek recipe",
  "greek yogurt",
  "greek yoghurt",
];

/** Explicit plant / veggie markers — wins over meat-like words in the same title. */
const VEGGIE_ALLOW = [
  "plant chef",
  "plant-based",
  "plant based",
  "vegan",
  "vegetarian",
  "meat free",
  "meat-free",
  "meatless",
  "no chicken",
  "not chicken",
  "this isn't chicken",
  "this isnt chicken",
  "tofu",
  "tempeh",
  "seitan",
  "soya mince",
  "soy mince",
  "soya pieces",
  "textured vegetable",
  "tvp",
  "quorn",
  "linda mccartney",
  "beyond meat",
  "moving mountains",
  "wicked kitchen",
  "future farm",
  "the vegetarian butcher",
  "fry's",
  "frys",
  "oumph",
  "heura",
  "falafel",
  "hummus",
  "houmous",
];

function parseArgs(argv) {
  const args = {
    minKcal: 40,
    minProtein: 5,
    top: 40,
    csv: false,
    vegan: false,
    basis: "per_100", // prefer per_100g / per_100ml
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--min-kcal") args.minKcal = Number(argv[++i]);
    else if (a === "--min-protein") args.minProtein = Number(argv[++i]);
    else if (a === "--top") args.top = Number(argv[++i]);
    else if (a === "--csv") args.csv = true;
    else if (a === "--vegan") args.vegan = true;
    else if (a === "--any-basis") args.basis = "any";
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

function normalizeTitle(title) {
  return (title ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function includesAny(hay, needles) {
  return needles.some((n) => hay.includes(n));
}

function isVegetarianTitle(title, { vegan }) {
  const t = normalizeTitle(title);
  if (!t) return false;

  const allowed = includesAny(t, VEGGIE_ALLOW);
  if (!allowed && includesAny(t, MEAT_FISH)) return false;

  if (vegan) {
    if (t.includes("quorn") && !t.includes("vegan")) return false;
    if (isNonVeganDairyEgg(t)) return false;
  }
  return true;
}

function isNonVeganDairyEgg(t) {
  // Avoid flagging "buttermilk-style" plant products labelled vegan.
  if (t.includes("vegan") || t.includes("plant chef") || t.includes("plant-based") || t.includes("plant based")) {
    return false;
  }
  // Oat/soya "milk" drinks
  if (/\b(oat|soya|soy|almond|coconut|rice|hemp|pea|hazelnut)\b.*\b(milk|drink|yogurt|yoghurt)\b/.test(t)) {
    return false;
  }
  if (/\b(milk|drink|yogurt|yoghurt)\b.*\b(oat|soya|soy|almond|coconut|rice|hemp|pea|hazelnut)\b/.test(t)) {
    return false;
  }
  return includesAny(t, DAIRY_EGG);
}

function usableBasis(basis, mode) {
  if (mode === "any") return true;
  return basis === "per_100g" || basis === "per_100ml";
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node rank.mjs [--min-kcal 20] [--min-protein 1] [--top 40] [--vegan] [--csv] [--any-basis]`);
    return;
  }

  let products;
  try {
    products = Object.values(JSON.parse(await readFile(PRODUCTS_PATH, "utf8")));
  } catch (err) {
    if (err && err.code === "ENOENT") {
      console.error(`No data at ${PRODUCTS_PATH}. Run: npm run scrape`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const diet = args.vegan ? "vegan" : "vegetarian";
  const ranked = products
    .filter((p) => !p.missing)
    .filter((p) => isVegetarianTitle(p.title, { vegan: args.vegan }))
    .filter((p) => usableBasis(p.nutritionBasis, args.basis))
    .filter(
      (p) =>
        typeof p.energyKcal === "number" &&
        p.energyKcal >= args.minKcal &&
        typeof p.protein === "number" &&
        p.protein >= args.minProtein,
    )
    .filter((p) => {
      // Drop rows where macros can't possibly match labelled kcal (bad parse / mixed basis).
      const fat = typeof p.fat === "number" ? p.fat : 0;
      const carbs = typeof p.carbs === "number" ? p.carbs : 0;
      const estimated = p.protein * 4 + carbs * 4 + fat * 9;
      if (estimated <= 0) return true;
      const ratio = estimated / p.energyKcal;
      return ratio >= 0.55 && ratio <= 1.55;
    })
    .map((p) => {
      const proteinPerKcal = p.protein / p.energyKcal;
      const proteinPctOfCals = (p.protein * 4) / p.energyKcal; // Atwater approximation
      return {
        rank: 0,
        title: p.title,
        brand: p.brand,
        sku: p.sku,
        categories: p.categories,
        nutritionBasis: p.nutritionBasis,
        energyKcal: p.energyKcal,
        protein: p.protein,
        fat: p.fat,
        carbs: p.carbs,
        fibre: p.fibre,
        price: p.price,
        proteinPerKcal: Number(proteinPerKcal.toFixed(5)),
        proteinPctOfCalories: Number((proteinPctOfCals * 100).toFixed(1)),
        url: `https://www.tesco.com/groceries/en-GB/products/${p.sku}`,
      };
    })
    .sort((a, b) => b.proteinPerKcal - a.proteinPerKcal);

  ranked.forEach((row, i) => {
    row.rank = i + 1;
  });

  const top = ranked.slice(0, args.top);
  await mkdir(path.dirname(OUT_JSON), { recursive: true });
  await writeFile(
    OUT_JSON,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        diet,
        minKcal: args.minKcal,
        minProtein: args.minProtein,
        basis: args.basis,
        totalCandidates: ranked.length,
        results: ranked,
      },
      null,
      2,
    ) + "\n",
  );

  if (args.csv) {
    const header = [
      "rank",
      "title",
      "proteinPerKcal",
      "proteinPctOfCalories",
      "protein",
      "energyKcal",
      "fat",
      "carbs",
      "fibre",
      "nutritionBasis",
      "price",
      "sku",
      "url",
    ];
    const lines = [
      header.join(","),
      ...ranked.map((r) =>
        [
          r.rank,
          csvEscape(r.title),
          r.proteinPerKcal,
          r.proteinPctOfCalories,
          r.protein,
          r.energyKcal,
          r.fat,
          r.carbs,
          r.fibre,
          r.nutritionBasis,
          r.price,
          r.sku,
          r.url,
        ].join(","),
      ),
    ];
    await writeFile(OUT_CSV, lines.join("\n") + "\n");
  }

  console.log(
    `\nTop ${top.length} ${diet} protein sources by g protein / kcal` +
      ` (min ${args.minKcal} kcal, basis=${args.basis}, ${ranked.length} candidates):\n`,
  );
  for (const r of top) {
    console.log(
      `${String(r.rank).padStart(3)}. ${r.proteinPerKcal.toFixed(4)} g/kcal` +
        `  (${r.protein}g P / ${r.energyKcal} kcal, ${r.proteinPctOfCalories}% kcal from protein)` +
        `\n     ${r.title}` +
        `\n     fat ${r.fat ?? "?"}g  carbs ${r.carbs ?? "?"}g  [${r.nutritionBasis}]`,
    );
  }
  console.log(`\nFull list → ${OUT_JSON}${args.csv ? `\nCSV → ${OUT_CSV}` : ""}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
