import Thumb from "./Thumb";
import { describeMetric, formatBasis, formatPencePerG } from "../lib/format";
import { useAuth } from "../lib/auth-context";
import type { RankedProduct, SortKey } from "../lib/rank";
import { useStars } from "../lib/stars-context";

interface Props {
  item: RankedProduct;
  sort: SortKey;
  index: number;
  /** Hide the ordinal on lists where position carries no meaning. */
  showRank?: boolean;
}

export default function ProductRow({ item, sort, index, showRank = true }: Props) {
  const { isStarred, toggleStar } = useStars();
  const { status: authStatus } = useAuth();
  const starred = isStarred(item.sku);
  const metric = describeMetric(item, sort);
  const proteinShare = Math.round(item.proteinPctOfCalories * 100);
  const basis = formatBasis(item.nutritionBasis);
  const signedIn = authStatus === "signed-in";

  return (
    <li className="row" style={{ animationDelay: `${Math.min(index, 12) * 28}ms` }}>
      {showRank && (
        <div className="rank" aria-label={`Rank ${item.rank}`}>
          {String(item.rank).padStart(2, "0")}
        </div>
      )}

      <div className="thumb-wrap">
        <Thumb src={item.imageUrl} />
      </div>

      <div className="body">
        <div className="row-head">
          <h3 className="row-title">
            <a href={item.url} target="_blank" rel="noreferrer">
              {item.title}
            </a>
          </h3>
          <button
            type="button"
            className={starred ? "star on" : "star"}
            aria-pressed={starred}
            aria-label={
              !signedIn
                ? `Sign in to star ${item.title}`
                : starred
                  ? `Unstar ${item.title}`
                  : `Star ${item.title}`
            }
            title={
              !signedIn
                ? "Sign in with Google to save this"
                : starred
                  ? "Remove from your starred list"
                  : "Save to your starred list"
            }
            onClick={() => toggleStar(item.sku)}
          >
            <StarIcon filled={starred} />
          </button>
        </div>

        <p className="row-sub">
          {item.brand && <span className="brand-name">{item.brand}</span>}
          <span className="tag">{basis}</span>
          {item.categories.map((c) => (
            <span className="tag" key={c}>
              {c}
            </span>
          ))}
        </p>

        <div className="bars">
          <MacroBar label="Protein" value={item.protein} max={40} tone="p" />
          <MacroBar label="Carbs" value={item.carbs} max={80} tone="c" />
          <MacroBar label="Fat" value={item.fat} max={40} tone="f" />
        </div>
      </div>

      <div className="metric">
        <p className="metric-caption">{metric.caption}</p>
        <p className="metric-value">
          {metric.value}
          {metric.unit && <span className="metric-unit">{metric.unit}</span>}
        </p>

        <div className="share">
          <div className="share-track" aria-hidden="true">
            <i style={{ width: `${Math.min(100, proteinShare)}%` }} />
          </div>
          <p className="share-note">
            <strong>{proteinShare}%</strong> of calories from protein
          </p>
        </div>

        <dl className="stats">
          <div>
            <dt>Energy</dt>
            <dd>{item.energyKcal} kcal</dd>
          </div>
          {item.pricePerProtein != null && (
            <div>
              <dt>Protein cost</dt>
              <dd>{formatPencePerG(item.pricePerProtein)} / g</dd>
            </div>
          )}
          {item.price != null && (
            <div>
              <dt>Pack price</dt>
              <dd>£{item.price.toFixed(2)}</dd>
            </div>
          )}
        </dl>
      </div>
    </li>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        d="M12 3.6l2.6 5.27 5.82.85-4.21 4.1.99 5.79L12 16.87l-5.2 2.74.99-5.79-4.21-4.1 5.82-.85L12 3.6z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
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
