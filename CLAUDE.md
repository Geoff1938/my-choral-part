# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

My Choral Part (https://player.mychoralpart.com) is a web app for choir singers to practise their part. Users find a work by composer, pick a movement, and play the MIDI rehearsal file with their own part emphasised, at an adjustable tempo, looping sections bar by bar. The MIDI files come from learnchoralmusic.co.uk; this app indexes them and proxies them.

## Architecture

### Server (Node/Express, CommonJS)

- `server.js` - app setup, middleware order, static files and caching, startup (database, index, scheduler)
- `routes/api.js` - composer search, works, sections, deep-link resolve (`/api/...`)
- `routes/proxy.js` - `/proxy?url=` fetches MIDI files from learnchoralmusic.co.uk only (domain allowlist, re-checked on redirects)
- `routes/activity.js` - `POST /api/activity/log` usage events from the player
- `routes/admin.js` - `/admin` dashboard: summary, CSV export, index status, manual index rebuild
- `middleware/` - rate limiting (keyed on `CF-Connecting-IP`), admin Basic Auth, same-origin check for admin POSTs, error handler
- `scraper.js` - builds the MIDI index by scraping learnchoralmusic.co.uk; refuses to overwrite the index if a rebuild comes back much smaller
- `utils/database.js` - activity database (sql.js / SQLite in memory, saved atomically to disk), admin users, retention
- `utils/scheduler.js` - nightly jobs (node-cron, Europe/London): index rebuild 02:00; backup and 5-year purge 03:30

### Client (vanilla JS ES modules, no build step)

- `public/app.js` - the `MIDIPlayer` class: search and selection, MIDI loading, playback, balance, tempo, bars and loops, activity logging
- `public/constants.js`, `public/utils/`, `public/ui/StatusManager.js`, `public/api/RecentWorksManager.js`, `public/player/InstrumentLoader.js` (General MIDI names, used to identify voice parts)
- `public/service-worker.js` - caches the soundfont after first use; navigations always fetch fresh
- `public/vendor/` - not in git; copied from node_modules by `scripts/copy-vendor.js` (runs on `npm install`)

### Audio

- MIDI is fetched through `/proxy`, parsed with `@tonejs/midi` (`Midi` global, `public/vendor/midi.js`) for the UI (tracks, bars, tempo map), and played by **SpessaSynth** (`spessasynth_lib`/`spessasynth_core`, AudioWorklet) using the **GeneralUser GS** soundfont.
- The 10.6 MB soundfont is served from a Cloudflare R2 bucket (`ASSET_HOST` in `public/constants.js`) to keep bandwidth off Render (5 GB/month allowance); `public/soundfonts/GeneralUserGS.sf3` is the fallback. The R2 CORS policy must list every origin the app is served from (player.mychoralpart.com, the onrender.com URL, localhost:3001).
- Leading silence over 0.5 s is skipped: the app's timeline (`currentTime`, bars, loop markers) starts at the first note, while the sequencer works in absolute song time - convert with `toSequencerTime()` / `fromSequencerTime()`.
- Tempo is the sequencer's `playbackRate`. Balance rewrites CC7 (channel volume) in a copy of the MIDI and reloads it.
- iOS: the AudioContext is resumed from every user gesture and in `play()`; playback pauses if the context is interrupted.

### Caching and versioning

`index.html` is served with the build version substituted into `?v=` asset URLs, and the server rewrites relative ES module imports to carry `?v=` too, so versioned JS/CSS can be cached for a year. Unversioned JS/CSS URLs are revalidated (`no-cache`). Always serve pages through `serveIndex` so the `{{VERSION}}` placeholder is replaced.

### Data and privacy

- Activity events: anonymous random device ID, event type (`download`, `rehearsal_start`, `rehearsal_time` with `duration_seconds`), composer/work/movement, user agent. No IP addresses. Kept 5 years. The privacy text in `index.html` must stay accurate.
- Production data lives on the Render disk at `/var/data`: `activity.db`, `backups/` (7 nightly copies), and the index files, seeded from the repo's `data/` on first start. After that the disk copy wins - a newer index committed to git does not replace it.

## Commands

```bash
npm install        # also copies vendor libraries into public/vendor
npm start          # http://localhost:3001
npx jest           # all tests (unit + integration, no network access)
```

Admin locally needs `ADMIN_USERS` set before `npm start`, e.g. `ADMIN_USERS='{"you@example.com":"password"}'`; without it the admin area is locked.

## Deployment (Render)

- Service `my-choral-part`, Starter plan, Frankfurt, auto-deploys from `main`. `render.yaml` documents the configuration; the dashboard is authoritative unless the service is synced as a Blueprint.
- Environment: `DATABASE_PATH=/var/data/activity.db`, `DATA_DIR=/var/data`, `NODE_ENV=production`, and `ADMIN_USERS` (JSON object of email: password, set only in the dashboard - this repo is public, never commit credentials).
- Health check: `/health`.

## Gotchas

- The repo is public: no secrets, personal data or exports in commits (`data/*.db`, `output_files/` and `*.xlsx` are git-ignored).
- When testing locally after editing client modules, restart the server or hard-reload: the version string only changes on restart, so the browser may reuse cached modules.
- On this Windows machine, run `npm install` from PowerShell; npm install scripts fail to spawn a shell from Git Bash.
- ask me if you want the server stopped and restarted
