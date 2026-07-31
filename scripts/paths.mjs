import path from "node:path";

/** Persistent data root. In Docker this is `/data`. */
export const DATA_DIR = path.resolve(process.env.DATA_DIR || "data");

export const PRODUCTS_PATH = path.join(DATA_DIR, "products.json");
export const INDEX_PATH = path.join(DATA_DIR, "skus.json");
export const WEB_PRODUCTS_PATH = path.join(DATA_DIR, "products.web.json");
