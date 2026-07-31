# PER·KCAL / tesco-protein

Explore Tesco UK grocery nutrition and rank foods by **protein per calorie** and **price per gram of protein**.

Unofficial personal tool. Not affiliated with Tesco.

## Features

- Scrapes Tesco aisle catalogues via their public GraphQL gateway ([basketeer](https://github.com/tobyandrews1985/basketeer)), walking every leaf under Fresh Food / Bakery / Frozen / Treats & Snacks / Food Cupboard / Drinks (department `/all` alone is incomplete)
- Web UI (**PER·KCAL**) to filter vegetarian foods, search, and sort by protein density or £/g protein
- Advanced filters (min % energy from protein, max fat/carbs, brand, include/exclude terms, …)
- **Star** products and review them on a dedicated page, optionally synced across devices with Google sign-in
- Docker image with persistent **`/data`** volume for scrape storage
- **Weekly GitHub Action** refreshes the committed catalogue (skips already-hydrated SKUs)

## Quick start (Docker)

```bash
docker run --rm -p 8080:8080 \
  -v tesco-protein-data:/data \
  ghcr.io/nerif-tafu/tesco-protein:1.2.0
```

Open http://localhost:8080

The image ships with a bundled catalogue. Remount `/data` to keep scrapes across restarts.

### Re-scrape into the volume

```bash
docker run --rm -v tesco-protein-data:/data \
  ghcr.io/nerif-tafu/tesco-protein:1.2.0 \
  scrape

# optional limits
docker run --rm -v tesco-protein-data:/data \
  ghcr.io/nerif-tafu/tesco-protein:1.2.0 \
  scrape --max-pages 5 --categories food-cupboard,drinks
```

Then restart the server container (same `/data` mount) to pick up the new export.

### Compose example

```yaml
services:
  tesco-protein:
    image: ghcr.io/nerif-tafu/tesco-protein:1.2.0
    ports:
      - "8080:8080"
    volumes:
      - tesco-protein-data:/data
    restart: unless-stopped

volumes:
  tesco-protein-data:
```

## Starred items & Google OAuth

Star any product to save it to the **Starred** page (`#/starred`). Starring
requires **Sign in with Google** — each Google account gets its own private list
in `/data/stars.json`, keyed by Google user id.

### Configure OAuth

1. Create an **OAuth 2.0 Web application** client in
   [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Add authorised JavaScript origins for your site (e.g. `http://127.0.0.1:5173`
   for Vite, `http://127.0.0.1:8080` for the Docker/static server).
3. Add authorised redirect URI:
   `http://127.0.0.1:5173/api/auth/callback` (and/or your production
   `https://your.domain/api/auth/callback`).
4. Pass the client credentials to the server:

```bash
docker run --rm -p 8080:8080 \
  -v tesco-protein-data:/data \
  -e GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com \
  -e GOOGLE_CLIENT_SECRET=yyyyy \
  -e PUBLIC_BASE_URL=https://your.domain \
  -e SESSION_SECRET=a-long-random-string \
  ghcr.io/nerif-tafu/tesco-protein:1.2.0
```

| Variable | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` | OAuth web client id |
| `GOOGLE_CLIENT_SECRET` | OAuth web client secret |
| `PUBLIC_BASE_URL` | Optional. Canonical public origin for redirects. If unset, derived from the request `Host` |
| `SESSION_SECRET` | Optional. Signs the session cookie (defaults to the client secret) |

Locally, run `npm start` (API on `:8080`) and `npm run dev` (Vite on `:5173` with
`/api` proxied). Sign-in uses the real Google OAuth code flow:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/auth/google` | Redirects to Google |
| `GET /api/auth/callback` | Exchanges the code, sets an httpOnly session cookie |
| `POST /api/auth/logout` | Clears the session |
| `GET /api/me` | Current account (or `null`) |
| `GET/PUT /api/stars` | That account’s starred SKUs only |

## `/data` layout

| Path | Purpose |
| --- | --- |
| `/data/products.json` | Full scrape (object keyed by SKU) |
| `/data/products.web.json` | Slim JSON served to the UI as `/products.json` |
| `/data/taxonomy.json` | Cached aisle tree + facet ids (refreshed with `--refresh-taxonomy`) |
| `/data/skus.json` | Scrape index / progress metadata |
| `/data/stars.json` | Starred SKUs per Google account (`sub`) |
| `/data/veggie-protein-rank.*` | Optional CLI rank output |

Committed copies used for incremental weekly scrapes:

| Path | Purpose |
| --- | --- |
| `catalogue/products.json` | Full scrape checked into git |
| `defaults/products.json` | Slim UI payload baked into the Docker image |

Set `DATA_DIR` to override the data root (defaults to `./data` locally, `/data` in Docker).

## Local development

```bash
npm install
cd web && npm install && cd ..

# seed runtime data from the committed catalogue, then scrape new SKUs only
npm run seed
npm run scrape
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
git tag v1.2.0
git push origin v1.2.0
```

A **weekly** workflow (`.github/workflows/weekly-scrape.yml`) also bumps the patch version, commits `catalogue/` + `defaults/`, tags, and publishes when the catalogue changes. Trigger manually via **Actions → Weekly catalogue scrape → Run workflow**.

Images: `ghcr.io/nerif-tafu/tesco-protein:<version>`

## Licence

ISC. Tesco is a trademark of its owner; this project is unofficial.
