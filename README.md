# chunky-radar

```text
██╗  ██╗██╗   ██╗███╗   ██╗██╗  ██╗██╗   ██╗
██║  ██║██║   ██║████╗  ██║██║ ██╔╝╚██╗ ██╔╝
███████║██║   ██║██╔██╗ ██║█████╔╝  ╚████╔╝
██╔══██║██║   ██║██║╚██╗██║██╔═██╗   ╚██╔╝
██║  ██║╚██████╔╝██║ ╚████║██║  ██╗   ██║
╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝  ╚═╝   ╚═╝

██████╗  █████╗ ██████╗  █████╗ ██████╗
██╔══██╗██╔══██╗██╔══██╗██╔══██╗██╔══██╗
██████╔╝███████║██║  ██║███████║██████╔╝
██╔══██╗██╔══██║██║  ██║██╔══██║██╔══██╗
██║  ██║██║  ██║██████╔╝██║  ██║██║  ██║
╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝
```

A chunky little live flight tracker with pixelated maps, ASCII terrain, and a CRT-ish interface that feels somewhere between an old terminal, a strategy game, and a radar screen that got left on too long.

**Live aircraft. Retro map. Weirdly pleasant to stare at.**

> Public project / portfolio piece by Tyler Malone  
> Built completely with **Claude Code**

---

## What it is

`chunky-radar` is a real-time flight viewer styled like a low-fi simulation console.

Instead of going for slick aviation-dashboard polish, it leans hard into:
- pixelated satellite imagery
- ASCII terrain glyphs
- chunky aircraft rendering
- green/amber CRT vibes
- a UI that feels more like a place than a product

It’s less “enterprise flight intelligence platform” and more “cool radar thing you open in a tab and keep poking at.”

---

## Features

- **Live aircraft positions** from OpenSky
- **Pixel map rendering** with downscaled/upscaled satellite imagery
- **ASCII terrain overlay** for coastlines, plains, forest, mountains, snow, and water
- **Clickable aircraft profiles** with extra flight details and flight enrichment
- **Filters** for altitude, airborne/grounded, emergency squawks, categories, and more
- **Pan + zoom** over the map like a proper little radar table
- **Spotter panel** for live viewport stats
- **Proxy health indicator** so you can tell whether the feed is healthy or limping

---

## Why it exists

Because flight trackers are usually too clean.

I wanted something that felt:
- more tactile
- more game-like
- a little strange in a good way
- visually memorable enough to stand on its own as a project

This is basically a personal/public experiment in turning live aviation data into a tiny interactive world.

---

## Stack

- **Next.js**
- **React**
- **TypeScript**
- layered **canvas** rendering
- OpenSky for aircraft state data
- FlightAware for enrichment
- ESRI imagery for the map base

No heavy mapping library. No bloated UI kit. Just a deliberately hand-built rendering setup.

---

## Run it locally

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

Then open:

```bash
http://localhost:3000
```

---

## Environment variables

- `NEXT_PUBLIC_STATES_BASE_URL`  
  Base URL for the aircraft-state proxy

- `OPENSKY_CLIENT_ID`  
  OpenSky OAuth client ID

- `OPENSKY_CLIENT_SECRET`  
  OpenSky OAuth client secret

- `FLIGHTAWARE_API_KEY`  
  FlightAware AeroAPI key for enriched aircraft details

If you don’t provide all of them, the app still works in a reduced or fallback mode.

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
            │            │ ── /api/states fallback for local dev
            │            │ ── /api/aircraft/[icao24] for enrichment
            └────────────┘
```

The app prefers the VPS proxy for aircraft state data and falls back to local API routes when needed. Caching keeps the thing from melting upstream APIs every time someone opens the page.

---

## Deployment

Deploy on Vercel, with a separate proxy for OpenSky access where needed.

If you fork it for your own use, keep an eye on:
- OpenSky rate limits
- FlightAware cost / request volume
- public traffic against the API routes

---

## Credits

- **OpenSky Network** — aircraft state vectors
- **FlightAware AeroAPI** — flight enrichment
- **ESRI World Imagery** — map tiles
- **Wikimedia Commons** — aircraft thumbnails
- **Press Start 2P** and **VT323** — fonts
- aesthetic inspiration: old terminals, sim UIs, and games that make data feel alive

---

## Notes

This repo is intentionally a little opinionated.

It’s not trying to be the most practical flight tracker.  
It’s trying to be the coolest version of this idea.

If that’s your kind of thing, poke around.
