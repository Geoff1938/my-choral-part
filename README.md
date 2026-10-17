# My Choral Part

A web app for choir singers to practise their part: https://player.mychoralpart.com

Find a work by composer, choose a movement, and play the rehearsal MIDI file with your own part brought forward. The MIDI files come from [learnchoralmusic.co.uk](https://www.learnchoralmusic.co.uk); this app indexes them and plays them in the browser.

## Features

- **Find music**: search composers and works, with recently played works remembered
- **My Part and balance**: pick your voice part and set how much it stands out from the others
- **Tempo**: 25% to 200% of the original speed
- **Bars and loops**: bar numbers, jump to a bar, and loop a passage by dragging the loop markers
- **Shareable links**: every work has a URL such as `/mozart/requiem`
- **Works on phones**: designed for mobile first, including iPhone

## How it works

- **Server**: Node.js with Express. It serves the app, proxies MIDI files from learnchoralmusic.co.uk, keeps an index of composers and works (rebuilt nightly), and records anonymous usage in a small SQLite database.
- **Browser**: vanilla JavaScript ES modules with no build step. MIDI is parsed with [@tonejs/midi](https://github.com/Tonejs/Midi) and played by [SpessaSynth](https://github.com/spessasus/SpessaSynth) using the [GeneralUser GS](https://schristiancollins.com/generaluser.php) soundfont.
- **Soundfont hosting**: the 10 MB soundfont is served from Cloudflare R2, with a copy on the server as a fallback, and cached by a service worker after the first visit.
- **Admin**: `/admin` shows usage (devices, downloads, practice hours, top works) and exports it as CSV.

See [CLAUDE.md](CLAUDE.md) for a more detailed architecture guide.

## Running locally

Requires Node.js 18 or later.

```bash
npm install     # installs dependencies and copies browser libraries into public/vendor
npm start       # http://localhost:3001
```

To use the admin page locally, set `ADMIN_USERS` before starting:

```bash
ADMIN_USERS='{"you@example.com": "a password"}' npm start
```

### Tests

```bash
npx jest
```

The tests use temporary databases and stubbed network requests, so they don't touch your data or the live site.

## Deployment

Deployed on [Render](https://render.com) as a Node web service that auto-deploys from `main`, with a 1 GB persistent disk at `/var/data` for the database, its backups and the index. `render.yaml` describes the setup. Set these in the Render dashboard:

| Variable | Value |
|----------|-------|
| `DATABASE_PATH` | `/var/data/activity.db` |
| `DATA_DIR` | `/var/data` |
| `NODE_ENV` | `production` |
| `ADMIN_USERS` | JSON object of admin email: password (never commit this) |

## Privacy

The app stores an anonymous random browser ID, which pieces are opened and played and for how long, and the browser type. It does not store names, email addresses or IP addresses. Records are deleted after 5 years.

## License

MIT
