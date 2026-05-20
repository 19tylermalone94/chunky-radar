// OpenSky states proxy — single-file Node service, zero dependencies.
//
// Listens on $PORT (default 8787), exposes:
//   GET  /states?lamin=&lamax=&lomin=&lomax=
//   GET  /healthz
//
// Caches by rounded bbox for 8s in process memory. Manages OAuth2
// client_credentials token refresh against OpenSky Keycloak when
// OPENSKY_CLIENT_ID + OPENSKY_CLIENT_SECRET are set; falls back to
// anonymous tier on token failure.
//
// Designed to run behind Caddy (which terminates TLS + sets the
// Access-Control headers it forwards), but also sets permissive CORS
// itself so it's directly browser-callable for local testing.

import http from "node:http";

const PORT = parseInt(process.env.PORT ?? "8787", 10);
const CACHE_TTL_MS = 8000;
const TOKEN_REFRESH_BUFFER_MS = 60_000;
const TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";

/** @type {Map<string, {ts: number, payload: any}>} */
const cache = new Map();
/** @type {{token: string, expiresAt: number} | null} */
let cachedToken = null;
/** @type {Promise<string> | null} */
let tokenPromise = null;

async function fetchToken() {
  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("missing creds");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error(`token endpoint ${r.status}`);
  const j = await r.json();
  cachedToken = {
    token: j.access_token,
    expiresAt: Date.now() + j.expires_in * 1000,
  };
  return cachedToken.token;
}

async function getToken() {
  if (!process.env.OPENSKY_CLIENT_ID || !process.env.OPENSKY_CLIENT_SECRET) {
    return null;
  }
  if (cachedToken && cachedToken.expiresAt - Date.now() > TOKEN_REFRESH_BUFFER_MS) {
    return cachedToken.token;
  }
  if (!tokenPromise) {
    tokenPromise = fetchToken().finally(() => { tokenPromise = null; });
  }
  return tokenPromise;
}

async function fetchUpstream(url, retryOn401 = true) {
  let token = null;
  try { token = await getToken(); }
  catch (e) { console.warn("token fetch failed, anon fallback:", e.message); }
  const headers = { "User-Agent": "chunky-radar-proxy/1.0" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const r = await fetch(url, { headers });
  if (r.status === 401 && retryOn401 && token) {
    cachedToken = null;
    return fetchUpstream(url, false);
  }
  return r;
}

function bboxKey(qs) {
  const round = (n) => Math.round(n * 10) / 10;
  const lamin = round(parseFloat(qs.get("lamin") ?? "-90"));
  const lamax = round(parseFloat(qs.get("lamax") ?? "90"));
  const lomin = round(parseFloat(qs.get("lomin") ?? "-180"));
  const lomax = round(parseFloat(qs.get("lomax") ?? "180"));
  return { key: `${lamin},${lamax},${lomin},${lomax}`, lamin, lamax, lomin, lomax };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function handleStates(req, res, url) {
  const { key, lamin, lamax, lomin, lomax } = bboxKey(url.searchParams);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.ts < CACHE_TTL_MS) {
    return send(res, 200, hit.payload, {
      "x-cache": "HIT",
      "x-cache-age-ms": String(now - hit.ts),
    });
  }
  const upstream =
    `https://opensky-network.org/api/states/all` +
    `?lamin=${lamin}&lamax=${lamax}&lomin=${lomin}&lomax=${lomax}&extended=1`;
  try {
    const r = await fetchUpstream(upstream);
    if (!r.ok) {
      if (hit) return send(res, 200, hit.payload, {
        "x-cache": "STALE", "x-upstream-status": String(r.status),
      });
      return send(res, 502, { error: "upstream", status: r.status, states: [] });
    }
    const data = await r.json();
    cache.set(key, { ts: now, payload: data });
    send(res, 200, data, {
      "x-cache": "MISS",
      "x-auth": process.env.OPENSKY_CLIENT_ID ? "1" : "0",
    });
  } catch (e) {
    console.error("states fetch failed:", e);
    if (hit) return send(res, 200, hit.payload, { "x-cache": "STALE-ERR" });
    send(res, 502, { error: "fetch-failed", message: String(e), states: [] });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Max-Age": "86400",
    });
    return res.end();
  }
  if (req.method !== "GET") return send(res, 405, { error: "method not allowed" });

  if (url.pathname === "/healthz") return send(res, 200, { ok: true });
  if (url.pathname === "/states") return handleStates(req, res, url);
  return send(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`chunky-radar proxy listening on :${PORT}`);
});
