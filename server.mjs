import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR, WEB_PRODUCTS_PATH } from "./scripts/paths.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Load KEY=VALUE pairs from a local .env without overriding real env vars. */
function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(path.resolve(__dirname, ".env"));

const PORT = Number(process.env.PORT || 8080);
const STATIC_ROOT = path.resolve(__dirname, "web", "dist");
const DEFAULTS = path.resolve(__dirname, "defaults", "products.json");
const STARS_PATH = path.join(DATA_DIR, "stars.json");

const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || "").trim();
const GOOGLE_CLIENT_SECRET = (process.env.GOOGLE_CLIENT_SECRET || "").trim();
/** Public origin of this server, used as the OAuth redirect base. */
const PUBLIC_BASE_URL_ENV = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
const SESSION_SECRET =
  (process.env.SESSION_SECRET || "").trim() ||
  GOOGLE_CLIENT_SECRET ||
  "dev-only-change-me";
const SESSION_COOKIE = "perkcal_session";
const OAUTH_STATE_COOKIE = "perkcal_oauth";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_BODY_BYTES = 256 * 1024;
const MAX_STARS = 5000;
const OAUTH_CONFIGURED = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);

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
    "Cache-Control":
      ext === ".html" || ext === ".json" ? "no-cache" : "public, max-age=86400",
  });
  createReadStream(filePath).pipe(res);
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function cookieHeader(name, value, { maxAgeSec, clear = false, secure = false } = {}) {
  const parts = [
    `${name}=${clear ? "" : encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  if (clear) parts.push("Max-Age=0");
  else if (typeof maxAgeSec === "number") parts.push(`Max-Age=${maxAgeSec}`);
  return parts.join("; ");
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function signPayload(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac("sha256", SESSION_SECRET).update(body).digest());
  return `${body}.${sig}`;
}

function verifySigned(token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = b64url(
    createHmac("sha256", SESSION_SECRET).update(body).digest(),
  );
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(fromB64url(body).toString("utf8"));
  } catch {
    return null;
  }
}

function publicAccount(session) {
  if (!session) return null;
  return {
    sub: session.sub,
    email: session.email ?? null,
    name: session.name ?? null,
    picture: session.picture ?? null,
  };
}

function readSession(req) {
  const cookies = parseCookies(req);
  const payload = verifySigned(cookies[SESSION_COOKIE]);
  if (!payload?.sub || typeof payload.exp !== "number") return null;
  if (payload.exp <= Date.now()) return null;
  return payload;
}

function requestBaseUrl(req) {
  if (PUBLIC_BASE_URL_ENV) return PUBLIC_BASE_URL_ENV;
  const host = req.headers["x-forwarded-host"] || req.headers.host || `127.0.0.1:${PORT}`;
  const protoHeader = req.headers["x-forwarded-proto"];
  const proto =
    (Array.isArray(protoHeader) ? protoHeader[0] : protoHeader) ||
    (String(host).includes("localhost") || String(host).startsWith("127.")
      ? "http"
      : "https");
  return `${proto}://${host}`.replace(/\/$/, "");
}

function oauthRedirectUri(req) {
  return `${requestBaseUrl(req)}/api/auth/callback`;
}

function sanitizeReturnTo(raw) {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) {
    return "/#/starred";
  }
  return raw.slice(0, 200);
}

function sanitizeStars(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [sku, at] of Object.entries(raw)) {
    if (Object.keys(out).length >= MAX_STARS) break;
    if (/^[\w-]{1,40}$/.test(sku) && Number.isFinite(at) && at > 0) {
      out[sku] = Math.floor(at);
    }
  }
  return out;
}

// Serialise reads/writes so concurrent tabs can't clobber the file.
let starsQueue = Promise.resolve();

