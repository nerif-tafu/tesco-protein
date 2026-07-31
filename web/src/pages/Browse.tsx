import { useDeferredValue, useEffect, useMemo, useState } from "react";
import ProductRow from "../components/ProductRow";
import { sortLabel } from "../lib/format";
import {
  CATEGORIES,
  DEFAULT_ADVANCED,
  rankProducts,
  type AdvancedSearch,
  type Diet,
  type Product,
  type SortKey,
} from "../lib/rank";
import {
  browseParamsFromState,
  isAdvancedActive,
  readBrowseStateFromUrl,
  writeHash,
} from "../lib/url-state";

const PAGE_SIZE = 40;

function emptyToNull(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

interface Props {
  products: Product[] | null;
  error: string | null;
}

export default function Browse({ products, error }: Props) {
  const initial = useMemo(() => readBrowseStateFromUrl(), []);
  const [diet, setDiet] = useState<Diet>(initial.diet);
  const [minKcal, setMinKcal] = useState(initial.minKcal);
  const [minProtein, setMinProtein] = useState(initial.minProtein);
  const [categories, setCategories] = useState<string[]>(initial.categories);
  const [query, setQuery] = useState(initial.query);
  const [sort, setSort] = useState<SortKey>(initial.sort);
  const [excludeCondiments, setExcludeCondiments] = useState(
    initial.excludeCondiments,
  );
  const [advancedOpen, setAdvancedOpen] = useState(initial.advancedOpen);
  const [advanced, setAdvanced] = useState<AdvancedSearch>(initial.advanced);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [urlReady, setUrlReady] = useState(false);

  const deferredQuery = useDeferredValue(query);
  const deferredAdvanced = useDeferredValue(advanced);

  // Sync filters → hash (skip first paint so we don't clobber a deep link before state settles).
  useEffect(() => {
    if (!urlReady) {
      setUrlReady(true);
      return;
    }
    writeHash(
      "browse",
      browseParamsFromState({
        diet,
        minKcal,
        minProtein,
        categories,
        query,
        sort,
        excludeCondiments,
        advanced,
        advancedOpen,
      }),
    );
  }, [
    diet,
    minKcal,
    minProtein,
    categories,
    query,
    sort,
    excludeCondiments,
    advanced,
    advancedOpen,
    urlReady,
  ]);

  // Hash edits / back-forward while still on Browse.
  useEffect(() => {
    const onHash = () => {
      const next = readBrowseStateFromUrl();
      setDiet(next.diet);
      setMinKcal(next.minKcal);
      setMinProtein(next.minProtein);
      setCategories(next.categories);
      setQuery(next.query);
      setSort(next.sort);
      setExcludeCondiments(next.excludeCondiments);
      setAdvanced(next.advanced);
      if (next.advancedOpen) setAdvancedOpen(true);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
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

  const advancedActive = useMemo(() => isAdvancedActive(advanced), [advanced]);

  function toggleCategory(cat: string) {
    setCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  }

  function patchAdvanced(patch: Partial<AdvancedSearch>) {
    setAdvanced((prev) => ({ ...prev, ...patch }));
  }

  return (
    <>
      <section className="controls" aria-label="Filters">
        <div className="diet" role="tablist" aria-label="Diet">
          {(
            [
              ["all", "All foods"],
              ["vegetarian", "Vegetarian"],
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
              advancedOpen || advancedActive
                ? "chip active adv-toggle"
                : "chip adv-toggle"
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
                    patchAdvanced({ matchMode: e.target.value as "all" | "any" })
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
              macros — cost of 100g ÷ protein grams. Packs priced “each” are
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
              <option value="pricePerProtein">
                Price / g protein (cheap→dear)
              </option>
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
              · {sortLabel(sort)} · {products.length.toLocaleString()} scraped
              products
            </span>
          </p>
        )}
      </div>

      <ol className="results">
        {shown.map((item, index) => (
          <ProductRow key={item.sku} item={item} sort={sort} index={index} />
        ))}
      </ol>

      {visible < ranked.length && (
        <button
          type="button"
          className="more"
          onClick={() => setVisible((v) => v + PAGE_SIZE)}
        >
          Show more ({(ranked.length - visible).toLocaleString()} left)
        </button>
      )}
    </>
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
