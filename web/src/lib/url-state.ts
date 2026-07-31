import {
  CATEGORIES,
  DEFAULT_ADVANCED,
  type AdvancedSearch,
  type Diet,
  type SortKey,
} from "./rank";

export type BrowseUrlState = {
  diet: Diet;
  minKcal: number;
  minProtein: number;
  categories: string[];
  query: string;
  sort: SortKey;
  excludeCondiments: boolean;
  advanced: AdvancedSearch;
  advancedOpen: boolean;
};

export type Route = "browse" | "starred";

const SORT_KEYS: SortKey[] = [
  "proteinPerKcal",
  "proteinPct",
  "protein",
  "energyKcal",
  "price",
  "pricePerProtein",
];

const DEFAULT_BROWSE: BrowseUrlState = {
  diet: "vegetarian",
  minKcal: 40,
  minProtein: 5,
  categories: [],
  query: "",
  sort: "proteinPerKcal",
  excludeCondiments: true,
  advanced: { ...DEFAULT_ADVANCED },
  advancedOpen: false,
};

const CAT_SET: Set<string> = new Set(CATEGORIES);

export function parseHash(hash = window.location.hash): {
  route: Route;
  params: URLSearchParams;
} {
  const raw = (hash.startsWith("#") ? hash.slice(1) : hash) || "/";
  const q = raw.indexOf("?");
  const path = (q >= 0 ? raw.slice(0, q) : raw) || "/";
  const query = q >= 0 ? raw.slice(q + 1) : "";
  const route: Route = path.startsWith("/starred") ? "starred" : "browse";
  return { route, params: new URLSearchParams(query) };
}

export function writeHash(route: Route, params: URLSearchParams) {
  const path = route === "starred" ? "/starred" : "/";
  const qs = params.toString();
  const next = qs ? `#${path}?${qs}` : `#${path}`;
  if (window.location.hash === next) return;
  // replaceState avoids spamming history while typing; still shareable.
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${next}`);
}

function numOr(raw: string | null, fallback: number): number {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function numOrNull(raw: string | null): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function boolParam(params: URLSearchParams, key: string, whenAbsent: boolean): boolean {
  if (!params.has(key)) return whenAbsent;
  const v = params.get(key);
  return v === "1" || v === "true";
}

export function browseStateFromParams(params: URLSearchParams): BrowseUrlState {
  const dietRaw = params.get("diet");
  const diet: Diet = dietRaw === "all" || dietRaw === "vegetarian" ? dietRaw : DEFAULT_BROWSE.diet;

  const sortRaw = params.get("sort");
  const sort: SortKey = SORT_KEYS.includes(sortRaw as SortKey)
    ? (sortRaw as SortKey)
    : DEFAULT_BROWSE.sort;

  const cats = (params.get("cats") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter((c) => CAT_SET.has(c));

  const matchRaw = params.get("match");
  const matchMode: AdvancedSearch["matchMode"] =
    matchRaw === "any" || matchRaw === "all" ? matchRaw : "all";

  const advanced: AdvancedSearch = {
    include: params.get("include") ?? "",
    exclude: params.get("exclude") ?? "",
    brand: params.get("brand") ?? "",
    matchMode,
    maxFat: numOrNull(params.get("maxFat")),
    maxCarbs: numOrNull(params.get("maxCarbs")),
    maxSugars: numOrNull(params.get("maxSugars")),
    maxSalt: numOrNull(params.get("maxSalt")),
    minFibre: numOrNull(params.get("minFibre")),
    maxPrice: numOrNull(params.get("maxPrice")),
    maxPricePerProtein: numOrNull(params.get("maxPp")),
    minProteinPct: numOrNull(params.get("minPct")),
    requirePricePerProtein: boolParam(params, "needPp", false),
  };

  const advancedActive = isAdvancedActive(advanced);

  return {
    diet,
    minKcal: numOr(params.get("minKcal"), DEFAULT_BROWSE.minKcal),
    minProtein: numOr(params.get("minProtein"), DEFAULT_BROWSE.minProtein),
    categories: cats,
    query: params.get("q") ?? "",
    sort,
    excludeCondiments: boolParam(params, "condiments", false)
      ? false
      : DEFAULT_BROWSE.excludeCondiments,
    advanced,
    advancedOpen: advancedActive,
  };
}

export function browseParamsFromState(state: BrowseUrlState): URLSearchParams {
  const p = new URLSearchParams();
  const d = DEFAULT_BROWSE;
  const a = state.advanced;
  const da = DEFAULT_ADVANCED;

  if (state.diet !== d.diet) p.set("diet", state.diet);
  if (state.query.trim()) p.set("q", state.query.trim());
  if (state.sort !== d.sort) p.set("sort", state.sort);
  if (state.minKcal !== d.minKcal) p.set("minKcal", String(state.minKcal));
  if (state.minProtein !== d.minProtein) p.set("minProtein", String(state.minProtein));
  if (state.categories.length) p.set("cats", state.categories.join(","));
  if (!state.excludeCondiments) p.set("condiments", "1");

  if (a.include.trim()) p.set("include", a.include.trim());
  if (a.exclude.trim()) p.set("exclude", a.exclude.trim());
  if (a.brand.trim()) p.set("brand", a.brand.trim());
  if (a.matchMode !== da.matchMode) p.set("match", a.matchMode);
  if (a.maxFat != null) p.set("maxFat", String(a.maxFat));
  if (a.maxCarbs != null) p.set("maxCarbs", String(a.maxCarbs));
  if (a.maxSugars != null) p.set("maxSugars", String(a.maxSugars));
  if (a.maxSalt != null) p.set("maxSalt", String(a.maxSalt));
  if (a.minFibre != null) p.set("minFibre", String(a.minFibre));
  if (a.maxPrice != null) p.set("maxPrice", String(a.maxPrice));
  if (a.maxPricePerProtein != null) p.set("maxPp", String(a.maxPricePerProtein));
  if (a.minProteinPct != null) p.set("minPct", String(a.minProteinPct));
  if (a.requirePricePerProtein) p.set("needPp", "1");

  return p;
}

export function isAdvancedActive(a: AdvancedSearch): boolean {
  return Boolean(
    a.include.trim() ||
      a.exclude.trim() ||
      a.brand.trim() ||
      a.maxFat != null ||
      a.maxCarbs != null ||
      a.maxSugars != null ||
      a.maxSalt != null ||
      a.minFibre != null ||
      a.maxPrice != null ||
      a.maxPricePerProtein != null ||
      a.minProteinPct != null ||
      a.requirePricePerProtein ||
      a.matchMode !== "all",
  );
}

export function readBrowseStateFromUrl(): BrowseUrlState {
  const { route, params } = parseHash();
  if (route !== "browse") return { ...DEFAULT_BROWSE, advanced: { ...DEFAULT_ADVANCED } };
  return browseStateFromParams(params);
}

const STARRED_SORTS = ["recent", ...SORT_KEYS] as const;
export type StarredSort = (typeof STARRED_SORTS)[number];

export function readStarredSortFromUrl(): StarredSort {
  const { route, params } = parseHash();
  if (route !== "starred") return "recent";
  const raw = params.get("sort");
  return STARRED_SORTS.includes(raw as StarredSort) ? (raw as StarredSort) : "recent";
}

export function starredParamsFromSort(sort: StarredSort): URLSearchParams {
  const p = new URLSearchParams();
  if (sort !== "recent") p.set("sort", sort);
  return p;
}

export { DEFAULT_BROWSE };
