# PER·KCAL / tesco-protein

Explore Tesco UK grocery nutrition and rank foods by **protein per calorie** and **price per gram of protein**.

Unofficial personal tool. Not affiliated with Tesco.

## Features

- Scrapes Tesco category catalogues via their public GraphQL gateway ([basketeer](https://github.com/tobyandrews1985/basketeer))
- Web UI (**PER·KCAL**) to filter vegetarian / vegan foods, search, and sort by protein density or £/g protein
- Advanced filters (min % energy from protein, max fat/carbs, brand, include/exclude terms, …)
- Docker image with persistent **`/data`** volume for scrape storage

## Quick start (Docker)

```bash
docker run --rm -p 8080:8080 \
  -v tesco-protein-data:/data \
  ghcr.io/nerif-tafu/tesco-protein:1.0.0
```

Open http://localhost:8080

The image ships with a bundled catalogue. Remount `/data` to keep scrapes across restarts.

### Re-scrape into the volume

```bash
docker run --rm -v tesco-protein-data:/data \
  ghcr.io/nerif-tafu/tesco-protein:1.0.0 \
  scrape

# optional limits
docker run --rm -v tesco-protein-data:/data \
  ghcr.io/nerif-tafu/tesco-protein:1.0.0 \
  scrape --max-pages 5 --categories food-cupboard,drinks
```

Then restart the server container (same `/data` mount) to pick up the new export.

### Compose example

```yaml
services:
  tesco-protein:
    image: ghcr.io/nerif-tafu/tesco-protein:1.0.0
    ports:
      - "8080:8080"
    volumes:
      - tesco-protein-data:/data
    restart: unless-stopped

volumes:
  tesco-protein-data:
```

## `/data` layout

| Path | Purpose |
| --- | --- |
| `/data/products.json` | Full scrape (object keyed by SKU) |
| `/data/products.web.json` | Slim JSON served to the UI as `/products.json` |
| `/data/skus.json` | Scrape index / progress metadata |
| `/data/veggie-protein-rank.*` | Optional CLI rank output |

Set `DATA_DIR` to override the data root (defaults to `./data` locally, `/data` in Docker).

## Local development

```bash
npm install
cd web && npm install && cd ..

# needs a prior scrape (or copy defaults)
npm run scrape -- --max-pages 1 --categories food-cupboard
npm run export-web
npm run dev
```

CLI rank:

```bash
npm run rank -- --top 30 --csv
npm run rank -- --vegan --min-kcal 40
```

## Cheapest high-protein foods (UI)

1. Sort → **Price / g protein (cheap→dear)**
2. Advanced → **Min % energy from protein** = `30` (configurable)
3. Enable **Only products with a calculable £/g protein**

## Versioning & releases

Semver tags drive GHCR publishes:

| Tag | Images pushed |
| --- | --- |
| `v1.2.3` | `:1.2.3`, `:v1.2.3`, `:1.2`, `:1`, `:latest` |

```bash
git tag v1.0.0
git push origin v1.0.0
```

Images: `ghcr.io/nerif-tafu/tesco-protein:<version>`

## Licence

ISC. Tesco is a trademark of its owner; this project is unofficial.
