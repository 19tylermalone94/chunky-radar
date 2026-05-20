# chunky-radar

A Dwarf Fortress-style live flight tracker. Pixelated satellite imagery, ASCII terrain overlay, and real-time aircraft positions over a green/amber CRT-styled UI.

```
▲ CHUNKY RADAR ▲   BBOX 24,-125 → 50,-65   PLANES 6332   STATUS OK
┌──────────┐ ~~≈≈♣♣..░░▲▲*  ✈     ~~~~~      ✈    ┌──────────────────┐
│ AIRSPACE │ ~≈≈♣♣...░░▲▲     ✈    ~~~  ✈        │ UAL2347          │
│ (•) ALL  │ ≈♣♣...░░░▲     ~~~    ~~      ✈     │ ALT  35,124 ft   │
│ ALTITUDE │ ♣...░░░▲▲▲    ✈   ~~        ✈       │ SPD  482 kts     │
│ ...      │ ...░░░░▲▲▲  ~~~~                    │ HDG  274°        │
└──────────┘ ..░░░▲▲▲▲  ~~                       └──────────────────┘
```

## Features

- **Pixelated map** — ESRI World Imagery tiles fetched per viewport, downscaled, color-quantized against a 16-entry retro palette, then upscaled with nearest-neighbor sampling for chunky pixels.
- **ASCII terrain overlay** — Each chunky pixel is classified into a terrain glyph (`~` ocean, `≈` shallow, `♣` forest, `.` plains, `░` arid, `▲` mountain, `*` snow) and rendered on a cached offscreen canvas; only redrawn on pan/zoom/resize, not on every aircraft update.
- **Live aircraft** — Polled every 10 s via the OpenSky Network. Drawn as a magenta Path2D polygon rotated to the aircraft's true track (on-ground aircraft render as dots); emergency squawks (7500/7600/7700) render red.
- **Filters** — Airspace (all/airborne/ground), altitude bands, vertical trend, callsign + country search, all 21 ADS-B categories with ALL/NONE shortcut, and an emergency-only toggle.
- **Profile panel** — Click any aircraft for a CRT-styled side panel with a pixelated category photo plus full state-vector fields and FlightAware enrichment (registration, type, operator, origin → destination, status, ASCII progress bar, delays, ETA, filed altitude/airspeed/route, gates).
- **Pan + zoom** — Click-drag to pan, scroll wheel zooms toward the cursor; wheel input is accumulator-debounced so trackpads don't jump multiple levels per flick.
- **Proxy health dot** — A small status dot next to STATUS in the topbar reflects VPS proxy health in real time: green (up), amber (proxy reachable but OpenSky returning stale data), red (proxy unreachable). Hover for last-success time and last-error detail.

## Stack

- Next.js 16 (App Router) + React 19, TypeScript
- Two layered `<canvas>` elements for the map and ASCII/aircraft overlay
- `next/font` for Press Start 2P (UI chrome) and VT323 (terrain glyphs)
- No external state library, mapping library, or build plugins

## Running locally

```bash
npm install
cp .env.local.example .env.local   # then fill in real keys
npm run dev                         # http://localhost:3000
```

### Environment variables

| Variable | Side | Purpose | Required? |
|---|---|---|---|
| `NEXT_PUBLIC_STATES_BASE_URL` | Browser | Base URL of the VPS proxy (e.g. `https://chunky-radar.contraptionsoft.com`). Omit for local dev — the app falls back to `/api/states`. | Optional |
| `OPENSKY_CLIENT_ID` | Server | OpenSky OAuth2 client ID | Optional. Without it, falls back to the anonymous tier (lower rate limits). |
| `OPENSKY_CLIENT_SECRET` | Server | OpenSky OAuth2 client secret | Same as above. |
| `FLIGHTAWARE_API_KEY` | Server | AeroAPI key | Optional. Without it, profile panels show OpenSky data only — no registration/route/schedule enrichment. |

Get OpenSky credentials at [opensky-network.org](https://opensky-network.org/) (account → API client). Get an AeroAPI key at [flightaware.com/aeroapi](https://flightaware.com/aeroapi/portal/).

## Architecture

```
                         ┌─────────────────────────────────────────┐
                         │  Hetzner VPS (chunky-radar.contraptionsoft.com)  │
 browser ── /states ───► │  proxy/server.mjs                       │ ──► OpenSky /states/all
            (primary)    │  8 s in-memory cache, bbox key          │     OAuth2 token cached
                         │  GET /healthz — health probe            │
                         └─────────────────────────────────────────┘

            ┌────────────┐
 browser ── │  Next.js   │ ── ESRI World Imagery tiles (direct, CORS-friendly)
  fallback  │  (Vercel)  │
            │            │ ── /api/states  → OpenSky /states/all
            │            │       fallback when VPS URL unset (local dev)
            │            │
            │            │ ── /api/aircraft/[icao24]?callsign=...
            │            │       FlightAware /flights/{callsign}
            │            │       60 s in-memory cache, callsign key
            └────────────┘
```

The browser fetches aircraft states directly from the VPS proxy (`NEXT_PUBLIC_STATES_BASE_URL`) when set; falls back to `/api/states` for local dev. OpenSky blocks Vercel/AWS/GCP IP ranges at the TCP level — the VPS runs outside those ranges. The caches let many users share one upstream fetch instead of every browser polling independently.

## Deploy

[Deploy to Vercel](https://vercel.com/new) — connect the repo, set the three env vars above in the project settings, and ship. The free Hobby tier easily covers the traffic for a personal share-with-friends app.

### A note on costs and rate limits

This is built as a personal project but the data sources are not free:

- **FlightAware AeroAPI** is **paid per request**. The 60 s server-side cache by callsign means popular planes only hit upstream once a minute regardless of viewer count, but a public URL still exposes you to whatever cost ceiling AeroAPI enforces (or doesn't). Watch your billing.
- **OpenSky** rate-limits even authenticated requests. The 8 s bbox cache helps a lot but doesn't make you immune.

If you fork this and expect non-trivial traffic, consider adding a per-IP rate limit on the `/api/*` routes or capping AeroAPI usage in your AeroAPI dashboard.

## Credits

- **OpenSky Network** — aircraft state vectors
- **FlightAware AeroAPI** — flight enrichment
- **ESRI World Imagery** — map tiles (no key required)
- **Wikimedia Commons** — category aircraft thumbnails (CC-licensed; resized for `public/aircraft/`)
- **VT323**, **Press Start 2P** — fonts via Google Fonts
- Inspired by Dwarf Fortress's ASCII-as-cartography aesthetic
