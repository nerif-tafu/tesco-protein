export type Diet = "all" | "vegetarian" | "vegan";

export type SortKey =
  | "proteinPerKcal"
  | "proteinPct"
  | "protein"
  | "energyKcal"
  | "price"
  | "pricePerProtein";

export interface Product {
  sku: string;
  title: string;
  brand: string | null;
  categories: string[];
  nutritionBasis: string | null;
  energyKcal: number | null;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
  fibre: number | null;
  sugars: number | null;
  salt: number | null;
  price: number | null;
  unitPrice?: number | null;
  unitOfMeasure?: string | null;
}

export interface RankedProduct extends Product {
  rank: number;
  proteinPerKcal: number;
  proteinPctOfCalories: number;
  /** £ per gram of protein, derived from unit price + per-100 macros. Null if unknown. */
  pricePerProtein: number | null;
  url: string;
}

export interface AdvancedSearch {
  include: string;
  exclude: string;
  brand: string;
  matchMode: "all" | "any";
  maxFat: number | null;
  maxCarbs: number | null;
  maxSugars: number | null;
  maxSalt: number | null;
  minFibre: number | null;
  maxPrice: number | null;
  /** Max £ per gram of protein (lower = cheaper protein). */
  maxPricePerProtein: number | null;
  /** Minimum share of energy from protein, as a percent (e.g. 30 = 30%). */
  minProteinPct: number | null;
  requirePricePerProtein: boolean;
}

export interface RankOptions {
  diet: Diet;
  minKcal: number;
  minProtein: number;
  categories: string[];
  query: string;
  sort: SortKey;
  sortDir: "asc" | "desc";
  excludeCondiments: boolean;
  advanced: AdvancedSearch;
}

const MEAT_FISH = [
  "beef", "steak", "lamb", "mutton", "pork", "bacon", "ham ", " ham", "gammon",
  "salami", "pepperoni", "chorizo", "prosciutto", "pancetta", "pastrami",
  "krakowska", "kabanos", "sausage", "chicken", "turkey", "duck", "goose",
  "poultry", "meatball", "meat ball", "hot dog", "frankfurter", "liver",
  "kidney", "tripe", "oxtail", "venison", "rabbit", "rump", "sirloin",
  "brisket", "ribeye", "fillet steak", "wiejska", "kielbasa", "fish", "hake",
  "salmon", "tuna", "cod", "haddock", "mackerel", "sardine", "anchov", "prawn",
  "shrimp", "crab", "lobster", "mussel", "oyster", "clam", "scallop", "squid",
  "calamari", "seafood", "shellfish", "kipper", "whitebait", "pollock", "basa",
  "sea bass", "sea bream", "trout", "swordfish", "surimi", "plaice", "coleys",
  "coley", "seabass", "seabream",
];

const DAIRY_EGG = [
  "milk", "cheese", "butter", "cream", "yoghurt", "yogurt", "fromage", "whey",
  "casein", "egg", "mayonnaise", "custard", "honey", "kvarg", "quark", "skyr",
  "lindahls", "ufit", "protein drink", "protein milkshake", "protein pudding",
  "milkshake", "curd", "cottage cheese", "greek recipe", "greek yogurt",
  "greek yoghurt",
];

const VEGGIE_ALLOW = [
  "plant chef", "plant-based", "plant based", "vegan", "vegetarian",
  "meat free", "meat-free", "meatless", "no chicken", "not chicken",
  "this isn't chicken", "this isnt chicken", "tofu", "tempeh", "seitan",
  "soya mince", "soy mince", "soya pieces", "textured vegetable", "tvp",
  "quorn", "linda mccartney", "beyond meat", "moving mountains",
  "wicked kitchen", "future farm", "the vegetarian butcher", "fry's", "frys",
  "oumph", "heura", "falafel", "hummus", "houmous",
];

const CONDIMENT = [
  "seasoning", "soy sauce", "tamari", "liquid seasoning", "yeast extract",
  "vegemite", "marmite", "stock cube", "bouillon", "gravy", "mustard",
  "ketchup", "hot sauce", "chilli sauce", "dried yeast", "baking powder",
];

