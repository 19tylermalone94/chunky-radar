"use client";

import { useEffect, useRef, useState } from "react";

/* ============================================================
   Constants
   ============================================================ */
const TILE_SIZE = 256;
const PIXEL_FACTOR = 14;
const POLL_INTERVAL = 10000;
const MAX_ZOOM = 12;
const MIN_ZOOM = 2;

const PALETTE: [number, number, number][] = [
  [  8, 14, 36],
  [ 24, 44, 80],
  [ 50, 90, 130],
  [110, 170, 190],
  [ 18, 44, 26],
  [ 46, 88, 44],
  [110, 150, 64],
  [180, 180, 84],
  [210, 180, 120],
  [150, 108, 70],
  [ 70, 64, 58],
  [140, 128, 118],
  [225, 225, 228],
  [245, 245, 245],
  [ 28, 22, 20],
  [220, 120, 50],
];

const PALETTE_CHARS = [
  "~", "~", "≈", "≈",
  "♣", "♣", ".", ".",
  "░", "░", "▲", "▲",
  "*", "*", " ", "#",
];

const PALETTE_TEXT = [
  "#3cf", "#6cf", "#9ef", "#cff",
  "#3a3", "#5f5", "#bf6", "#ff5",
  "#fc8", "#c84", "#aaa", "#ddd",
  "#fff", "#fff", "#444", "#f72",
];

/* ============================================================
   Tile math
   ============================================================ */
