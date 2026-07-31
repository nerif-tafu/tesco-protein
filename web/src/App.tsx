import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  CATEGORIES,
  DEFAULT_ADVANCED,
  rankProducts,
  type AdvancedSearch,
  type Diet,
  type Product,
  type SortKey,
} from "./lib/rank";
import "./App.css";

const PAGE_SIZE = 40;

function emptyToNull(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function formatPencePerG(poundsPerG: number): string {
  const pence = poundsPerG * 100;
  if (pence < 1) return `${pence.toFixed(2)}p/g`;
  if (pence < 100) return `${pence.toFixed(1)}p/g`;
  return `£${poundsPerG.toFixed(2)}/g`;
}

export default function App() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diet, setDiet] = useState<Diet>("vegetarian");
  const [minKcal, setMinKcal] = useState(40);
  const [minProtein, setMinProtein] = useState(5);
  const [categories, setCategories] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("proteinPerKcal");
  const [excludeCondiments, setExcludeCondiments] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advanced, setAdvanced] = useState<AdvancedSearch>(DEFAULT_ADVANCED);
  const [visible, setVisible] = useState(PAGE_SIZE);

  const deferredQuery = useDeferredValue(query);
  const deferredAdvanced = useDeferredValue(advanced);

  useEffect(() => {
    let cancelled = false;
    fetch("/products.json")
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load products (${res.status})`);
        return res.json() as Promise<Product[]>;
      })
      .then((data) => {
        if (!cancelled) setProducts(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [
    diet,
    minKcal,
    minProtein,
    categories,
    deferredQuery,
    sort,
    excludeCondiments,
    deferredAdvanced,
  ]);

  const ranked = useMemo(() => {
    if (!products) return [];
    const ascSorts: SortKey[] = ["price", "energyKcal", "pricePerProtein"];
    return rankProducts(products, {
      diet,
      minKcal,
      minProtein,
      categories,
      query: deferredQuery,
      sort,
      sortDir: ascSorts.includes(sort) ? "asc" : "desc",
      excludeCondiments,
      advanced: deferredAdvanced,
    });
  }, [
    products,
    diet,
    minKcal,
    minProtein,
    categories,
    deferredQuery,
    sort,
    excludeCondiments,
    deferredAdvanced,
  ]);

  const shown = ranked.slice(0, visible);
  const top = ranked[0];

  const advancedActive = useMemo(() => {
    const a = advanced;
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
  }, [advanced]);

  function toggleCategory(cat: string) {
    setCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  }

  function patchAdvanced(patch: Partial<AdvancedSearch>) {
    setAdvanced((prev) => ({ ...prev, ...patch }));
  }

  function metricPrimary(item: (typeof ranked)[number]) {
    if (sort === "pricePerProtein") {
      return item.pricePerProtein != null
        ? formatPencePerG(item.pricePerProtein)
        : "—";
    }
    if (sort === "price") {
      return item.price != null ? `£${item.price.toFixed(2)}` : "—";
    }
    if (sort === "protein") return `${item.protein}g`;
    if (sort === "energyKcal") return `${item.energyKcal}`;
    if (sort === "proteinPct") {
      return `${(item.proteinPctOfCalories * 100).toFixed(0)}%`;
    }
    return item.proteinPerKcal.toFixed(3);
  }

  function metricLabel() {
    switch (sort) {
      case "pricePerProtein":
        return "price / g protein";
      case "price":
        return "pack price";
      case "protein":
        return "protein / 100";
      case "energyKcal":
        return "kcal / 100";
      case "proteinPct":
        return "energy from protein";
      default:
        return "g protein / kcal";
    }
  }

  return (
    <div className="shell">
      <header className="hero">
        <div className="brand-block">
          <p className="eyebrow">Tesco catalogue · on-pack macros</p>
          <h1 className="brand">
            PER<span className="dot">·</span>KCAL
          </h1>
          <p className="lede">
            Rank foods by vegetarian protein density — grams of protein per
            calorie — from a live scrape of Tesco’s UK aisle.
          </p>
        </div>

        {top && (
          <aside className="leader" aria-label="Current #1">
            <span className="leader-label">#1 right now</span>
            <strong className="leader-metric">
              {metricPrimary(top)}
              {sort === "proteinPerKcal" && <span>g/kcal</span>}
              {sort === "pricePerProtein" && <span>protein</span>}
            </strong>
            <p className="leader-title">{top.title}</p>
            <p className="leader-macros">
              {top.protein}g protein · {top.energyKcal} kcal
              {top.pricePerProtein != null &&
                ` · ${formatPencePerG(top.pricePerProtein)} protein`}
            </p>
          </aside>
        )}
      </header>

      <section className="controls" aria-label="Filters">
        <div className="diet" role="tablist" aria-label="Diet">
          {(
            [
              ["all", "All foods"],
              ["vegetarian", "Vegetarian"],
              ["vegan", "Vegan"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={diet === value}
              className={diet === value ? "chip active" : "chip"}
              onClick={() => setDiet(value)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="search-row">
          <label className="search">
            <span className="sr-only">Search products</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Quick search title or brand…"
              autoComplete="off"
            />
          </label>
          <button
            type="button"
            className={
              advancedOpen || advancedActive ? "chip active adv-toggle" : "chip adv-toggle"
            }
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((o) => !o)}
          >
            Advanced{advancedActive ? " · on" : ""}
          </button>
        </div>

        {advancedOpen && (
          <div className="advanced" aria-label="Advanced search">
            <div className="adv-grid">
              <label>
                <span>Must include</span>
                <input
                  value={advanced.include}
                  onChange={(e) => patchAdvanced({ include: e.target.value })}
                  placeholder="tofu quorn"
                />
              </label>
              <label>
                <span>Exclude</span>
                <input
                  value={advanced.exclude}
                  onChange={(e) => patchAdvanced({ exclude: e.target.value })}
                  placeholder="sauce dessert"
                />
              </label>
              <label>
                <span>Brand</span>
                <input
                  value={advanced.brand}
                  onChange={(e) => patchAdvanced({ brand: e.target.value })}
                  placeholder="Tesco, Quorn…"
                />
              </label>
              <label>
                <span>Include match</span>
                <select
                  value={advanced.matchMode}
                  onChange={(e) =>
                    patchAdvanced({
                      matchMode: e.target.value as "all" | "any",
                    })
                  }
                >
                  <option value="all">All words</option>
                  <option value="any">Any word</option>
                </select>
              </label>
            </div>

            <div className="adv-grid nums">
              <NumField
                label="Max fat (g)"
                value={advanced.maxFat}
                onChange={(v) => patchAdvanced({ maxFat: v })}
              />
              <NumField
                label="Max carbs (g)"
                value={advanced.maxCarbs}
                onChange={(v) => patchAdvanced({ maxCarbs: v })}
              />
              <NumField
                label="Max sugars (g)"
                value={advanced.maxSugars}
                onChange={(v) => patchAdvanced({ maxSugars: v })}
              />
              <NumField
                label="Max salt (g)"
                value={advanced.maxSalt}
                onChange={(v) => patchAdvanced({ maxSalt: v })}
              />
              <NumField
                label="Min fibre (g)"
                value={advanced.minFibre}
                onChange={(v) => patchAdvanced({ minFibre: v })}
              />
              <NumField
                label="Max pack price (£)"
                value={advanced.maxPrice}
                onChange={(v) => patchAdvanced({ maxPrice: v })}
                step="0.1"
              />
              <NumField
                label="Min % energy from protein"
                value={advanced.minProteinPct}
                onChange={(v) => patchAdvanced({ minProteinPct: v })}
                step="1"
                hint="e.g. 30 = at least 30% of calories from protein"
              />
              <NumField
                label="Max £ / g protein"
                value={advanced.maxPricePerProtein}
                onChange={(v) => patchAdvanced({ maxPricePerProtein: v })}
                step="0.001"
                hint="e.g. 0.05 = 5p per gram"
              />
            </div>

            <div className="adv-actions">
              <label className="check">
                <input
                  type="checkbox"
                  checked={advanced.requirePricePerProtein}
                  onChange={(e) =>
                    patchAdvanced({ requirePricePerProtein: e.target.checked })
                  }
                />
                Only products with a calculable £/g protein
              </label>
              <button
                type="button"
                className="cat clear"
                onClick={() => setAdvanced(DEFAULT_ADVANCED)}
              >
                Reset advanced
              </button>
            </div>
            <p className="adv-note">
              £/g protein uses Tesco’s unit price (£/kg or £/litre) with per-100g
              macros — cost of 100g÷protein grams. Packs priced “each” are
              skipped.
            </p>
          </div>
        )}

        <div className="sliders">
          <label>
            <span>
              Min kcal <em>{minKcal}</em>
            </span>
            <input
              type="range"
              min={10}
              max={200}
              step={5}
              value={minKcal}
              onChange={(e) => setMinKcal(Number(e.target.value))}
            />
          </label>
          <label>
            <span>
              Min protein <em>{minProtein}g</em>
            </span>
            <input
              type="range"
              min={0}
              max={40}
              step={1}
              value={minProtein}
              onChange={(e) => setMinProtein(Number(e.target.value))}
            />
          </label>
        </div>

        <div className="meta-row">
          <label className="sort">
            <span>Sort</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              <option value="proteinPerKcal">Protein / kcal</option>
              <option value="proteinPct">% energy from protein</option>
              <option value="pricePerProtein">Price / g protein (cheap→dear)</option>
              <option value="protein">Protein (g)</option>
              <option value="energyKcal">Calories (low→high)</option>
              <option value="price">Pack price (low→high)</option>
            </select>
          </label>

          <label className="check">
            <input
              type="checkbox"
              checked={excludeCondiments}
              onChange={(e) => setExcludeCondiments(e.target.checked)}
            />
            Hide sauces &amp; seasonings
          </label>
        </div>

        <div className="cats" aria-label="Categories">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              className={
                categories.length === 0 || categories.includes(cat)
                  ? "cat on"
                  : "cat"
              }
              aria-pressed={categories.includes(cat)}
              onClick={() => toggleCategory(cat)}
            >
              {cat}
            </button>
          ))}
          {categories.length > 0 && (
            <button
              type="button"
              className="cat clear"
              onClick={() => setCategories([])}
            >
              Clear
            </button>
          )}
        </div>
      </section>

      <div className="status-bar">
        {error && <p className="error">{error}</p>}
        {!products && !error && <p className="muted">Loading catalogue…</p>}
        {products && (
          <p>
            <strong>{ranked.length.toLocaleString()}</strong> matches
            <span className="muted">
              {" "}
              · {products.length.toLocaleString()} scraped products
              · values per 100g/ml
            </span>
          </p>
        )}
      </div>

      <ol className="results">
        {shown.map((item, index) => (
          <li
            key={item.sku}
            className="row"
            style={{ animationDelay: `${Math.min(index, 12) * 28}ms` }}
          >
            <div className="rank" aria-label={`Rank ${item.rank}`}>
              {String(item.rank).padStart(2, "0")}
            </div>
            <div className="body">
              <div className="title-row">
                <a href={item.url} target="_blank" rel="noreferrer">
                  {item.title}
                </a>
                {item.price != null && (
                  <span className="price">£{item.price.toFixed(2)}</span>
                )}
              </div>
              <div className="tags">
                <span>{item.nutritionBasis?.replace("per_", "per ")}</span>
                {item.categories.map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </div>
              <div className="bars" aria-hidden="true">
                <MacroBar label="P" value={item.protein} max={40} tone="p" />
                <MacroBar label="C" value={item.carbs} max={80} tone="c" />
                <MacroBar label="F" value={item.fat} max={40} tone="f" />
              </div>
            </div>
            <div className="metric">
              <strong>{metricPrimary(item)}</strong>
              <span>{metricLabel()}</span>
              <em>{(item.proteinPctOfCalories * 100).toFixed(0)}% energy</em>
              <small>
                {item.protein}g P · {item.energyKcal} kcal
                {item.pricePerProtein != null &&
                  ` · ${formatPencePerG(item.pricePerProtein)}`}
              </small>
            </div>
          </li>
        ))}
      </ol>

      {visible < ranked.length && (
        <button
          type="button"
          className="more"
          onClick={() => setVisible((v) => v + PAGE_SIZE)}
        >
          Show more ({ranked.length - visible} left)
        </button>
      )}

      <footer className="foot">
        Unofficial personal tool · nutrition from Tesco on-pack tables · diet
        filters are title heuristics, not certified labels
      </footer>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  step = "0.1",
  hint,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  step?: string;
  hint?: string;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        min={0}
        value={value ?? ""}
        placeholder="any"
        onChange={(e) => onChange(emptyToNull(e.target.value))}
      />
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  );
}

function MacroBar({
  label,
  value,
  max,
  tone,
}: {
  label: string;
  value: number | null;
  max: number;
  tone: "p" | "c" | "f";
}) {
  const n = typeof value === "number" ? value : 0;
  const width = Math.min(100, (n / max) * 100);
  return (
    <div className={`macro macro-${tone}`}>
      <span>{label}</span>
      <div className="track">
        <i style={{ width: `${width}%` }} />
      </div>
      <b>{typeof value === "number" ? `${value}g` : "—"}</b>
    </div>
  );
}