export const DEFAULT_ADVANCED: AdvancedSearch = {
  include: "",
  exclude: "",
  brand: "",
  matchMode: "all",
  maxFat: null,
  maxCarbs: null,
  maxSugars: null,
  maxSalt: null,
  minFibre: null,
  maxPrice: null,
  maxPricePerProtein: null,
  minProteinPct: null,
  requirePricePerProtein: false,
};

function normalizeTitle(title: string) {
  return (title ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function includesAny(hay: string, needles: string[]) {
  return needles.some((n) => hay.includes(n));
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function isNonVeganDairyEgg(t: string) {
  if (
    t.includes("vegan") ||
    t.includes("plant chef") ||
    t.includes("plant-based") ||
    t.includes("plant based")
  ) {
    return false;
  }
  if (
    /\b(oat|soya|soy|almond|coconut|rice|hemp|pea|hazelnut)\b.*\b(milk|drink|yogurt|yoghurt)\b/.test(
      t,
    )
  ) {
    return false;
  }
  if (
    /\b(milk|drink|yogurt|yoghurt)\b.*\b(oat|soya|soy|almond|coconut|rice|hemp|pea|hazelnut)\b/.test(
      t,
    )
  ) {
    return false;
  }
  return includesAny(t, DAIRY_EGG);
}

export function passesDiet(title: string, diet: Diet): boolean {
  if (diet === "all") return true;
  const t = normalizeTitle(title);
  if (!t) return false;
  const allowed = includesAny(t, VEGGIE_ALLOW);
  if (!allowed && includesAny(t, MEAT_FISH)) return false;
  if (diet === "vegan") {
    if (t.includes("quorn") && !t.includes("vegan")) return false;
    if (isNonVeganDairyEgg(t)) return false;
  }
  return true;
}

function macrosMatchKcal(p: Product): boolean {
  if (typeof p.energyKcal !== "number" || typeof p.protein !== "number") {
    return false;
  }
  const fat = typeof p.fat === "number" ? p.fat : 0;
  const carbs = typeof p.carbs === "number" ? p.carbs : 0;
  const estimated = p.protein * 4 + carbs * 4 + fat * 9;
  if (estimated <= 0) return true;
  const ratio = estimated / p.energyKcal;
  return ratio >= 0.55 && ratio <= 1.55;
}

/**
 * £ per gram of protein using Tesco unit price.
 * For kg/litre: cost of 100g/ml = unitPrice/10, so £/g protein = unitPrice/(10*protein).
 */
export function pricePerGramProtein(p: Product): number | null {
  if (typeof p.protein !== "number" || p.protein <= 0) return null;
  if (typeof p.unitPrice !== "number" || p.unitPrice <= 0) return null;
  const uom = (p.unitOfMeasure ?? "").toLowerCase();
  const basis = p.nutritionBasis;

  const weightLike =
    uom.includes("kg") || uom === "100g" || uom.includes("kg dr");
  const volumeLike =
    uom.includes("litre") || uom === "100ml" || uom.includes("liter");

  if (weightLike && (basis === "per_100g" || !basis)) {
    return p.unitPrice / (10 * p.protein);
  }
  if (volumeLike && (basis === "per_100ml" || !basis)) {
    return p.unitPrice / (10 * p.protein);
  }
  if (uom === "100g" || uom === "100ml") {
    return p.unitPrice / p.protein;
  }
  return null;
}

function passesAdvanced(
  p: Product,
  pricePerProtein: number | null,
  proteinPctOfCalories: number,
  adv: AdvancedSearch,
): boolean {
  const title = normalizeTitle(p.title);
  const brand = (p.brand ?? "").toLowerCase();
  const hay = `${title} ${brand}`;

  const includeTokens = tokenize(adv.include);
  if (includeTokens.length) {
    const ok =
      adv.matchMode === "all"
        ? includeTokens.every((t) => hay.includes(t))
        : includeTokens.some((t) => hay.includes(t));
    if (!ok) return false;
  }

  const excludeTokens = tokenize(adv.exclude);
  if (excludeTokens.some((t) => hay.includes(t))) return false;

  if (adv.brand.trim()) {
    const b = adv.brand.trim().toLowerCase();
    if (!brand.includes(b) && !title.includes(b)) return false;
  }

  const numOk = (value: number | null | undefined, max: number | null, mode: "max" | "min") => {
    if (max == null) return true;
    if (typeof value !== "number") return false;
    return mode === "max" ? value <= max : value >= max;
  };

  if (!numOk(p.fat, adv.maxFat, "max")) return false;
  if (!numOk(p.carbs, adv.maxCarbs, "max")) return false;
  if (!numOk(p.sugars, adv.maxSugars, "max")) return false;
  if (!numOk(p.salt, adv.maxSalt, "max")) return false;
  if (!numOk(p.fibre, adv.minFibre, "min")) return false;
  if (!numOk(p.price, adv.maxPrice, "max")) return false;

  if (adv.minProteinPct != null) {
    const pct = proteinPctOfCalories * 100;
    if (pct < adv.minProteinPct) return false;
  }

  if (adv.requirePricePerProtein && pricePerProtein == null) return false;
  if (
    adv.maxPricePerProtein != null &&
    (pricePerProtein == null || pricePerProtein > adv.maxPricePerProtein)
  ) {
    return false;
  }

  return true;
}

function sortValue(item: RankedProduct, key: SortKey): number {
  switch (key) {
    case "proteinPct":
      return item.proteinPctOfCalories;
    case "proteinPerKcal":
      return item.proteinPerKcal;
    case "pricePerProtein":
      return item.pricePerProtein ?? Number.POSITIVE_INFINITY;
    case "protein":
      return item.protein ?? Number.NEGATIVE_INFINITY;
    case "energyKcal":
      return item.energyKcal ?? Number.POSITIVE_INFINITY;
    case "price":
      return item.price ?? Number.POSITIVE_INFINITY;
    default:
      return Number.NEGATIVE_INFINITY;
  }
}

export function rankProducts(
  products: Product[],
  opts: RankOptions,
): RankedProduct[] {
  const q = opts.query.trim().toLowerCase();
  const catSet = new Set(opts.categories);

  const filtered = products.filter((p) => {
    if (typeof p.energyKcal !== "number" || typeof p.protein !== "number") {
      return false;
    }
    if (p.energyKcal < opts.minKcal || p.protein < opts.minProtein) return false;
    if (p.nutritionBasis !== "per_100g" && p.nutritionBasis !== "per_100ml") {
      return false;
    }
    if (!macrosMatchKcal(p)) return false;
    if (!passesDiet(p.title, opts.diet)) return false;
    if (opts.excludeCondiments && includesAny(normalizeTitle(p.title), CONDIMENT)) {
      return false;
    }
    if (catSet.size && !p.categories.some((c) => catSet.has(c))) return false;
    if (q && !p.title.toLowerCase().includes(q) && !(p.brand ?? "").toLowerCase().includes(q)) {
      return false;
    }

    const ppp = pricePerGramProtein(p);
    const proteinPctOfCalories = (p.protein * 4) / p.energyKcal;
    if (!passesAdvanced(p, ppp, proteinPctOfCalories, opts.advanced)) return false;
    return true;
  });

  const ranked: RankedProduct[] = filtered.map((p) => {
    const proteinPerKcal = (p.protein as number) / (p.energyKcal as number);
    const proteinPctOfCalories =
      ((p.protein as number) * 4) / (p.energyKcal as number);
    return {
      ...p,
      rank: 0,
      proteinPerKcal,
      proteinPctOfCalories,
      pricePerProtein: pricePerGramProtein(p),
      url: `https://www.tesco.com/groceries/en-GB/products/${p.sku}`,
    };
  });

  const dir = opts.sortDir === "asc" ? 1 : -1;
  ranked.sort((a, b) => {
    const av = sortValue(a, opts.sort);
    const bv = sortValue(b, opts.sort);
    if (av === bv) return a.title.localeCompare(b.title);
    return av > bv ? dir : -dir;
  });

  ranked.forEach((row, i) => {
    row.rank = i + 1;
  });
  return ranked;
}

export const CATEGORIES = [
  "Fresh Food",
  "Bakery",
  "Frozen Food",
  "Treats & Snacks",
  "Food Cupboard",
  "Drinks",
] as const;
