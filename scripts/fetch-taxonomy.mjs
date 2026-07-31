/**
 * Fetch Tesco grocery taxonomy (name + facet id tree) via GraphQL and write
 * data/taxonomy.json for scrape.mjs.
 *
 * Usage: node scripts/fetch-taxonomy.mjs
 */
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PUBLIC_API_KEY, ENDPOINT } from "basketeer";
import { ROOTS } from "./facets.mjs";
import { TAXONOMY_PATH } from "./paths.mjs";

const ROOT_NAMES = new Set(ROOTS.map((r) => r.name));

const QUERY = `
query GetTaxonomy {
  taxonomy {
    name
    id
    label
    children {
      name
      id
      label
      children {
        name
        id
        label
        children {
          name
          id
          label
          children {
            name
            id
            label
          }
        }
      }
    }
  }
}`.trim();

function flatten(nodes, pathNames = [], out = []) {
  for (const n of nodes ?? []) {
    const names = [...pathNames, n.name];
    out.push({
      names,
      id: n.id,
      label: n.label,
      depth: names.length,
    });
    flatten(n.children, names, out);
  }
  return out;
}

/** Nodes that are not a strict prefix of another node (shelf / aisle leaves). */
export function leafNodes(flat) {
  const prefixes = new Set();
  for (const n of flat) {
    for (let i = 1; i < n.names.length; i++) {
      prefixes.add(n.names.slice(0, i).join("\0"));
    }
  }
  return flat.filter((n) => !prefixes.has(n.names.join("\0")));
}

async function fetchTaxonomy() {
  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-apikey": PUBLIC_API_KEY,
      "x-mfe-name": "mfe-plp",
      accept: "application/json",
      origin: "https://www.tesco.com",
      referer: "https://www.tesco.com/",
      "x-tesco-operation-name": "GetTaxonomy",
    },
    body: JSON.stringify({ operationName: "GetTaxonomy", query: QUERY }),
  });
  const j = await r.json();
  if (j.errors?.length) {
    throw new Error(j.errors.map((e) => e.message).join("; "));
  }
  return j.data?.taxonomy ?? [];
}

export async function loadOrFetchTaxonomy({ force = false } = {}) {
  if (!force) {
    try {
      const { readFile } = await import("node:fs/promises");
      const cached = JSON.parse(await readFile(TAXONOMY_PATH, "utf8"));
      if (cached?.leaves?.length && cached?.flat?.length) return cached;
    } catch {
      /* fetch fresh */
    }
  }

  const all = await fetchTaxonomy();
  const roots = all.filter((n) => ROOT_NAMES.has(n.name));
  const flat = flatten(roots);
  const leaves = leafNodes(flat);
  const payload = {
    updatedAt: new Date().toISOString(),
    roots,
    flat,
    leaves,
  };
  await mkdir(path.dirname(TAXONOMY_PATH), { recursive: true });
  await writeFile(TAXONOMY_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return payload;
}

const isMain =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isMain) {
  const tax = await loadOrFetchTaxonomy({ force: true });
  console.log(
    `Wrote ${TAXONOMY_PATH} — ${tax.flat.length} nodes, ${tax.leaves.length} leaves under: ` +
      tax.roots.map((r) => r.name).join(", "),
  );
}
