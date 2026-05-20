@AGENTS.md

# chunky-radar

A Dwarf Fortress-style live flight radar: pixelated satellite tiles, ASCII terrain overlay, real-time aircraft positions, CRT aesthetic. Next.js 16 (App Router) + React 19, TypeScript, no external mapping or state library.

## Architecture

### One big component
`app/FlightTracker.tsx` is intentionally a single large file — all map rendering, pan/zoom, aircraft state, filters, and the click-to-inspect panel live here. Don't break it up.

### Two-canvas layered rendering
- **map canvas** — ESRI satellite tiles downscaled → color-quantized against a 16-entry retro palette → upscaled (nearest-neighbor). Terrain is classified into glyphs (`~` ocean, `♣` forest, `▲` mountain, etc.) and rendered over the pixel image.
- **char canvas** — aircraft sprites, city labels, selected/hover outlines — redrawn every animation frame via `renderChars()`.

### Aircraft sprites
Aircraft are drawn with a `Path2D` polygon (nose pointing up, negative Y). Rotation is `hdg * π/180`. Do **not** revert to the `✈` glyph — iOS Safari ignores the VS-15 variation selector and renders it as a system emoji, overriding `fillStyle`.

On-ground aircraft render as `arc()` dots; airborne use the Path2D shape.

### API routes

| Route | Purpose | Cache |
|---|---|---|
| `GET /api/states` | OpenSky `/states/all` proxy | 8 s in-memory, bbox key |
| `GET /api/aircraft/[icao24]?callsign=` | FlightAware AeroAPI enrichment | 60 s in-memory, callsign key |

Both caches use `globalThis` so they survive Fluid Compute warm reuse. Don't move them to module-level `const` — they'll reset across invocations.

Response headers from `/api/states` that the client reads:
- `x-cache`: `HIT` | `MISS` | `STALE` | `STALE-ERR`
- `x-upstream-status`: OpenSky HTTP status (present on `STALE`)
- `x-auth`: `1` = OAuth active, `0` = anonymous

### Standalone proxy (`proxy/server.mjs`)
OpenSky blocks Vercel/AWS/GCP IP ranges at the TCP level. A zero-dependency Node 18+ server runs on a Hetzner VPS outside those ranges. The browser calls `NEXT_PUBLIC_STATES_BASE_URL/states` directly; the Vercel function at `/api/states` is only used as a fallback (local dev or when the var is unset).

## Environment variables

| Variable | Used by | Notes |
|---|---|---|
| `OPENSKY_CLIENT_ID` | Vercel + proxy | OAuth2 — falls back to anon tier if missing |
| `OPENSKY_CLIENT_SECRET` | Vercel + proxy | Same |
| `FLIGHTAWARE_API_KEY` | Vercel only | Paid per-request; panel shows OpenSky-only data if absent |
| `NEXT_PUBLIC_STATES_BASE_URL` | Browser | VPS proxy base URL. Omit for local dev |

Copy `.env.local.example` → `.env.local` and fill in keys.

## Local development

```bash
npm install
npm run dev   # http://localhost:3000
```

Without `NEXT_PUBLIC_STATES_BASE_URL` the client falls back to `/api/states`, which works fine from a local IP (OpenSky's filter doesn't apply). FlightAware enrichment requires a key even locally.

## Deployment

Vercel, pinned to `fra1` (Frankfurt) — both for OpenSky proximity and to stay outside the US-East block. The `vercel.json` sets `"regions": ["fra1"]`. The proxy runs separately on Hetzner CX22; see `proxy/README.md` for setup steps.

## Checks

No linter is configured. The only automated check is TypeScript:

```bash
npx tsc --noEmit
```

This must pass with zero errors before committing or opening a PR. Visual correctness requires running the dev server and looking at the map — there is no test suite.

## Git workflow

### Branch naming
```
{type}/{short-slug}

feat/flight-trail
fix/ios-sprite-color
chore/upgrade-next
```

Types mirror conventional commits: `feat`, `fix`, `chore`, `refactor`, `docs`.

### Issues
Every piece of work should have a GitHub issue. If one doesn't exist, create it before starting. Issues live at the repo on GitHub (`gh issue create`).

### Commits
Follow conventional commit format:
```
{type}({scope}): short description

feat(renderer): add flight trail polyline
fix(api): handle OpenSky 401 on token expiry
chore: bump next to 16.3
```

### Pull requests
- **Always branch off a fresh `main`.** Before starting any new issue, run `git checkout main && git pull` first — never branch off an in-progress feature branch.
- Open a PR back to `main`.
- Include `Closes #N` in the PR body to auto-close the linked issue on merge.
- PR title should match the commit format above.
