import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CacheEntry = { ts: number; payload: unknown };
const CACHE_TTL_MS = 60_000;

const globalForCache = globalThis as unknown as {
  __faFlightsCache?: Map<string, CacheEntry>;
};
const cache = (globalForCache.__faFlightsCache ??= new Map<string, CacheEntry>());

type FaAirport = {
  code?: string | null;
  code_iata?: string | null;
  code_icao?: string | null;
  name?: string | null;
  city?: string | null;
  timezone?: string | null;
};
type FaFlight = {
  ident?: string | null;
  registration?: string | null;
  operator?: string | null;
  operator_icao?: string | null;
  operator_iata?: string | null;
  flight_number?: string | null;
  aircraft_type?: string | null;
  origin?: FaAirport | null;
  destination?: FaAirport | null;
  scheduled_out?: string | null;
  estimated_out?: string | null;
  actual_out?: string | null;
  scheduled_off?: string | null;
  estimated_off?: string | null;
  actual_off?: string | null;
  scheduled_on?: string | null;
  estimated_on?: string | null;
  actual_on?: string | null;
  scheduled_in?: string | null;
  estimated_in?: string | null;
  actual_in?: string | null;
  progress_percent?: number | null;
  status?: string | null;
  diverted?: boolean | null;
  cancelled?: boolean | null;
  departure_delay?: number | null;  // seconds
  arrival_delay?: number | null;
  route?: string | null;
  route_distance?: number | null;
  filed_altitude?: number | null;
  filed_airspeed?: number | null;
  gate_origin?: string | null;
  gate_destination?: string | null;
  terminal_origin?: string | null;
  terminal_destination?: string | null;
  type?: string | null;
};

function airportLite(a: FaAirport | null | undefined) {
  if (!a) return null;
  return {
    code: a.code_iata || a.code_icao || a.code || null,
    icao: a.code_icao || null,
    iata: a.code_iata || null,
    name: a.name || null,
    city: a.city || null,
    timezone: a.timezone || null,
  };
}

function pickCurrentFlight(flights: FaFlight[]): FaFlight | null {
  if (!flights.length) return null;
  // 1. Any flight that has taken off but not landed.
  const inProgress = flights.find((f) => f.actual_off && !f.actual_in);
  if (inProgress) return inProgress;
  // 2. The flight whose [scheduled_out .. scheduled_in] window contains "now".
  const now = Date.now();
  const containsNow = flights.find((f) => {
    const start = f.scheduled_out ? Date.parse(f.scheduled_out) : NaN;
    const end = f.scheduled_in ? Date.parse(f.scheduled_in) : NaN;
    return !Number.isNaN(start) && !Number.isNaN(end) && start <= now && now <= end;
  });
  if (containsNow) return containsNow;
  // 3. Closest by scheduled_out (past or future).
  let best: FaFlight | null = null;
  let bestDelta = Infinity;
  for (const f of flights) {
    const t = f.scheduled_out ? Date.parse(f.scheduled_out) : NaN;
    if (Number.isNaN(t)) continue;
    const d = Math.abs(t - now);
    if (d < bestDelta) { bestDelta = d; best = f; }
  }
  return best;
}

function shape(f: FaFlight) {
  return {
    ident: f.ident ?? null,
    registration: f.registration ?? null,
    operator: f.operator_icao || f.operator || null,
    operator_iata: f.operator_iata ?? null,
    flight_number: f.flight_number ?? null,
    aircraft_type: f.aircraft_type ?? null,
    origin: airportLite(f.origin),
    destination: airportLite(f.destination),
    status: f.status ?? null,
    progress_percent: f.progress_percent ?? null,
    departure_delay: f.departure_delay ?? null,
    arrival_delay: f.arrival_delay ?? null,
    scheduled_out: f.scheduled_out ?? null,
    actual_off: f.actual_off ?? null,
    estimated_on: f.estimated_on ?? null,
    estimated_in: f.estimated_in ?? null,
    diverted: !!f.diverted,
    cancelled: !!f.cancelled,
    route: f.route ?? null,
    route_distance: f.route_distance ?? null,
    filed_altitude: f.filed_altitude ?? null,
    filed_airspeed: f.filed_airspeed ?? null,
    gate_origin: f.gate_origin ?? null,
    gate_destination: f.gate_destination ?? null,
    terminal_origin: f.terminal_origin ?? null,
    terminal_destination: f.terminal_destination ?? null,
    type: f.type ?? null,
  };
}

export async function GET(req: NextRequest) {
  const callsign = req.nextUrl.searchParams.get("callsign")?.trim().toUpperCase();
  if (!callsign) {
    return NextResponse.json({ error: "callsign required" }, { status: 400 });
  }
  const key = process.env.FLIGHTAWARE_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "missing FLIGHTAWARE_API_KEY" }, { status: 500 });
  }

  const cacheKey = callsign;
  const now = Date.now();
  const hit = cache.get(cacheKey);
  if (hit && now - hit.ts < CACHE_TTL_MS) {
    return NextResponse.json(hit.payload, {
      headers: { "x-cache": "HIT", "x-cache-age-ms": String(now - hit.ts) },
    });
  }

  try {
    const r = await fetch(
      `https://aeroapi.flightaware.com/aeroapi/flights/${encodeURIComponent(callsign)}`,
      { headers: { "x-apikey": key }, cache: "no-store" },
    );
    if (!r.ok) {
      const text = await r.text();
      const payload = { error: "upstream", status: r.status, detail: text.slice(0, 200), flight: null };
      if (r.status === 404) {
        // No flights for this callsign — cache empty result so we don't spam upstream.
        cache.set(cacheKey, { ts: now, payload: { flight: null } });
        return NextResponse.json({ flight: null }, { headers: { "x-cache": "MISS" } });
      }
      return NextResponse.json(payload, { status: 502 });
    }
    const data = (await r.json()) as { flights?: FaFlight[] };
    const current = pickCurrentFlight(data.flights ?? []);
    const payload = { flight: current ? shape(current) : null };
    cache.set(cacheKey, { ts: now, payload });
    return NextResponse.json(payload, { headers: { "x-cache": "MISS" } });
  } catch (e) {
    return NextResponse.json(
      { error: "fetch-failed", message: String(e), flight: null },
      { status: 502 },
    );
  }
}