function lonToTileX(lon: number, z: number) { return (lon + 180) / 360 * (1 << z); }
function latToTileY(lat: number, z: number) {
  const rad = lat * Math.PI / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * (1 << z);
}
function tileXToLon(x: number, z: number) { return x / (1 << z) * 360 - 180; }
function tileYToLat(y: number, z: number) {
  const n = Math.PI - 2 * Math.PI * y / (1 << z);
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function tileURL(z: number, x: number, y: number) {
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
}

function nearestPaletteIndex(r: number, g: number, b: number) {
  let best = 0, bd = Infinity;
  for (let p = 0; p < PALETTE.length; p++) {
    const dr = r - PALETTE[p][0];
    const dg = g - PALETTE[p][1];
    const db = b - PALETTE[p][2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

function imageForCategory(cat: number | null): string {
  switch (cat) {
    case 2: case 12: return "/aircraft/light.jpg";
    case 3: return "/aircraft/regional.jpg";
    case 4: case 5: return "/aircraft/airliner.jpg";
    case 6: return "/aircraft/heavy.jpg";
    case 7: return "/aircraft/fighter.jpg";
    case 8: return "/aircraft/helicopter.jpg";
    case 9: return "/aircraft/glider.jpg";
    case 10: return "/aircraft/lta.jpg";
    case 14: case 15: return "/aircraft/uav.jpg";
    case 16: case 17: return "/aircraft/surface.jpg";
    case 18: case 19: case 20: return "/aircraft/obstacle.jpg";
    default: return "/aircraft/generic.jpg";
  }
}

/* ============================================================
   Types
   ============================================================ */
type Aircraft = {
  id: string;            // icao24 hex
  callsign: string;
  country: string;
  timePosition: number | null;   // unix s, last position update
  lastContact: number | null;    // unix s, any contact
  lon: number;
  lat: number;
  alt: number | null;            // baro alt (m)
  onGround: boolean;
  vel: number | null;            // m/s
  hdg: number | null;            // deg, true_track
  vrate: number | null;          // m/s
  sensors: number[] | null;
  geoAlt: number | null;         // m
  squawk: string | null;
  spi: boolean;
  posSource: number | null;      // 0 ADS-B, 1 ASTERIX, 2 MLAT, 3 FLARM
  category: number | null;       // 0..20
};

type TileEntry = { img: HTMLImageElement; loaded: boolean; failed: boolean };

type Airport = {
  code: string | null;
  icao: string | null;
  iata: string | null;
  name: string | null;
  city: string | null;
  timezone: string | null;
};
type Enrichment = {
  ident: string | null;
  registration: string | null;
  operator: string | null;
  operator_iata: string | null;
  flight_number: string | null;
  aircraft_type: string | null;
  origin: Airport | null;
  destination: Airport | null;
  status: string | null;
  progress_percent: number | null;
  departure_delay: number | null;
  arrival_delay: number | null;
  scheduled_out: string | null;
  actual_off: string | null;
  estimated_on: string | null;
  estimated_in: string | null;
  diverted: boolean;
  cancelled: boolean;
  route: string | null;
  route_distance: number | null;
  filed_altitude: number | null;
  filed_airspeed: number | null;
  gate_origin: string | null;
  gate_destination: string | null;
  terminal_origin: string | null;
  terminal_destination: string | null;
  type: string | null;
};

type StateField = string | number | boolean | number[] | null;
type OpenSkyResponse = {
  time?: number;
  states?: StateField[][];
  error?: string;
};

type Airborne = "all" | "air" | "ground";

type Filters = {
  airborne: Airborne;
  altLow: boolean; altMid: boolean; altHigh: boolean; altUnknown: boolean;
  vsClimb: boolean; vsLevel: boolean; vsDescend: boolean; vsUnknown: boolean;
  callsign: string;
  country: string;
  cats: boolean[];        // index 0..20
  catMissing: boolean;    // category === null
  emergencyOnly: boolean;
  showCities: boolean;
};
const DEFAULT_FILTERS: Filters = {
  airborne: "all",
  altLow: true, altMid: true, altHigh: true, altUnknown: true,
  vsClimb: true, vsLevel: true, vsDescend: true, vsUnknown: true,
  callsign: "",
  country: "",
  cats: Array.from({ length: 21 }, () => true),
  catMissing: true,
  emergencyOnly: false,
  showCities: true,
};

// public/data/cities.json — [name, lat, lon, population], sorted desc by pop.
type City = [string, number, number, number];

function cityPopThreshold(z: number): number {
  if (z <= 2) return 5_000_000;
  if (z === 3) return 2_000_000;
  if (z === 4) return 1_000_000;
  if (z === 5) return 500_000;
  if (z === 6) return 250_000;
  return 100_000;
}

const CATEGORY_SHORT: Record<number, string> = {
  0: "UNKNOWN",
  1: "NO ADS-B",
  2: "LIGHT",
  3: "SMALL",
  4: "LARGE",
  5: "HVL",
  6: "HEAVY",
  7: "HIGH PERF",
  8: "ROTOR",
  9: "GLIDER",
  10: "LTA",
  11: "PARACHUTE",
  12: "ULTRALIGHT",
  13: "RESERVED",
  14: "UAV",
  15: "SPACE",
  16: "SURF EMERG",
  17: "SURF SVC",
  18: "PT OBS",
  19: "CL OBS",
  20: "LN OBS",
};

const CATEGORY_LABEL: Record<number, string> = {
  0: "Unknown",
  1: "No ADS-B info",
  2: "Light (<15.5k lb)",
  3: "Small (15.5k–75k lb)",
  4: "Large (75k–300k lb)",
  5: "Large High Vortex",
  6: "Heavy (>300k lb)",
  7: "High Performance",
  8: "Rotorcraft",
  9: "Glider / sailplane",
  10: "Lighter-than-air",
  11: "Parachutist",
  12: "Ultralight",
  13: "Reserved",
  14: "UAV",
  15: "Space vehicle",
  16: "Surface — Emergency Vehicle",
  17: "Surface — Service Vehicle",
  18: "Point Obstacle",
  19: "Cluster Obstacle",
  20: "Line Obstacle",
};
const POSITION_SOURCE: Record<number, string> = {
  0: "ADS-B",
  1: "ASTERIX",
  2: "MLAT",
  3: "FLARM",
};

function emergencyFromSquawk(sq: string | null): string | null {
  if (sq === "7500") return "HIJACK";
  if (sq === "7600") return "NORDO";
  if (sq === "7700") return "EMERGENCY";
  return null;
}

function logCategoryHistogram(list: Aircraft[]) {
  const h: Record<string, number> = {};
  for (const a of list) {
    const k = a.category == null ? "null" : String(a.category);
    h[k] = (h[k] ?? 0) + 1;
  }
  const rows = Object.keys(h)
    .sort((a, b) => (a === "null" ? 99 : Number(a)) - (b === "null" ? 99 : Number(b)))
    .map((k) => {
      const label =
        k === "null" ? "(missing)" : CATEGORY_LABEL[Number(k)] ?? "?";
      const pct = ((h[k] / list.length) * 100).toFixed(1);
      return { cat: k, label, count: h[k], pct: pct + "%" };
    });
  console.groupCollapsed(
    `%cOpenSky categories — ${list.length} aircraft in bbox`,
    "color:#ffb000;font-weight:bold"
  );
  console.table(rows);
  console.groupEnd();
}

function formatAgo(t: number | null, nowSec: number): string {
  if (t == null) return "—";
  const d = Math.max(0, Math.floor(nowSec - t));
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  return `${Math.floor(d / 3600)}h ago`;
}

/* ============================================================
   Profile panel
   ============================================================ */
function fmt(n: number, digits = 0): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function ProfileImage({ src }: { src: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const small = document.createElement("canvas");
    const sctx = small.getContext("2d", { willReadFrequently: true });
    if (!sctx) return;

    const PX = 2; // chunky-pixel size in display px (lower = finer detail)
    const w = canvas.width, h = canvas.height;
    const sw = Math.max(1, Math.ceil(w / PX));
    const sh = Math.max(1, Math.ceil(h / PX));
    small.width = sw; small.height = sh;

    const img = new Image();
    img.crossOrigin = "anonymous";
    let cancelled = false;
    img.onload = () => {
      if (cancelled) return;
      sctx.imageSmoothingEnabled = true;
      // contain (letterbox) so we don't crop the silhouette weirdly
      const ar = img.width / img.height;
      const tAr = sw / sh;
      let dw = sw, dh = sh, dx = 0, dy = 0;
      if (ar > tAr) { dh = Math.round(sw / ar); dy = Math.floor((sh - dh) / 2); }
      else { dw = Math.round(sh * ar); dx = Math.floor((sw - dw) / 2); }
      sctx.fillStyle = "#0a0a0a";
      sctx.fillRect(0, 0, sw, sh);
      sctx.drawImage(img, dx, dy, dw, dh);
      const id = sctx.getImageData(0, 0, sw, sh);
      const d = id.data;
      for (let i = 0; i < d.length; i += 4) {
        const idx = nearestPaletteIndex(d[i], d[i + 1], d[i + 2]);
        d[i]     = PALETTE[idx][0];
        d[i + 1] = PALETTE[idx][1];
        d[i + 2] = PALETTE[idx][2];
      }
      sctx.putImageData(id, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(small, 0, 0, sw, sh, 0, 0, w, h);
    };
    img.src = src;
    return () => { cancelled = true; };
  }, [src]);
  return <canvas ref={canvasRef} width={252} height={140} className="profile-image" />;
}

function formatDelay(secs: number | null | undefined): string {
  if (secs == null) return "—";
  if (Math.abs(secs) < 60) return "ON TIME";
  const m = Math.round(Math.abs(secs) / 60);
  return secs < 0 ? `${m} min early` : `${m} min late`;
}

function formatLocalTime(iso: string | null | undefined, tz: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  try {
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit", minute: "2-digit",
      timeZone: tz || undefined,
      timeZoneName: tz ? "short" : undefined,
    });
  } catch {
    return d.toISOString().slice(11, 16) + "Z";
  }
}

function progressBar(pct: number, width = 16): string {
  const p = Math.max(0, Math.min(100, pct));
  const filled = Math.round((p / 100) * width);
  return "[" + "█".repeat(filled) + "░".repeat(width - filled) + `] ${Math.round(p)}%`;
}

function ProfilePanel({
  a,
  nowSec,
  enrichment,
  enrichmentLoading,
  onClose,
}: {
  a: Aircraft;
  nowSec: number;
  enrichment: Enrichment | null;
  enrichmentLoading: boolean;
  onClose: () => void;
}) {
  const emergency = emergencyFromSquawk(a.squawk);
  const altBaroFt = a.alt != null ? a.alt * 3.28084 : null;
  const altGeoFt = a.geoAlt != null ? a.geoAlt * 3.28084 : null;
  const spdKt = a.vel != null ? a.vel * 1.94384 : null;
  const spdKmh = a.vel != null ? a.vel * 3.6 : null;
  const vsFpm = a.vrate != null ? a.vrate * 196.8504 : null;
  const trend =
    a.vrate == null ? "—"
      : a.vrate > 1 ? "CLIMBING"
      : a.vrate < -1 ? "DESCENDING"
      : "LEVEL";
  const catLabel = a.category != null ? CATEGORY_LABEL[a.category] ?? "?" : "—";
  const srcLabel = a.posSource != null ? POSITION_SOURCE[a.posSource] ?? "?" : "—";

  const callsignFlat = (a.callsign || "").replace(/\s+/g, "");
  const fa = callsignFlat
    ? `https://flightaware.com/live/flight/${encodeURIComponent(callsignFlat)}`
    : null;
  const adsbx = `https://globe.adsbexchange.com/?icao=${encodeURIComponent(a.id)}`;
  const osky = `https://opensky-network.org/data/aircraft?icao24=${encodeURIComponent(a.id)}`;

  return (
    <aside className="profile">
      <button className="profile-close" onClick={onClose} aria-label="Close">×</button>
      <ProfileImage src={imageForCategory(a.category)} />
      <h2 className="profile-title">{a.callsign.toUpperCase() || a.id.toUpperCase()}</h2>
      <div className="profile-sub">ICAO24 {a.id.toUpperCase()}</div>

      {emergency && (
        <div className="profile-emergency">! {emergency} (SQUAWK {a.squawk})</div>
      )}

      <h3>POSITION</h3>
      <Row k="LAT" v={`${a.lat.toFixed(4)}°`} />
      <Row k="LON" v={`${a.lon.toFixed(4)}°`} />
      <Row k="ON GND" v={a.onGround ? "YES" : "NO"} />
      <Row k="POS AGE" v={formatAgo(a.timePosition, nowSec)} />
      <Row k="CONTACT" v={formatAgo(a.lastContact, nowSec)} />

      <h3>MOTION</h3>
      <Row k="ALT BARO" v={altBaroFt != null ? `${fmt(altBaroFt)} ft` : "—"} sub={a.alt != null ? `${fmt(a.alt)} m` : undefined} />
      <Row k="ALT GEO" v={altGeoFt != null ? `${fmt(altGeoFt)} ft` : "—"} sub={a.geoAlt != null ? `${fmt(a.geoAlt)} m` : undefined} />
      <Row k="SPD" v={spdKt != null ? `${fmt(spdKt)} kt` : "—"} sub={spdKmh != null ? `${fmt(spdKmh)} km/h` : undefined} />
      <Row k="HDG" v={a.hdg != null ? `${fmt(a.hdg, 1)}°` : "—"} />
      <Row k="V/S" v={vsFpm != null ? `${fmt(vsFpm)} fpm` : "—"} sub={trend !== "—" ? trend : undefined} />

      <h3>META</h3>
      <Row k="COUNTRY" v={a.country || "—"} />
      <Row k="CATEGORY" v={catLabel} />
      <Row k="SQUAWK" v={a.squawk || "—"} />
      <Row k="SPI" v={a.spi ? "YES" : "NO"} />
      <Row k="SOURCE" v={srcLabel} />
      <Row k="SENSORS" v={a.sensors ? String(a.sensors.length) : "—"} />

      {enrichmentLoading && <div className="profile-loading">LOADING FA DATA…</div>}

      {enrichment && (
        <>
          <h3>AIRCRAFT</h3>
          <Row k="REG" v={enrichment.registration ?? "—"} />
          <Row k="TYPE" v={enrichment.aircraft_type ?? "—"} />
          <Row
            k="OPERATOR"
            v={enrichment.operator ?? "—"}
            sub={enrichment.operator_iata && enrichment.operator !== enrichment.operator_iata
              ? enrichment.operator_iata
              : undefined}
          />
          <Row k="OP TYPE" v={enrichment.type ?? "—"} />

          {(enrichment.origin || enrichment.destination) && (
            <>
              <h3>ROUTE</h3>
              <div className="profile-route">
                {enrichment.origin?.code ?? "?"} → {enrichment.destination?.code ?? "?"}
              </div>
              <Row
                k="FROM"
                v={enrichment.origin?.name ?? enrichment.origin?.code ?? "—"}
                sub={enrichment.origin?.city ?? undefined}
              />
              <Row
                k="TO"
                v={enrichment.destination?.name ?? enrichment.destination?.code ?? "—"}
                sub={enrichment.destination?.city ?? undefined}
              />
              {enrichment.route_distance != null && (
                <Row k="DIST" v={`${fmt(enrichment.route_distance)} nm`} />
              )}
            </>
          )}

          <h3>FLIGHT</h3>
          <Row k="STATUS" v={enrichment.status ?? "—"} />
          {enrichment.progress_percent != null && (
            <div className="profile-progress">{progressBar(enrichment.progress_percent)}</div>
          )}
          <Row k="DEP" v={formatDelay(enrichment.departure_delay)} />
          <Row k="ARR" v={formatDelay(enrichment.arrival_delay)} />
          <Row
            k="ETA"
            v={formatLocalTime(enrichment.estimated_in, enrichment.destination?.timezone ?? null)}
          />
          <Row k="OFF" v={formatLocalTime(enrichment.actual_off, enrichment.origin?.timezone ?? null)} />
          {(enrichment.diverted || enrichment.cancelled) && (
            <div className="profile-emergency">
              ! {enrichment.diverted ? "DIVERTED" : "CANCELLED"}
            </div>
          )}

          {(enrichment.filed_altitude || enrichment.filed_airspeed ||
            enrichment.route || enrichment.gate_origin || enrichment.gate_destination) && (
            <>
              <h3>FILED</h3>
              {enrichment.filed_altitude != null && (
                <Row k="ALT" v={`FL${enrichment.filed_altitude}`} />
              )}
              {enrichment.filed_airspeed != null && (
                <Row k="SPD" v={`${enrichment.filed_airspeed} kt`} />
              )}
              {enrichment.route && <Row k="ROUTE" v={enrichment.route} />}
              {enrichment.gate_origin && <Row k="GATE OUT" v={enrichment.gate_origin} />}
              {enrichment.gate_destination && <Row k="GATE IN" v={enrichment.gate_destination} />}
            </>
          )}
        </>
      )}

      <h3>LINKS</h3>
      <div className="profile-links">
        {fa && (
          <a href={fa} target="_blank" rel="noopener noreferrer">FLIGHTAWARE</a>
        )}
        <a href={adsbx} target="_blank" rel="noopener noreferrer">ADSB EXCHANGE</a>
        <a href={osky} target="_blank" rel="noopener noreferrer">OPENSKY</a>
      </div>
    </aside>
  );
}

function Row({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="profile-row">
      <span className="profile-k">{k}</span>
      <span className="profile-v">
        {v}
        {sub && <span className="profile-vsub"> {sub}</span>}
      </span>
    </div>
  );
}

/* ============================================================
   Component
   ============================================================ */
export default function FlightTracker() {
  const mapCanvasRef = useRef<HTMLCanvasElement>(null);
  const charCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef<HTMLDivElement>(null);

  // UI state shown in chrome
  const [bbox, setBbox] = useState("--");
  const [planeCount, setPlaneCount] = useState(0);
  const [updated, setUpdated] = useState("--:--:--");
  const [zoomLabel, setZoomLabel] = useState(4);
  const [status, setStatus] = useState<"BOOT" | "FETCH" | "OK" | "ERR">("BOOT");
  const [statusBlink, setStatusBlink] = useState(true);
  const [visibleCount, setVisibleCount] = useState(0);
  const [selectedAircraft, setSelectedAircraft] = useState<Aircraft | null>(null);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  const [enrichment, setEnrichment] = useState<Enrichment | null>(null);
  const [enrichmentLoading, setEnrichmentLoading] = useState(false);
  // City dataset loaded once. Held in a ref so the canvas effect reads
  // the latest copy without needing to re-bind.
  const citiesRef = useRef<City[]>([]);

  // Fetch FlightAware enrichment whenever the selected aircraft's identity changes.
  const selId = selectedAircraft?.id ?? null;
  const selCallsign = selectedAircraft?.callsign ?? null;
  useEffect(() => {
    if (!selId) {
      setEnrichment(null);
      setEnrichmentLoading(false);
      return;
    }
    // No callsign -> nothing useful to look up.
    if (!selCallsign || selCallsign === selId) {
      setEnrichment(null);
      setEnrichmentLoading(false);
      return;
    }
    const ac = new AbortController();
    setEnrichment(null);
    setEnrichmentLoading(true);
    fetch(
      `/api/aircraft/${encodeURIComponent(selId)}?callsign=${encodeURIComponent(selCallsign)}`,
      { signal: ac.signal },
    )
      .then((r) => r.json())
      .then((j) => {
        setEnrichment(j.flight ?? null);
        setEnrichmentLoading(false);
      })
      .catch((e) => {
        if ((e as Error).name !== "AbortError") {
          setEnrichment(null);
          setEnrichmentLoading(false);
        }
      });
    return () => ac.abort();
  }, [selId, selCallsign]);

  // Filters: ref for the render loop to read live; state for the panel inputs.
  const filtersRef = useRef<Filters>(DEFAULT_FILTERS);
  const [filters, setFiltersState] = useState<Filters>(DEFAULT_FILTERS);
  const dirtyRef = useRef(true);
  const selectedIdRef = useRef<string | null>(null);

  // Tick "now" once a second so age fields refresh.
  useEffect(() => {
    const id = window.setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Fetch cities once.
  useEffect(() => {
    let cancelled = false;
    fetch("/data/cities.json")
      .then((r) => r.json())
      .then((data: City[]) => {
        if (cancelled) return;
        citiesRef.current = data;
        dirtyRef.current = true;
      })
      .catch((e) => console.warn("cities load failed:", e));
    return () => { cancelled = true; };
  }, []);

  function patchFilters(patch: Partial<Filters>) {
    filtersRef.current = { ...filtersRef.current, ...patch };
    setFiltersState(filtersRef.current);
    dirtyRef.current = true;
  }
  function resetFilters() {
    filtersRef.current = { ...DEFAULT_FILTERS };
    setFiltersState(filtersRef.current);
    dirtyRef.current = true;
  }

  useEffect(() => {
    const mapCanvas = mapCanvasRef.current!;
    const charCanvas = charCanvasRef.current!;
    const container = containerRef.current!;
    const tooltip = tooltipRef.current!;
    const loading = loadingRef.current!;

    const composeCanvas = document.createElement("canvas");
    const smallCanvas = document.createElement("canvas");
    const mapCtx = mapCanvas.getContext("2d")!;
    const charCtx = charCanvas.getContext("2d")!;
    const composeCtx = composeCanvas.getContext("2d")!;
    const smallCtx = smallCanvas.getContext("2d", { willReadFrequently: true })!;

    const view = { centerLat: 39.5, centerLon: -98.0, zoom: 4 };
    const tileCache = new Map<string, TileEntry>();
    let pendingTileLoads = 0;
    let aircraft: Aircraft[] = [];
    let lastFetchTime = 0;
    let lastFetchOk = false;
    let hoveredAircraft: Aircraft | null = null;
    let quantIndices: Uint8Array | null = null;
    let smallW = 0;
    let smallH = 0;
    let rafHandle = 0;
    let lastVisibleCount = -1;

    function passesFilter(a: Aircraft): boolean {
      const f = filtersRef.current;
      if (f.airborne === "air" && a.onGround) return false;
      if (f.airborne === "ground" && !a.onGround) return false;
      const altFt = a.alt == null ? null : a.alt * 3.28084;
      if (altFt == null) {
        if (!f.altUnknown) return false;
      } else if (altFt < 10000) {
        if (!f.altLow) return false;
      } else if (altFt < 30000) {
        if (!f.altMid) return false;
      } else {
        if (!f.altHigh) return false;
      }
      const vr = a.vrate;
      if (vr == null) {
        if (!f.vsUnknown) return false;
      } else if (vr > 1) {
        if (!f.vsClimb) return false;
      } else if (vr < -1) {
        if (!f.vsDescend) return false;
      } else {
        if (!f.vsLevel) return false;
      }
      if (f.callsign) {
        const q = f.callsign.toUpperCase();
        if (!a.callsign.toUpperCase().includes(q)) return false;
      }
      if (f.country) {
        const q = f.country.toLowerCase();
        if (!a.country.toLowerCase().includes(q)) return false;
      }
      if (a.category == null) {
        if (!f.catMissing) return false;
      } else {
        if (a.category < 0 || a.category > 20 || !f.cats[a.category]) return false;
      }
      if (f.emergencyOnly && !emergencyFromSquawk(a.squawk)) return false;
      return true;
    }

    /* ---------- helpers ---------- */
    function getBounds() {
      const z = Math.floor(view.zoom);
      const cw = mapCanvas.width, ch = mapCanvas.height;
      const cx = lonToTileX(view.centerLon, z);
      const cy = latToTileY(view.centerLat, z);
      const halfW = cw / 2 / TILE_SIZE;
      const halfH = ch / 2 / TILE_SIZE;
      return {
        minLon: tileXToLon(cx - halfW, z),
        maxLon: tileXToLon(cx + halfW, z),
        maxLat: tileYToLat(cy - halfH, z),
        minLat: tileYToLat(cy + halfH, z),
      };
    }

    function latLonToScreen(lat: number, lon: number) {
      const z = Math.floor(view.zoom);
      const tx = lonToTileX(lon, z);
      const ty = latToTileY(lat, z);
      const cx = lonToTileX(view.centerLon, z);
      const cy = latToTileY(view.centerLat, z);
      return {
        x: (tx - cx) * TILE_SIZE + mapCanvas.width / 2,
        y: (ty - cy) * TILE_SIZE + mapCanvas.height / 2,
      };
    }

    function getTile(z: number, x: number, y: number): TileEntry | null {
      const max = (1 << z);
      if (y < 0 || y >= max) return null;
      x = ((x % max) + max) % max;
      const key = `${z}/${x}/${y}`;
      const cached = tileCache.get(key);
      if (cached) return cached;
      const img = new Image();
      img.crossOrigin = "anonymous";
      const entry: TileEntry = { img, loaded: false, failed: false };
      img.onload = () => {
        entry.loaded = true;
        pendingTileLoads--;
        dirtyRef.current = true;
        if (pendingTileLoads <= 0) loading.style.display = "none";
      };
      img.onerror = () => {
        entry.failed = true;
        pendingTileLoads--;
        if (pendingTileLoads <= 0) loading.style.display = "none";
      };
      img.src = tileURL(z, x, y);
      pendingTileLoads++;
      loading.style.display = "block";
      tileCache.set(key, entry);
      return entry;
    }

    /* ---------- render ---------- */
    function renderMap() {
      const cw = mapCanvas.width, ch = mapCanvas.height;
      const z = Math.floor(view.zoom);
      const cx = lonToTileX(view.centerLon, z);
      const cy = latToTileY(view.centerLat, z);

      composeCtx.fillStyle = "#001020";
      composeCtx.fillRect(0, 0, cw, ch);
      composeCtx.imageSmoothingEnabled = true;

      const halfW = cw / 2 / TILE_SIZE;
      const halfH = ch / 2 / TILE_SIZE;
      const minX = Math.floor(cx - halfW);
      const maxX = Math.ceil(cx + halfW);
      const minY = Math.floor(cy - halfH);
      const maxY = Math.ceil(cy + halfH);
      for (let tx = minX; tx <= maxX; tx++) {
        for (let ty = minY; ty <= maxY; ty++) {
          const t = getTile(z, tx, ty);
          if (!t || !t.loaded) continue;
          const sx = (tx - cx) * TILE_SIZE + cw / 2;
          const sy = (ty - cy) * TILE_SIZE + ch / 2;
          composeCtx.drawImage(t.img, Math.round(sx), Math.round(sy), TILE_SIZE, TILE_SIZE);
        }
      }

      smallW = Math.ceil(cw / PIXEL_FACTOR);
      smallH = Math.ceil(ch / PIXEL_FACTOR);
      if (smallCanvas.width !== smallW || smallCanvas.height !== smallH) {
        smallCanvas.width = smallW;
        smallCanvas.height = smallH;
      }
      smallCtx.imageSmoothingEnabled = true;
      smallCtx.drawImage(composeCanvas, 0, 0, cw, ch, 0, 0, smallW, smallH);

      try {
        const imgData = smallCtx.getImageData(0, 0, smallW, smallH);
        const d = imgData.data;
        if (!quantIndices || quantIndices.length !== smallW * smallH) {
          quantIndices = new Uint8Array(smallW * smallH);
        }
        for (let i = 0, j = 0; i < d.length; i += 4, j++) {
          const idx = nearestPaletteIndex(d[i], d[i + 1], d[i + 2]);
          quantIndices[j] = idx;
          d[i] = PALETTE[idx][0];
          d[i + 1] = PALETTE[idx][1];
          d[i + 2] = PALETTE[idx][2];
          d[i + 3] = 255;
        }
        smallCtx.putImageData(imgData, 0, 0);
      } catch (e) {
        quantIndices = null;
        console.warn("Canvas readback blocked — running without quantization", e);
      }

      mapCtx.imageSmoothingEnabled = false;
      mapCtx.clearRect(0, 0, cw, ch);
      mapCtx.drawImage(smallCanvas, 0, 0, smallW, smallH, 0, 0, cw, ch);
    }

    // Nose points up (negative Y). rotate(hdg * π/180) aligns it to heading.
    const PLANE_PATH = (() => {
      const p = new Path2D();
      p.moveTo(0, -9);    // nose tip
      p.lineTo(2, -4);    // right fuselage shoulder
      p.lineTo(8, 0);     // right wing tip
      p.lineTo(7, 2);     // right wing trailing
      p.lineTo(2, 1);     // right wing root
      p.lineTo(3, 6);     // right tail tip
      p.lineTo(1, 7);     // right tail trailing
      p.lineTo(0, 5);     // tail center notch
      p.lineTo(-1, 7);    // left tail trailing
      p.lineTo(-3, 6);    // left tail tip
      p.lineTo(-2, 1);    // left wing root
      p.lineTo(-7, 2);    // left wing trailing
      p.lineTo(-8, 0);    // left wing tip
      p.lineTo(-2, -4);   // left fuselage shoulder
      p.closePath();
      return p;
    })();

    function renderChars() {
      const cw = charCanvas.width, ch = charCanvas.height;
      charCtx.clearRect(0, 0, cw, ch);

      if (quantIndices) {
        const fs = PIXEL_FACTOR;
        charCtx.font = `${fs - 1}px "VT323", "Courier New", monospace`;
        charCtx.textBaseline = "middle";
        charCtx.textAlign = "center";
        charCtx.globalAlpha = 0.85;
        for (let p = 0; p < PALETTE.length; p++) {
          const ch_ = PALETTE_CHARS[p];
          if (ch_ === " ") continue;
          charCtx.fillStyle = PALETTE_TEXT[p];
          for (let y = 0; y < smallH; y++) {
            for (let x = 0; x < smallW; x++) {
              if (quantIndices[y * smallW + x] !== p) continue;
              charCtx.fillText(
                ch_,
                x * PIXEL_FACTOR + PIXEL_FACTOR / 2,
                y * PIXEL_FACTOR + PIXEL_FACTOR / 2
              );
            }
          }
        }
        charCtx.globalAlpha = 1.0;
      }

      // Cities
      if (filtersRef.current.showCities && citiesRef.current.length > 0) {
        const z = Math.floor(view.zoom);
        const popMin = cityPopThreshold(z);
        const b = getBounds();
        // Track label rects per frame to avoid overlapping labels.
        const placed: { x: number; y: number; w: number; h: number }[] = [];
        charCtx.font = `13px "VT323", "Courier New", monospace`;
        charCtx.textBaseline = "middle";
        charCtx.textAlign = "left";
        charCtx.shadowColor = "rgba(0,0,0,0.95)";
        charCtx.shadowBlur = 3;

        // Cities are sorted by population desc; bigger ones get priority for label space.
        for (const [name, lat, lon, pop] of citiesRef.current) {
          if (pop < popMin) break;
          if (lat < b.minLat || lat > b.maxLat) continue;
          // Longitude wrap-aware check
          if (b.minLon < b.maxLon) {
            if (lon < b.minLon || lon > b.maxLon) continue;
          } else if (lon < b.minLon && lon > b.maxLon) continue;

          const s = latLonToScreen(lat, lon);
          if (s.x < -50 || s.x > cw + 50 || s.y < -10 || s.y > ch + 10) continue;

          // Marker dot.
          charCtx.fillStyle = "#ff5";
          charCtx.beginPath();
          charCtx.arc(s.x, s.y, 1.8, 0, Math.PI * 2);
          charCtx.fill();

          // Label, with simple overlap avoidance.
          const tw = charCtx.measureText(name).width;
          const th = 12;
          const lx = s.x + 4;
          const ly = s.y - 7;
          let overlap = false;
          for (const r of placed) {
            if (lx < r.x + r.w && lx + tw > r.x && ly < r.y + r.h && ly + th > r.y) {
              overlap = true;
              break;
            }
          }
          if (overlap) continue;
          placed.push({ x: lx, y: ly, w: tw, h: th });
          charCtx.fillStyle = "#fff";
          charCtx.fillText(name, lx, s.y);
        }
        charCtx.shadowBlur = 0;
      }

      // Aircraft
      charCtx.shadowColor = "rgba(0,0,0,0.9)";
      charCtx.shadowBlur = 3;
      let visible = 0;
      for (const a of aircraft) {
        if (!passesFilter(a)) continue;
        visible++;
        const s = latLonToScreen(a.lat, a.lon);
        if (s.x < -20 || s.x > cw + 20 || s.y < -20 || s.y > ch + 20) continue;
        const isHover = hoveredAircraft !== null && hoveredAircraft.id === a.id;
        const isSelected = selectedIdRef.current === a.id;
        const isEmergency = !!emergencyFromSquawk(a.squawk);
        let color: string;
        if (isSelected) color = "#39ff14";
        else if (isHover) color = "#fff";
        else if (isEmergency) color = "#ff3838";
        else if (a.onGround) color = "#ff3cf0";
        else color = "#ff3cf0";
        charCtx.fillStyle = color;
        if (a.onGround) {
          charCtx.beginPath();
          charCtx.arc(s.x, s.y, 3, 0, Math.PI * 2);
          charCtx.fill();
        } else {
          charCtx.save();
          charCtx.translate(s.x, s.y);
          if (a.hdg != null && !isNaN(a.hdg)) {
            charCtx.rotate((a.hdg * Math.PI) / 180);
          }
          charCtx.fill(PLANE_PATH);
          charCtx.restore();
        }
        if (isSelected) {
          charCtx.strokeStyle = "#39ff14";
          charCtx.lineWidth = 2;
          charCtx.strokeRect(s.x - 12, s.y - 12, 24, 24);
        } else if (isHover) {
          charCtx.strokeStyle = "#39ff14";
          charCtx.lineWidth = 1;
          charCtx.strokeRect(s.x - 10, s.y - 10, 20, 20);
        }
      }
      charCtx.shadowBlur = 0;
      if (visible !== lastVisibleCount) {
        lastVisibleCount = visible;
        setVisibleCount(visible);
      }
    }

    function updateTopbar() {
      const b = getBounds();
      setBbox(
        `${b.minLat.toFixed(1)},${b.minLon.toFixed(1)} → ${b.maxLat.toFixed(1)},${b.maxLon.toFixed(1)}`
      );
      setZoomLabel(Math.floor(view.zoom));
    }

    function frame() {
      if (dirtyRef.current) {
        renderMap();
        renderChars();
        updateTopbar();
        dirtyRef.current = false;
      }
      rafHandle = requestAnimationFrame(frame);
    }

    /* ---------- fetch ---------- */
    // NEXT_PUBLIC_STATES_BASE_URL points at the standalone proxy.
    // When unset, falls back to /api/states so local dev keeps working.
    const statesBase =
      process.env.NEXT_PUBLIC_STATES_BASE_URL?.replace(/\/+$/, "") ?? "";
    const statesPath = statesBase ? `${statesBase}/states` : "/api/states";

    async function fetchAircraft() {
      const b = getBounds();
      const url =
        `${statesPath}` +
        `?lamin=${b.minLat.toFixed(4)}&lamax=${b.maxLat.toFixed(4)}` +
        `&lomin=${b.minLon.toFixed(4)}&lomax=${b.maxLon.toFixed(4)}`;
      setStatus("FETCH");
      setStatusBlink(true);
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error("HTTP " + r.status);
        const data: OpenSkyResponse = await r.json();
        const states = data.states || [];
        aircraft = states
          .filter((s): s is StateField[] => s[5] != null && s[6] != null)
          .map((s) => ({
            id: String(s[0]),
            callsign: ((s[1] as string | null) || "").trim() || String(s[0]),
            country: String(s[2] ?? ""),
            timePosition: s[3] == null ? null : Number(s[3]),
            lastContact: s[4] == null ? null : Number(s[4]),
            lon: Number(s[5]),
            lat: Number(s[6]),
            alt: s[7] == null ? null : Number(s[7]),
            onGround: !!s[8],
            vel: s[9] == null ? null : Number(s[9]),
            hdg: s[10] == null ? null : Number(s[10]),
            vrate: s[11] == null ? null : Number(s[11]),
            sensors: Array.isArray(s[12]) ? (s[12] as number[]) : null,
            geoAlt: s[13] == null ? null : Number(s[13]),
            squawk: s[14] == null ? null : String(s[14]),
            spi: !!s[15],
            posSource: s[16] == null ? null : Number(s[16]),
            category: s[17] == null ? null : Number(s[17]),
          }));
        lastFetchOk = true;
        lastFetchTime = Date.now();
        const t = new Date(lastFetchTime);
        setUpdated(t.toTimeString().slice(0, 8));
        setPlaneCount(aircraft.length);
        setStatus("OK");
        setStatusBlink(false);
        if (selectedIdRef.current) {
          const fresh = aircraft.find((a) => a.id === selectedIdRef.current);
          setSelectedAircraft(fresh ?? null);
          if (!fresh) selectedIdRef.current = null;
        }
        logCategoryHistogram(aircraft);
        dirtyRef.current = true;
      } catch (err) {
        lastFetchOk = false;
        setStatus("ERR");
        setStatusBlink(true);
        console.warn("State fetch failed:", err);
      }
    }

    /* ---------- interaction ---------- */
    let drag: {
      x: number; y: number; lat: number; lon: number; moved: boolean;
    } | null = null;
    const CLICK_THRESHOLD = 4;
    let wheelAccum = 0;
    const WHEEL_THRESHOLD = 100;
    let fetchDebounceTimer: number | null = null;
    function scheduleFetch(delay = 350) {
      if (fetchDebounceTimer !== null) window.clearTimeout(fetchDebounceTimer);
      fetchDebounceTimer = window.setTimeout(() => {
        fetchDebounceTimer = null;
        fetchAircraft();
      }, delay);
    }

    function onMouseDown(e: MouseEvent) {
      if (e.button !== 0) return;
      drag = {
        x: e.clientX, y: e.clientY,
        lat: view.centerLat, lon: view.centerLon,
        moved: false,
      };
      container.classList.add("dragging");
    }
    function onMouseUp() {
      if (!drag) return;
      const wasMoved = drag.moved;
      drag = null;
      container.classList.remove("dragging");
      if (!wasMoved) {
        // A click — select hovered aircraft, or deselect on empty space.
        if (hoveredAircraft) {
          selectedIdRef.current = hoveredAircraft.id;
          setSelectedAircraft(hoveredAircraft);
        } else {
          selectedIdRef.current = null;
          setSelectedAircraft(null);
        }
        dirtyRef.current = true;
      } else {
        scheduleFetch();
      }
    }
    function updateHover(e: MouseEvent) {
      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      let best: Aircraft | null = null;
      let bd = 16 * 16;
      for (const a of aircraft) {
        if (!passesFilter(a)) continue;
        const s = latLonToScreen(a.lat, a.lon);
        const dx = s.x - mx, dy = s.y - my;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = a; }
      }
      const prevId = hoveredAircraft && hoveredAircraft.id;
      const newId = best && best.id;
      if (prevId !== newId) dirtyRef.current = true;
      hoveredAircraft = best;
      if (best) {
        showTooltip(best, mx, my);
      } else {
        tooltip.style.display = "none";
      }
    }
    function onMouseMove(e: MouseEvent) {
      if (drag) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) < CLICK_THRESHOLD) {
          // Treat tiny jitter as still a click, don't pan yet.
        } else {
          drag.moved = true;
          const z = Math.floor(view.zoom);
          const cx = lonToTileX(drag.lon, z) - dx / TILE_SIZE;
          const cy = latToTileY(drag.lat, z) - dy / TILE_SIZE;
          view.centerLon = tileXToLon(cx, z);
          view.centerLat = Math.max(-85, Math.min(85, tileYToLat(cy, z)));
          dirtyRef.current = true;
        }
      }
      updateHover(e);
    }
    function onMouseLeave() {
      hoveredAircraft = null;
      tooltip.style.display = "none";
    }
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      // Accumulate so one trackpad flick / wheel detent = one zoom step.
      if (wheelAccum !== 0 && Math.sign(wheelAccum) !== Math.sign(e.deltaY)) {
        wheelAccum = 0;
      }
      wheelAccum += e.deltaY;
      if (Math.abs(wheelAccum) < WHEEL_THRESHOLD) return;
      const dir = wheelAccum < 0 ? 1 : -1;
      wheelAccum = 0;

      const cur = Math.floor(view.zoom);
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cur + dir));
      if (newZoom === cur) return;

      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const z = cur;
      const cx = lonToTileX(view.centerLon, z);
      const cy = latToTileY(view.centerLat, z);
      const mxTile = cx + (mx - mapCanvas.width / 2) / TILE_SIZE;
      const myTile = cy + (my - mapCanvas.height / 2) / TILE_SIZE;
      const lon = tileXToLon(mxTile, z);
      const lat = tileYToLat(myTile, z);
      view.zoom = newZoom;
      const ncx = lonToTileX(lon, newZoom);
      const ncy = latToTileY(lat, newZoom);
      const dxPx = (mx - mapCanvas.width / 2);
      const dyPx = (my - mapCanvas.height / 2);
      view.centerLon = tileXToLon(ncx - dxPx / TILE_SIZE, newZoom);
      view.centerLat = Math.max(-85, Math.min(85, tileYToLat(ncy - dyPx / TILE_SIZE, newZoom)));
      dirtyRef.current = true;
      scheduleFetch();
    }

    function pad(s: string | number, n: number) {
      const str = String(s);
      return str + " ".repeat(Math.max(0, n - str.length));
    }
    function showTooltip(a: Aircraft, mx: number, my: number) {
      const altFt = a.alt != null ? Math.round(a.alt * 3.28084).toLocaleString() : "—";
      const spdKt = a.vel != null ? Math.round(a.vel * 1.94384).toString() : "—";
      const hdg = a.hdg != null ? Math.round(a.hdg) + "°" : "—";
      const cs = (a.callsign || "?").toString().toUpperCase();
      const country = a.country || "?";
      const lines = [
        `┌${"─".repeat(22)}┐`,
        `│ ${pad(cs, 20)} │`,
        `├${"─".repeat(22)}┤`,
        `│ ALT  ${pad(altFt + " ft", 14)} │`,
        `│ SPD  ${pad(spdKt + " kts", 14)} │`,
        `│ HDG  ${pad(hdg, 14)} │`,
        `│ FROM ${pad(country.slice(0, 14), 14)} │`,
        `└${"─".repeat(22)}┘`,
      ];
      tooltip.textContent = lines.join("\n");
      tooltip.style.display = "block";
      const tw = tooltip.offsetWidth;
      const th = tooltip.offsetHeight;
      let x = mx + 14;
      let y = my + 14;
      if (x + tw > container.clientWidth - 4) x = mx - tw - 14;
      if (y + th > container.clientHeight - 4) y = my - th - 14;
      tooltip.style.left = x + "px";
      tooltip.style.top = y + "px";
    }

    function resize() {
      const w = container.clientWidth;
      const h = container.clientHeight;
      mapCanvas.width = w;
      mapCanvas.height = h;
      mapCanvas.style.width = w + "px";
      mapCanvas.style.height = h + "px";
      charCanvas.width = w;
      charCanvas.height = h;
      charCanvas.style.width = w + "px";
      charCanvas.style.height = h + "px";
      composeCanvas.width = w;
      composeCanvas.height = h;
      dirtyRef.current = true;
    }

    /* ---------- bind ---------- */
    resize();
    const ro = new ResizeObserver(() => resize());
    ro.observe(container);
    container.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("mousemove", onMouseMove);
    container.addEventListener("mouseleave", onMouseLeave);
    container.addEventListener("wheel", onWheel, { passive: false });

    fetchAircraft();
    const pollTimer = window.setInterval(fetchAircraft, POLL_INTERVAL);
    const tickTimer = window.setInterval(() => {
      if (lastFetchTime && lastFetchOk) {
        const ago = Math.floor((Date.now() - lastFetchTime) / 1000);
        setStatus(ago < 12 ? "OK" : (`OK ${ago}s` as "OK"));
      }
    }, 1000);

    rafHandle = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafHandle);
      window.clearInterval(pollTimer);
      window.clearInterval(tickTimer);
      if (fetchDebounceTimer !== null) window.clearTimeout(fetchDebounceTimer);
      ro.disconnect();
      container.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onMouseMove);
      container.removeEventListener("mouseleave", onMouseLeave);
      container.removeEventListener("wheel", onWheel);
    };
  }, []);

  return (
    <>
      <div className="topbar">
        <span className="title">▲ CHUNKY RADAR ▲</span>
        <span className="sep">│</span>
        <span><span className="label">BBOX</span> {bbox}</span>
        <span className="sep">│</span>
        <span><span className="label">PLANES</span> {planeCount}</span>
        <span className="sep">│</span>
        <span><span className="label">UPD</span> {updated}</span>
        <span className="sep">│</span>
        <span><span className="label">ZOOM</span> {zoomLabel}</span>
        <span className="sep">│</span>
        <span>
          <span className="label">STATUS</span>{" "}
          <span className={statusBlink ? "blink" : ""}>{status}</span>
        </span>
      </div>

      <aside className="sidepanel">
        <h2>AIRSPACE</h2>
        <label>
          <input
            type="radio"
            name="airborne"
            checked={filters.airborne === "all"}
            onChange={() => patchFilters({ airborne: "all" })}
          />
          ALL
        </label>
        <label>
          <input
            type="radio"
            name="airborne"
            checked={filters.airborne === "air"}
            onChange={() => patchFilters({ airborne: "air" })}
          />
          AIRBORNE
        </label>
        <label>
          <input
            type="radio"
            name="airborne"
            checked={filters.airborne === "ground"}
            onChange={() => patchFilters({ airborne: "ground" })}
          />
          GROUND
        </label>

        <h2>ALTITUDE</h2>
        <label>
          <input
            type="checkbox"
            checked={filters.altLow}
            onChange={(e) => patchFilters({ altLow: e.target.checked })}
          />
          LOW <span className="dim">&lt;10k</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.altMid}
            onChange={(e) => patchFilters({ altMid: e.target.checked })}
          />
          MID <span className="dim">10–30k</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.altHigh}
            onChange={(e) => patchFilters({ altHigh: e.target.checked })}
          />
          HIGH <span className="dim">30k+</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.altUnknown}
            onChange={(e) => patchFilters({ altUnknown: e.target.checked })}
          />
          UNKNOWN
        </label>

        <h2>TREND</h2>
        <label>
          <input
            type="checkbox"
            checked={filters.vsClimb}
            onChange={(e) => patchFilters({ vsClimb: e.target.checked })}
          />
          CLIMB <span className="dim">▲</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.vsLevel}
            onChange={(e) => patchFilters({ vsLevel: e.target.checked })}
          />
          LEVEL <span className="dim">─</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.vsDescend}
            onChange={(e) => patchFilters({ vsDescend: e.target.checked })}
          />
          DESCEND <span className="dim">▼</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.vsUnknown}
            onChange={(e) => patchFilters({ vsUnknown: e.target.checked })}
          />
          UNKNOWN
        </label>

        <h2>
          CATEGORY
          <span className="h2-actions">
            <button
              type="button"
              onClick={() =>
                patchFilters({
                  cats: Array.from({ length: 21 }, () => true),
                  catMissing: true,
                })
              }
            >
              ALL
            </button>
            <button
              type="button"
              onClick={() =>
                patchFilters({
                  cats: Array.from({ length: 21 }, () => false),
                  catMissing: false,
                })
              }
            >
              NONE
            </button>
          </span>
        </h2>
        {Array.from({ length: 21 }, (_, i) => i).map((i) => (
          <label key={i}>
            <input
              type="checkbox"
              checked={filters.cats[i]}
              onChange={(e) => {
                const next = filters.cats.slice();
                next[i] = e.target.checked;
                patchFilters({ cats: next });
              }}
            />
            <span className="cat-i">{String(i).padStart(2, "0")}</span>{" "}
            {CATEGORY_SHORT[i]}
          </label>
        ))}
        <label>
          <input
            type="checkbox"
            checked={filters.catMissing}
            onChange={(e) => patchFilters({ catMissing: e.target.checked })}
          />
          <span className="cat-i">--</span> MISSING
        </label>

        <h2>CALLSIGN</h2>
        <input
          type="text"
          value={filters.callsign}
          onChange={(e) => patchFilters({ callsign: e.target.value })}
          placeholder="e.g. UAL"
          spellCheck={false}
          autoComplete="off"
        />

        <h2>COUNTRY</h2>
        <input
          type="text"
          value={filters.country}
          onChange={(e) => patchFilters({ country: e.target.value })}
          placeholder="e.g. Germany"
          spellCheck={false}
          autoComplete="off"
        />

        <h2>SPECIAL</h2>
        <label>
          <input
            type="checkbox"
            checked={filters.emergencyOnly}
            onChange={(e) => patchFilters({ emergencyOnly: e.target.checked })}
          />
          EMERGENCY ONLY <span className="dim">7500/7600/7700</span>
        </label>

        <h2>MAP</h2>
        <label>
          <input
            type="checkbox"
            checked={filters.showCities}
            onChange={(e) => patchFilters({ showCities: e.target.checked })}
          />
          CITIES <span className="dim">pop ≥ 100k</span>
        </label>

        <div className="count">
          SHOWING {visibleCount}
          <br />
          OF {planeCount}
        </div>
        <button className="reset" onClick={resetFilters}>RESET</button>
      </aside>

      <div
        className={`map-container${selectedAircraft ? " with-profile" : ""}`}
        ref={containerRef}
      >
        <canvas ref={mapCanvasRef} className="map-canvas" />
        <canvas ref={charCanvasRef} className="char-canvas" />
        <div ref={loadingRef} className="loading">LOADING TILES...</div>
        <div className="legend">
          <div className="ttl">TERRAIN</div>
          <div className="row"><span className="sym" style={{ color: "#6cf" }}>~</span> OCEAN</div>
          <div className="row"><span className="sym" style={{ color: "#9ff" }}>≈</span> SHALLOW</div>
          <div className="row"><span className="sym" style={{ color: "#5f5" }}>♣</span> FOREST</div>
          <div className="row"><span className="sym" style={{ color: "#ff5" }}>.</span> PLAINS</div>
          <div className="row"><span className="sym" style={{ color: "#fc8" }}>░</span> ARID</div>
          <div className="row"><span className="sym" style={{ color: "#bbb" }}>▲</span> MOUNT</div>
          <div className="row"><span className="sym" style={{ color: "#fff" }}>*</span> SNOW</div>
          <div className="row" style={{ marginTop: 4 }}>
            <span className="sym" style={{ color: "#ff3cf0" }}>✈︎</span> AIRCRAFT
          </div>
          <div className="row">
            <span className="sym" style={{ color: "#ff5" }}>•</span> CITY
          </div>
        </div>
        <div className="scanlines" />
        <div className="vignette" />
        <div ref={tooltipRef} className="tooltip" style={{ display: "none" }} />
      </div>

      {selectedAircraft && (
        <ProfilePanel
          a={selectedAircraft}
          nowSec={nowSec}
          enrichment={enrichment}
          enrichmentLoading={enrichmentLoading}
          onClose={() => {
            selectedIdRef.current = null;
            setSelectedAircraft(null);
            dirtyRef.current = true;
          }}
        />
      )}

      <div className="bottombar">
        <span><span className="hint">DRAG</span> pan</span>
        <span><span className="hint">WHEEL</span> zoom</span>
        <span><span className="hint">HOVER</span> aircraft info</span>
        <span style={{ marginLeft: "auto" }}>
          ESRI · OpenSky · FlightAware · rendered chunky-style
        </span>
      </div>
    </>
  );
}
