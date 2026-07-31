import { useEffect, useMemo, useState } from "react";
import ProductRow from "../components/ProductRow";
import { useAuth } from "../lib/auth-context";
import {
  decorateProduct,
  type Product,
  type RankedProduct,
  type SortKey,
} from "../lib/rank";
import { useStars } from "../lib/stars-context";
import {
  readStarredSortFromUrl,
  starredParamsFromSort,
  type StarredSort,
  writeHash,
} from "../lib/url-state";

interface Props {
  products: Product[] | null;
  error: string | null;
}

export default function Starred({ products, error }: Props) {
  const { stars, count, status: syncStatus, clearStars } = useStars();
  const { status: authStatus, signIn, error: authError } = useAuth();
  const [sort, setSort] = useState<StarredSort>(() => readStarredSortFromUrl());

  useEffect(() => {
    writeHash("starred", starredParamsFromSort(sort));
  }, [sort]);

  useEffect(() => {
    const onHash = () => setSort(readStarredSortFromUrl());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const items = useMemo(() => {
    if (!products) return [];
    const bySku = new Map(products.map((p) => [p.sku, p]));
    const rows: RankedProduct[] = [];
    for (const sku of Object.keys(stars)) {
      const product = bySku.get(sku);
      if (!product) continue;
      const decorated = decorateProduct(product);
      if (decorated) rows.push(decorated);
    }
    const dir =
      sort === "price" || sort === "energyKcal" || sort === "pricePerProtein"
        ? 1
        : -1;
    rows.sort((a, b) => {
      if (sort === "recent") return (stars[b.sku] ?? 0) - (stars[a.sku] ?? 0);
      const av = metricValue(a, sort);
      const bv = metricValue(b, sort);
      if (av === bv) return a.title.localeCompare(b.title);
      return av > bv ? dir : -dir;
    });
    rows.forEach((row, i) => {
      row.rank = i + 1;
    });
    return rows;
  }, [products, stars, sort]);

  const missing = count - items.length;

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Your list</p>
          <h1 className="page-title">Starred items</h1>
        </div>
      </header>

      {authStatus === "signed-out" && (
        <section className="signin-card">
          <div>
            <h2>Sign in to see your stars</h2>
            <p className="muted">
              Each Google account has its own private list. Starring while signed
              out will take you through Google OAuth first.
            </p>
            {authError && <p className="error">{authError}</p>}
          </div>
          <button type="button" className="chip google" onClick={() => signIn("/#/starred")}>
            Sign in with Google
          </button>
        </section>
      )}

      {authStatus === "unconfigured" && (
        <section className="signin-card">
          <div>
            <h2>Google OAuth not configured</h2>
            <p className="muted">
              Set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code>{" "}
              on the server, plus <code>PUBLIC_BASE_URL</code> matching your site
              origin. Add{" "}
              <code>{`${window.location.origin}/api/auth/callback`}</code> as an
              authorised redirect URI in Google Cloud.
            </p>
          </div>
        </section>
      )}

      {syncStatus === "error" && authStatus === "signed-in" && (
        <p className="error">Could not sync your starred list with the server.</p>
      )}

      {authStatus === "signed-in" && count > 0 && (
        <div className="status-bar">
          <p>
            <strong>{items.length.toLocaleString()}</strong> shown
            {missing > 0 && (
              <span className="muted">
                {" "}
                · {missing} no longer in the catalogue
              </span>
            )}
          </p>
          <div className="starred-actions">
            <label className="sort inline">
              <span>Sort</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as StarredSort)}
              >
                <option value="recent">Recently starred</option>
                <option value="proteinPerKcal">Protein / kcal</option>
                <option value="proteinPct">% energy from protein</option>
                <option value="pricePerProtein">Price / g protein</option>
                <option value="protein">Protein (g)</option>
                <option value="energyKcal">Calories (low→high)</option>
                <option value="price">Pack price (low→high)</option>
              </select>
            </label>
            <button type="button" className="cat clear" onClick={clearStars}>
              Clear all
            </button>
          </div>
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {!products && !error && <p className="muted">Loading catalogue…</p>}

      {authStatus === "signed-in" && products && count === 0 && (
        <div className="empty">
          <p>Nothing starred yet on this account.</p>
          <a className="more" href="#/">
            Browse the catalogue
          </a>
        </div>
      )}

      {authStatus === "signed-in" && (
        <ol className="results">
          {items.map((item, index) => (
            <ProductRow
              key={item.sku}
              item={item}
              sort={sort === "recent" ? "proteinPerKcal" : sort}
              index={index}
              showRank={false}
            />
          ))}
        </ol>
      )}
    </>
  );
}

function metricValue(item: RankedProduct, key: SortKey): number {
  switch (key) {
    case "proteinPct":
      return item.proteinPctOfCalories;
    case "pricePerProtein":
      return item.pricePerProtein ?? Number.POSITIVE_INFINITY;
    case "protein":
      return item.protein ?? Number.NEGATIVE_INFINITY;
    case "energyKcal":
      return item.energyKcal ?? Number.POSITIVE_INFINITY;
    case "price":
      return item.price ?? Number.POSITIVE_INFINITY;
    default:
      return item.proteinPerKcal;
  }
}
