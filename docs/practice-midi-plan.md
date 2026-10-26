# Practice MIDI: convert, save and share

Plan for letting users convert their own MIDI or MusicXML files into practice MIDIs, save them in a library usable across devices, and share them by link. Adapted from an external brief (written for a Django app) to this Node/Express codebase.

## Decisions (25 October 2026)

| Topic | Decision |
|---|---|
| Where conversion runs | In the browser, if it works well enough. The original file never leaves the device. |
| MusicXML | JS reader first (`DOMParser`, `fflate` for `.mxl`); a Python/music21 service on Render only if JS falls short. |
| Library storage | Separate sql.js database `library.db` on the existing `/var/data` disk. Keep costs to a minimum. |
| Repeats | Play as written (not expanded), so bar numbers match the player's straight-through counting. |
| Activity logging | Log plays of converted/library pieces with their title (or filename). Privacy text must say so. |
| Retention | Delete libraries 3 years after last use. A shared piece counts as used when anyone plays it, including recipients, so it is kept while anyone uses it. |
| Still open | Piece limit per library, email recovery, takedown address, multi-file works (asked at the milestone that needs them). |

## Architecture

- `public/practice-midi/`: plain ES modules with no DOM dependencies (`detect`, `smf` reader/writer, `classify`, `checks`, `recipe`, `audit`, `metadata`). Runs in the browser, in Jest, and on the server (dynamic `import()`) for re-validating saved MIDI.
- Own SMF reader/writer rather than `@tonejs/midi`, which loses raw event order, lyric meta-events and note-off ordering.
- Player: refactor `loadMIDIFromURL()` so an ArrayBuffer can be loaded directly. Uploaded and library pieces use `piece:<id>` keys for overrides and recent works, and never call `sendOverrideToServer`.

## Output conventions

- Voice track names the player recognises (`detectVoicePartFromName`): `Soprano` / `Soprano 1` / `Soprano 2`, `Alto` / `Alto 2`, `Tenor` / `Tenor 2`, `Bass` / `Bass 2`.
- Accompaniment keeps its source name unless the player would read it as a voice part (e.g. "Bass (continuo)"); then it is renamed (`Continuo`, `Organ`, `Accompaniment N`). Tested: `detectVoicePartFromName` returns null for every accompaniment track.
- Recipe (0-based program byte, channel, pan): S1 72/0/127, S2 72/4/127, A 71/5/84, T 60/6/42, B 70/7/1; A2/T2/B2 on channels 1/2/3. CC7 64, CC91 127, CC93 127 on every channel. Accompaniment keeps its program on channels 8, 10-15; never channel 9.
- Preserve ticks per quarter, tempo map, every onset and duration, varying velocities and CC7 automation. Constant velocities become 75 (with a warning). Lyrics move onto their voice track. Copyright notices carried over.

## Library and sharing

- Library key: `secrets`-strength random, held in an HttpOnly, Secure, SameSite=Lax cookie set by the server; only its SHA-256 hash is stored. Created on first save.
- Other devices: QR code / link `https://player.mychoralpart.com/library#k=<key>` (key in the fragment, never in logs), claimed via `POST /library/claim/`. Reset rotates the key.
- Share links: `/p/<share_token>`, unlisted, `noindex`, one piece only. "Add to my library" adds a reference, not a copy; owner deletion gives 410 for everyone; revoke issues a new token. Attestation required before first share.
- All changing routes use `requireSameOrigin` and one ownership middleware. Register `/p/...` and `/library` before the `/:composer/:work` catch-all.

## Milestones

1. **M1** MIDI path in `public/practice-midi/`, Jest tests against private fixtures.
2. **M2** MusicXML reader feeding the M1 pipeline.
3. **M3** Convert in the front end: picker, report, hand-off to the player, download.
4. **M4** Library: `library.db`, cookie, save (server re-validates), list, rename, delete, retention job.
5. **M5** Sharing.
6. **M6** Multiple devices.
7. **M7** Privacy wording and deploy.

Stop for review after each milestone.

## Fixtures

Reference files go in `tests/fixtures/private/` (git-ignored; this repo is public). Tests that need them skip when they are absent. No requests to cpdl.org from code.