function withStarsFile(fn) {
  const run = starsQueue.then(fn, fn);
  starsQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readStarsFile() {
  if (!existsSync(STARS_PATH)) return {};
  try {
    const parsed = JSON.parse(await readFile(STARS_PATH, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeStarsFile(all) {
  const tmp = `${STARS_PATH}.tmp`;
  await writeFile(tmp, JSON.stringify(all));
  await rename(tmp, STARS_PATH);
}

async function exchangeCode(code, redirectUri) {
  const body = new URLSearchParams({
    code,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function fetchUserInfo(accessToken) {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Userinfo failed (${res.status})`);
  return res.json();
}

async function handleApi(req, res, pathname, searchParams) {
  const baseUrl = requestBaseUrl(req);
  const secure = baseUrl.startsWith("https://");

  if (pathname === "/api/config") {
    sendJson(res, 200, {
      oauthEnabled: OAUTH_CONFIGURED,
      publicBaseUrl: baseUrl,
      redirectUri: oauthRedirectUri(req),
    });
    return true;
  }

  if (pathname === "/api/me") {
    sendJson(res, 200, { account: publicAccount(readSession(req)) });
    return true;
  }

  if (pathname === "/api/auth/google" && req.method === "GET") {
    if (!OAUTH_CONFIGURED) {
      sendJson(res, 503, {
        error:
          "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
      });
      return true;
    }
    const state = randomBytes(24).toString("hex");
    const returnTo = sanitizeReturnTo(searchParams.get("returnTo") || "/#/starred");
    const redirectUri = oauthRedirectUri(req);
    const oauthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    oauthUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
    oauthUrl.searchParams.set("redirect_uri", redirectUri);
    oauthUrl.searchParams.set("response_type", "code");
    oauthUrl.searchParams.set("scope", "openid email profile");
    oauthUrl.searchParams.set("access_type", "online");
    oauthUrl.searchParams.set("include_granted_scopes", "true");
    oauthUrl.searchParams.set("prompt", "select_account");
    oauthUrl.searchParams.set("state", state);

    res.writeHead(302, {
      Location: oauthUrl.toString(),
      "Set-Cookie": [
        cookieHeader(
          OAUTH_STATE_COOKIE,
          signPayload({ state, returnTo, redirectUri }),
          { maxAgeSec: 600, secure },
        ),
      ],
    });
    res.end();
    return true;
  }

  if (pathname === "/api/auth/callback" && req.method === "GET") {
    if (!OAUTH_CONFIGURED) {
      sendJson(res, 503, { error: "Google OAuth is not configured" });
      return true;
    }

    const cookies = parseCookies(req);
    const oauthState = verifySigned(cookies[OAUTH_STATE_COOKIE]);
    const state = searchParams.get("state");
    const code = searchParams.get("code");
    const oauthError = searchParams.get("error");

    const clearOauth = cookieHeader(OAUTH_STATE_COOKIE, "", {
      clear: true,
      secure,
    });
    const fail = (message) => {
      const dest = new URL(baseUrl);
      dest.hash = `/starred?authError=${encodeURIComponent(message)}`;
      res.writeHead(302, {
        Location: dest.toString(),
        "Set-Cookie": clearOauth,
      });
      res.end();
    };

    if (oauthError) return fail(oauthError);
    if (!code || !state || !oauthState?.state || oauthState.state !== state) {
      return fail("Sign-in was cancelled or expired. Try again.");
    }

    try {
      const redirectUri =
        typeof oauthState.redirectUri === "string"
          ? oauthState.redirectUri
          : oauthRedirectUri(req);
      const tokens = await exchangeCode(code, redirectUri);
      const profile = await fetchUserInfo(tokens.access_token);
      if (!profile?.sub) throw new Error("Google profile missing subject");

      const session = {
        sub: String(profile.sub),
        email: profile.email ?? null,
        name: profile.name ?? profile.given_name ?? null,
        picture: profile.picture ?? null,
        exp: Date.now() + SESSION_TTL_MS,
      };

      const returnTo = sanitizeReturnTo(oauthState.returnTo);
      const dest = new URL(returnTo, baseUrl);
      res.writeHead(302, {
        Location: dest.toString(),
        "Set-Cookie": [
          cookieHeader(SESSION_COOKIE, signPayload(session), {
            maxAgeSec: Math.floor(SESSION_TTL_MS / 1000),
            secure,
          }),
          clearOauth,
        ],
      });
      res.end();
    } catch (err) {
      console.error("OAuth callback failed:", err);
      return fail("Could not complete Google sign-in.");
    }
    return true;
  }

  if (pathname === "/api/auth/logout" && req.method === "POST") {
    sendJson(
      res,
      200,
      { ok: true },
      {
        "Set-Cookie": cookieHeader(SESSION_COOKIE, "", {
          clear: true,
          secure,
        }),
      },
    );
    return true;
  }

  if (pathname === "/api/stars") {
    const session = readSession(req);
    if (!session) {
      sendJson(res, 401, { error: "Sign in with Google to save starred items" });
      return true;
    }

    if (req.method === "GET") {
      const all = await withStarsFile(readStarsFile);
      sendJson(res, 200, { stars: all[session.sub]?.stars ?? {} });
      return true;
    }

    if (req.method === "PUT") {
      let payload;
      try {
        payload = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: "Invalid JSON body" });
        return true;
      }
      const stars = sanitizeStars(payload?.stars);
      await withStarsFile(async () => {
        const all = await readStarsFile();
        all[session.sub] = {
          email: session.email,
          name: session.name,
          updatedAt: Date.now(),
          stars,
        };
        await writeStarsFile(all);
      });
      sendJson(res, 200, { stars });
      return true;
    }

    sendJson(res, 405, { error: "Method not allowed" });
    return true;
  }

  return false;
}

const productsFile = await ensureWebProducts();
console.log(`Catalogue: ${productsFile}`);
console.log(`Static:    ${STATIC_ROOT}`);
console.log(`Data dir:  ${DATA_DIR}`);
console.log(`Public:    ${PUBLIC_BASE_URL_ENV || "(derived from request Host)"}`);
console.log(
  `Google:    ${
    OAUTH_CONFIGURED
      ? "OAuth enabled — register /api/auth/callback on your public origin"
      : "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET unset"
  }`,
);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    const pathname = url.pathname;

    if (pathname.startsWith("/api/")) {
      if (await handleApi(req, res, pathname, url.searchParams)) return;
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    if (pathname === "/products.json") {
      const live = existsSync(WEB_PRODUCTS_PATH) ? WEB_PRODUCTS_PATH : productsFile;
      return sendFile(res, live);
    }

    if (pathname === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }

    let filePath = safeJoin(STATIC_ROOT, pathname === "/" ? "/index.html" : pathname);
    if (!filePath) {
      res.writeHead(400).end("Bad request");
      return;
    }

    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }

    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
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
