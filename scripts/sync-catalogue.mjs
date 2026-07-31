/**
 * Write runtime scrape → committed catalogue + slim defaults.
 *
 * Usage: node scripts/sync-catalogue.mjs
 */
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import {
  PRODUCTS_PATH,
  CATALOGUE_PATH,
  DEFAULTS_PATH,
  WEB_PRODUCTS_PATH,
  DATA_DIR,
} from "./paths.mjs";

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(PRODUCTS_PATH))) {
  console.error(`No scrape at ${PRODUCTS_PATH}. Run scrape first.`);
  process.exitCode = 1;
  process.exit();
}

const raw = JSON.parse(await readFile(PRODUCTS_PATH, "utf8"));
const count = Object.keys(raw).length;

await mkdir(path.dirname(CATALOGUE_PATH), { recursive: true });
// Compact JSON keeps the git blob smaller.
await writeFile(CATALOGUE_PATH, JSON.stringify(raw) + "\n");
console.log(`Wrote ${count} products → ${CATALOGUE_PATH}`);

// Slim export for UI / Docker defaults.
const { spawnSync } = await import("node:child_process");
const exported = spawnSync(
  process.execPath,
  ["scripts/export-web-data.mjs", "--defaults"],
  { stdio: "inherit" },
);
if (exported.status !== 0) {
  process.exitCode = exported.status ?? 1;
  process.exit();
}

if (await exists(WEB_PRODUCTS_PATH)) {
  console.log(`Web export ready at ${WEB_PRODUCTS_PATH}`);
}
console.log(`Defaults → ${DEFAULTS_PATH}`);
console.log(`Data dir  → ${DATA_DIR}`);
