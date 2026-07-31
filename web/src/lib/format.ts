import type { RankedProduct, SortKey } from "./rank";

export function formatPencePerG(poundsPerG: number): string {
  const pence = poundsPerG * 100;
  if (pence < 1) return `${pence.toFixed(2)}p`;
  if (pence < 100) return `${pence.toFixed(1)}p`;
  return `£${poundsPerG.toFixed(2)}`;
}

export function formatBasis(basis: string | null): string {
  if (basis === "per_100g") return "per 100g";
  if (basis === "per_100ml") return "per 100ml";
  return basis?.replace("per_", "per ") ?? "per 100g";
}

export interface MetricView {
  /** Headline number, already formatted. */
  value: string;
  /** Unit shown next to the number, e.g. "g/kcal". */
  unit: string;
  /** Plain-English name of what the number measures. */
  caption: string;
}

export function describeMetric(item: RankedProduct, sort: SortKey): MetricView {
  switch (sort) {
    case "pricePerProtein":
      return {
        value:
          item.pricePerProtein != null
            ? formatPencePerG(item.pricePerProtein)
            : "—",
        unit: "per g protein",
        caption: "Protein cost",
      };
    case "price":
      return {
        value: item.price != null ? `£${item.price.toFixed(2)}` : "—",
        unit: "per pack",
        caption: "Pack price",
      };
    case "protein":
      return {
        value: `${item.protein ?? "—"}`,
        unit: "g protein",
        caption: formatBasis(item.nutritionBasis),
      };
    case "energyKcal":
      return {
        value: `${item.energyKcal ?? "—"}`,
        unit: "kcal",
        caption: formatBasis(item.nutritionBasis),
      };
    case "proteinPct":
      return {
        value: `${Math.round(item.proteinPctOfCalories * 100)}%`,
        unit: "",
        caption: "Calories from protein",
      };
    default:
      return {
        value: item.proteinPerKcal.toFixed(3),
        unit: "g/kcal",
        caption: "Protein density",
      };
  }
}

export function sortLabel(sort: SortKey): string {
  switch (sort) {
    case "pricePerProtein":
      return "cheapest protein first";
    case "price":
      return "cheapest pack first";
    case "protein":
      return "most protein first";
    case "energyKcal":
      return "fewest calories first";
    case "proteinPct":
      return "highest protein share first";
    default:
      return "densest protein first";
  }
}
