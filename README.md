# chunky-radar

```text
 ██████╗██╗  ██╗██╗   ██╗███╗   ██╗██╗  ██╗██╗   ██╗
██╔════╝██║  ██║██║   ██║████╗  ██║██║ ██╔╝╚██╗ ██╔╝
██║     ███████║██║   ██║██╔██╗ ██║█████╔╝  ╚████╔╝
██║     ██╔══██║██║   ██║██║╚██╗██║██╔═██╗   ╚██╔╝
╚██████╗██║  ██║╚██████╔╝██║ ╚████║██║  ██╗   ██║
 ╚═════╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝  ╚═╝   ╚═╝

██████╗  █████╗ ██████╗  █████╗ ██████╗
██╔══██╗██╔══██╗██╔══██╗██╔══██╗██╔══██╗
██████╔╝███████║██║  ██║███████║██████╔╝
██╔══██╗██╔══██║██║  ██║██╔══██║██╔══██╗
██║  ██║██║  ██║██████╔╝██║  ██║██║  ██║
╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝

  ┌──────────────────────────────────────────────────────────────────┐
  │  src  : OpenSky Network · FlightAware AeroAPI · ESRI satellite  │
  │  stack: Next.js 16 · React 19 · TypeScript · canvas (no libs)  │
  │  map  : pixel-quantized tiles · ASCII terrain · nearest-neighbor│
  │  ui   : two-canvas renderer · click-to-inspect · pan/zoom       │
  │  feed : 8 s state poll · 60 s enrichment cache · proxy health   │
  └──────────────────────────────────────────────────────────────────┘
```

Real-time flight radar with pixelated satellite maps, ASCII terrain glyphs, and a CRT-styled

---

## Features

- **Live aircraft positions** from OpenSky Network, updated every 8 seconds
- **Pixel map rendering** — ESRI satellite tiles downscaled, color-quantized to a 16-entry retro palette, and upscaled with nearest-neighbor
- **ASCII terrain overlay** — coastlines, plains, forest, mountains, snow, and water classified into glyphs (`~` ocean, `♣` forest, `▲` mountain, etc.)
- **Aircraft sprites** — Path2D polygon shapes rotated by heading; on-ground aircraft render as dots
- **Clickable aircraft profiles** — enriched with FlightAware AeroAPI data (origin, destination, aircraft type, operator)
- **Filters** — altitude range, airborne/grounded toggle, emergency squawk, aircraft category, and more
- **Pan + zoom** across the map canvas
- **Spotter panel** — live viewport stats (aircraft count, altitude distribution, coverage area)
- **Proxy health indicator** — shows feed source and upstream status

---

## Stack

- **Next.js 16** (App Router)
- **React 19**
- **TypeScript**
- Layered **canvas** rendering — two-canvas architecture: pixel map below, character overlay redrawn every animation frame
- **OpenSky Network** — aircraft state vectors (`/states/all`)
- **FlightAware AeroAPI** — per-flight enrichment (origin, destination, aircraft details)
- **ESRI World Imagery** — slippy map tiles for the satellite base
- **Press Start 2P** + **VT323** — fonts

No external mapping library. No UI component kit. Hand-built tile fetching and rendering pipeline.

---

## Run it locally

```bash
npm install
cp .env.local.example .env.local
# fill in keys, then:
npm run dev
```

Open `http://localhost:3000`. Without a proxy URL set, the client falls back to `/api/states`, which works fine from a local IP.

---

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_STATES_BASE_URL` | No | VPS proxy base URL — omit for local dev, falls back to `/api/states` |
| `OPENSKY_CLIENT_ID` | No | OAuth2 client ID — falls back to anonymous tier if missing |
| `OPENSKY_CLIENT_SECRET` | No | OAuth2 client secret — falls back to anonymous tier if missing |
| `FLIGHTAWARE_API_KEY` | No | Paid per-request; aircraft panel shows OpenSky-only data if absent |

Get OpenSky credentials at <https://opensky-network.org/> and a FlightAware AeroAPI key at <https://flightaware.com/aeroapi/portal/>.

---

## Architecture

```text
                         ┌──────────────────────────────────────────────┐
                         │ Hetzner VPS proxy                           │
 browser ── /states ───► │ OpenSky relay with short in-memory cache    │ ──► OpenSky /states/all
                         │ Health probe + shared upstream fetches      │
                         └──────────────────────────────────────────────┘

            ┌────────────┐
 browser ── │  Next.js   │ ── ESRI World Imagery tiles
  fallback  │    app     │
            │            │ ── /api/states (fallback, local dev)
            │            │ ── /api/aircraft/[icao24] (FlightAware enrichment)
            └────────────┘
```

The browser prefers the VPS proxy for aircraft state data (`NEXT_PUBLIC_STATES_BASE_URL`) and falls back to the Vercel API route when that variable is unset. OpenSky blocks Vercel/AWS/GCP IP ranges at the TCP level — the proxy runs on Hetzner CX22 in Frankfurt to stay outside those ranges.

Both the proxy and the Next.js API routes use `globalThis`-based in-memory caches (8 s for states, 60 s for enrichment) keyed by bounding box and callsign respectively.

---

## Deployment

Deployed on Vercel, pinned to `fra1` (Frankfurt) for OpenSky proximity. The standalone proxy runs separately on Hetzner; see `proxy/README.md` for setup.

Things to watch if you fork it:
- OpenSky anonymous tier is rate-limited — OAuth credentials give higher quota
- FlightAware AeroAPI is billed per request — enrichment is triggered per aircraft click
- The VPS proxy is essential for production; Vercel egress IPs are blocked by OpenSky

---

## Credits

- **OpenSky Network** — aircraft state vectors
- **FlightAware AeroAPI** — flight enrichment
- **ESRI World Imagery** — map tiles
- **Wikimedia Commons** — aircraft thumbnails
- **Press Start 2P** and **VT323** — fonts
