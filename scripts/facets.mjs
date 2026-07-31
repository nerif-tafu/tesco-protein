/**
 * Tesco grocery category facets.
 *
 * Nested aisle facets are NOT plain `btoa(name)`. They encode each breadcrumb
 * segment with encodeURIComponent (keeping `,` and `&` literal), join with
 * `%7C`, then base64 — matching the `id` values from Query.taxonomy.
 */
export const ROOTS = [
  { name: "Fresh Food", slug: "fresh-food" },
  { name: "Bakery", slug: "bakery" },
  { name: "Frozen Food", slug: "frozen-food" },
  { name: "Treats & Snacks", slug: "treats-and-snacks" },
  { name: "Food Cupboard", slug: "food-cupboard" },
  { name: "Drinks", slug: "drinks" },
];

/** Encode one breadcrumb segment the way Tesco's PLP does. */
export function encodeFacetSegment(name) {
  return encodeURIComponent(name).replace(/%2C/g, ",").replace(/%26/g, "&");
}

/** Build a category facet id from a breadcrumb name path. */
export function facetPath(parts) {
  const encoded = parts.map(encodeFacetSegment).join("%7C");
  return `b;${Buffer.from(encoded, "utf8").toString("base64")}`;
}

export function decodeFacet(facet) {
  if (!facet?.startsWith("b;")) return null;
  try {
    const raw = Buffer.from(facet.slice(2), "base64").toString("utf8");
    return decodeURIComponent(raw.replace(/,/g, "%2C").replace(/&/g, "%26")).split("|");
  } catch {
    return null;
  }
}

export function browseUrl(slugPath) {
  const cleaned = slugPath.replace(/^\/+|\/+$/g, "");
  return `https://www.tesco.com/shop/en-GB/browse/${cleaned}/all`;
}
