import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CacheEntry = { ts: number; payload: unknown };
type TokenEntry = { token: string; expiresAt: number };

const CACHE_TTL_MS = 8000;
const TOKEN_REFRESH_BUFFER_MS = 60_000;
const TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";

const globalForCache = globalThis as unknown as {
  __statesCache?: Map<string, CacheEntry>;
  __opSkyToken?: TokenEntry | null;
  __opSkyTokenPromise?: Promise<string> | null;
};
const cache = (globalForCache.__statesCache ??= new Map<string, CacheEntry>());

function bboxKey(p: URLSearchParams) {
  const round = (n: number) => Math.round(n * 10) / 10;
  const lamin = round(parseFloat(p.get("lamin") ?? "-90"));
  const lamax = round(parseFloat(p.get("lamax") ?? "90"));
  const lomin = round(parseFloat(p.get("lomin") ?? "-180"));
  const lomax = round(parseFloat(p.get("lomax") ?? "180"));
  return { key: `${lamin},${lamax},${lomin},${lomax}`, lamin, lamax, lomin, lomax };
}

async function fetchToken(): Promise<string> {
  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("OPENSKY_CLIENT_ID/SECRET not set");
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!r.ok) {
    throw new Error(`token endpoint ${r.status}`);
  }
  const j = (await r.json()) as { access_token: string; expires_in: number };
  globalForCache.__opSkyToken = {
    token: j.access_token,
    expiresAt: Date.now() + j.expires_in * 1000,
  };
  return j.access_token;
}

async function getToken(): Promise<string | null> {
  // No creds configured -> caller falls back to anonymous tier
  if (!process.env.OPENSKY_CLIENT_ID || !process.env.OPENSKY_CLIENT_SECRET) {
    return null;
  }
  const existing = globalForCache.__opSkyToken;
  if (existing && existing.expiresAt - Date.now() > TOKEN_REFRESH_BUFFER_MS) {
    return existing.token;
  }
  // De-dup concurrent refreshes
  if (!globalForCache.__opSkyTokenPromise) {
    globalForCache.__opSkyTokenPromise = fetchToken().finally(() => {
      globalForCache.__opSkyTokenPromise = null;
    });
  }
  return globalForCache.__opSkyTokenPromise;
}

async function fetchUpstream(upstream: string, retryOn401 = true): Promise<Response> {
  const token = await getToken();
  const headers: Record<string, string> = {
    "User-Agent": "fortress-flight-tracker/1.0",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const r = await fetch(upstream, { headers, cache: "no-store" });
  if (r.status === 401 && retryOn401 && token) {
    // Token may have been revoked / clock skew — refresh and retry once
    globalForCache.__opSkyToken = null;
    return fetchUpstream(upstream, false);
  }
  return r;
}

export async function GET(req: NextRequest) {
  const { key, lamin, lamax, lomin, lomax } = bboxKey(req.nextUrl.searchParams);

  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.ts < CACHE_TTL_MS) {
    return NextResponse.json(hit.payload, {
      headers: { "x-cache": "HIT", "x-cache-age-ms": String(now - hit.ts) },
    });
  }

  const upstream =
    `https://opensky-network.org/api/states/all` +
    `?lamin=${lamin}&lamax=${lamax}&lomin=${lomin}&lomax=${lomax}&extended=1`;

  try {
    const r = await fetchUpstream(upstream);
    if (!r.ok) {
      if (hit) {
        return NextResponse.json(hit.payload, {
          headers: {
            "x-cache": "STALE",
            "x-upstream-status": String(r.status),
          },
        });
      }
      return NextResponse.json(
        { error: "upstream", status: r.status, states: [] },
        { status: 502 }
      );
    }
    const data = await r.json();
    cache.set(key, { ts: now, payload: data });
    return NextResponse.json(data, {
      headers: { "x-cache": "MISS", "x-auth": process.env.OPENSKY_CLIENT_ID ? "1" : "0" },
    });
  } catch (e) {
    if (hit) {
      return NextResponse.json(hit.payload, {
        headers: { "x-cache": "STALE-ERR" },
      });
    }
    return NextResponse.json(
      { error: "fetch-failed", message: String(e), states: [] },
      { status: 502 }
    );
  }
}
