/**
 * Paths for the committed catalogue (full scrape) vs runtime DATA_DIR.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Persistent data root. In Docker this is `/data`. */
export const DATA_DIR = path.resolve(process.env.DATA_DIR || "data");

export const PRODUCTS_PATH = path.join(DATA_DIR, "products.json");
export const INDEX_PATH = path.join(DATA_DIR, "skus.json");
export const TAXONOMY_PATH = path.join(DATA_DIR, "taxonomy.json");
export const BROWSE_INDEX_PATH = path.join(DATA_DIR, "browse-index.json");
export const WEB_PRODUCTS_PATH = path.join(DATA_DIR, "products.web.json");

/** Full scrape committed to git for weekly incremental updates. */
export const CATALOGUE_PATH = path.join(ROOT, "catalogue", "products.json");
/** Slim UI payload shipped in the Docker image / defaults. */
export const DEFAULTS_PATH = path.join(ROOT, "defaults", "products.json");
