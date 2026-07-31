/**
 * Tiny static file server for the built web UI.
 * Serves /products.json from $DATA_DIR/products.web.json (or defaults).
 */
import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR, WEB_PRODUCTS_PATH } from "./scripts/paths.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const STATIC_ROOT = path.resolve(__dirname, "web", "dist");
const DEFAULTS = path.resolve(__dirname, "defaults", "products.json");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

async function ensureWebProducts() {
  await mkdir(DATA_DIR, { recursive: true });
  if (existsSync(WEB_PRODUCTS_PATH)) return WEB_PRODUCTS_PATH;

  const full = path.join(DATA_DIR, "products.json");
  if (existsSync(full)) {
    // Prefer regenerating slim export from a full scrape when present.
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(process.execPath, ["scripts/export-web-data.mjs"], {
      stdio: "inherit",
      env: process.env,
    });
    if (result.status === 0 && existsSync(WEB_PRODUCTS_PATH)) {
      return WEB_PRODUCTS_PATH;
    }
  }

  if (existsSync(DEFAULTS)) {
    await copyFile(DEFAULTS, WEB_PRODUCTS_PATH);
    return WEB_PRODUCTS_PATH;
  }

  throw new Error(
    `No catalogue found. Mount scrape data on ${DATA_DIR} or ship defaults/products.json.`,
  );
}

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath.split("?")[0]);
  const cleaned = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const full = path.join(root, cleaned);
  if (!full.startsWith(root)) return null;
  return full;
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": ext === ".html" || ext === ".json" ? "no-cache" : "public, max-age=86400",
  });
  createReadStream(filePath).pipe(res);
}

const productsFile = await ensureWebProducts();
console.log(`Catalogue: ${productsFile}`);
console.log(`Static:    ${STATIC_ROOT}`);
console.log(`Data dir:  ${DATA_DIR}`);

const server = http.createServer(async (req, res) => {
  try {
    const url = req.url || "/";
    if (url === "/products.json" || url.startsWith("/products.json?")) {
      // Re-check in case a scrape/export refreshed the file.
      const live = existsSync(WEB_PRODUCTS_PATH) ? WEB_PRODUCTS_PATH : productsFile;
      return sendFile(res, live);
    }

    if (url === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }

    let filePath = safeJoin(STATIC_ROOT, url === "/" ? "/index.html" : url);
    if (!filePath) {
      res.writeHead(400).end("Bad request");
      return;
    }

    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }

    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      // SPA fallback
      const index = path.join(STATIC_ROOT, "index.html");
      if (existsSync(index)) return sendFile(res, index);
      res.writeHead(404).end("Not found");
      return;
    }

    sendFile(res, filePath);
  } catch (err) {
    console.error(err);
    res.writeHead(500).end("Server error");
  }
});

server.listen(PORT, () => {
  console.log(`PER·KCAL listening on :${PORT}`);
});
