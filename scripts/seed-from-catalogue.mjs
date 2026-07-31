/**
 * Seed $DATA_DIR/products.json from the committed catalogue when missing,
 * or when --force is passed.
 *
 * Usage: node scripts/seed-from-catalogue.mjs [--force]
 */
import { copyFile, mkdir, access, readFile, writeFile } from "node:fs/promises";
import { CATALOGUE_PATH, DATA_DIR, PRODUCTS_PATH } from "./paths.mjs";

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

const force = process.argv.includes("--force");

if (!(await exists(CATALOGUE_PATH))) {
  console.error(`No catalogue at ${CATALOGUE_PATH}`);
  process.exitCode = 1;
  process.exit();
}

await mkdir(DATA_DIR, { recursive: true });

if (!force && (await exists(PRODUCTS_PATH))) {
  const local = JSON.parse(await readFile(PRODUCTS_PATH, "utf8"));
  const cat = JSON.parse(await readFile(CATALOGUE_PATH, "utf8"));
  const localN = Object.keys(local).length;
  const catN = Object.keys(cat).length;
  if (localN >= catN) {
    console.log(`Keep ${PRODUCTS_PATH} (${localN} SKUs ≥ catalogue ${catN})`);
    process.exit();
  }
  // Merge: catalogue fills gaps; local wins on conflict.
  const merged = { ...cat, ...local };
  await writeFile(PRODUCTS_PATH, JSON.stringify(merged) + "\n");
  console.log(
    `Merged catalogue → ${PRODUCTS_PATH} (${Object.keys(merged).length} SKUs)`,
  );
  process.exit();
}

await copyFile(CATALOGUE_PATH, PRODUCTS_PATH);
const n = Object.keys(JSON.parse(await readFile(PRODUCTS_PATH, "utf8"))).length;
console.log(`Seeded ${PRODUCTS_PATH} from catalogue (${n} SKUs)`);
