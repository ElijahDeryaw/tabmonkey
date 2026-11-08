# TabMonkey

A tab app for a band. It keeps your songs and setlists in one place and opens each song on your part. It's built for four situations:

- **Practicing alone.** Loop the hard bit, slow it down, and bring the tempo back up as you get it clean.
- **Playing alone.** Run the song top to bottom against the band, with your part turned down or off.
- **Band practice.** Start a session, and everyone in the room can open your setlist on their own part.
- **Playing a set.** Step through a setlist on a full-screen sheet that keeps the screen awake.

**Open it:** https://elijahderyaw.github.io/tabmonkey/

Tab data comes from Songsterr's public endpoints (the approach is the same as [songsterr-downloader](https://github.com/Metaphysics0/songsterr-downloader)). Each song is converted to Guitar Pro 7 in your browser, and [alphaTab](https://alphatab.net) renders and plays it.

## Your library lives on your device

Songs, setlists, players and practice progress are kept in your browser. Nothing is stored on a server. Use **Back up library and progress** in the player menu (top right) to save a file, and **Restore from a backup** to load it on another device. Restore also accepts the old server's `data/band.json`.

## Sessions

Sessions let the room share without anyone setting anything up.

1. Tap **Session**, then **Start a session**. You get a QR code and a link (**Share link** opens the share sheet on iPhone and iPad).
2. Anyone who opens the link joins. The first time, they pick their name and instrument, and then they're in.
3. While the session is open, everyone sees everyone else's songs and setlists in the sidebar, under that person's colour. They can open any song on their own part, **Play set** through someone's setlist, and **Save to my library** to keep a copy. If the setlist changes later, the button becomes **Update my copy**.
4. The coloured avatars in the top bar show who's here. The session panel shows what each person has open, with a button to open the same song.
5. The host ends it for everyone. Guests can leave on their own. Nothing is kept: a guest's library disappears from the session when they leave, and a session nobody is in is deleted after a day.

Shared links show a "You're invited to a session" card in iMessage, WhatsApp, Slack and the like, with the host's name and how many songs and setlists they're sharing. A plain link to the site shows the regular TabMonkey card.

Anyone with a session link can see what's shared in it, so send it to your band only.

## How it works

- **Songs.** Search, then **Add** the songs your band plays. Opening a search result previews the song without adding it.
- **Setlists.** Create a setlist and add songs from the library (or straight from search while the setlist is open). Drag a row by its grip to reorder, or use Alt+↑/↓ from the keyboard. **Play set** opens the songs in order: `N` and `P` move to the next and previous song, and the arrows in the song bar do the same.
- **Your part.** Pick your name and instrument once per device, and every song opens on your part. The part button shows tuning and capo, and you can switch parts or show several at once from it.
- **Song map.** The bar under the header shows the song's sections drawn to scale, with a playhead. Click a section to jump there; double-click (or hold) to loop it. While looping, `←` and `→` move the loop through the sections.
- **Drag across the sheet** to loop exactly those bars. On touch screens, hold and then drag.
- **Practice strip.** It appears whenever you're looping. It shows your best clean tempo for the passage and the optional tempo trainer, which raises the tempo after each run of clean passes. **Missed it** (`A`) keeps a bad pass from counting. With count-in on, every pass starts with one.
- **You / Band faders.** Bring yourself down to play along, or bring the band down to hear only your part. Vocal guide lines never play, because a synth voice isn't a singer. With **Click** on, the click is boosted and the band is ducked under it, so the click is always the loudest thing you hear.
- **Song switcher** (`S`, or tap the song title): your setlist and songs appear right away; type to filter, or to find anything on Songsterr.
- **View menu** (`Aa`). Theme, notation (tab, tab + staff, staff), page or single-line layout, sheet size, and light or dark sheet.
  - **Comfort** (the default) is built for reading at a glance: tab digits are set in semibold Atkinson Hyperlegible Next, a typeface designed for low vision that keeps 0/8, 1/7 and 5/6 distinct. Ink is high contrast, staff lines are lighter so the numbers lead, the paper is warm rather than glaring white, and there's more space between lines of music.
  - **Classic** is the familiar Guitar Pro look.
- **Lyrics on every part.** The vocal line's syllables appear under whatever part you're reading, at their exact timing, so you can see where the words fall. Toggle them in the view menu.
- **String names.** Every tab line is labelled with its actual tuning (e B G D A E, or D A D G B E in Drop D). Toggle in the view menu.
- **Retune** (`R`). **Key** shifts the whole band up or down in semitones and is remembered per song. **Your guitar** says how your instrument is tuned right now, and it stays set across songs, because your guitar stays tuned for half the set.
  - With "Tuned like the tab", the shapes stay the same and the menu tells you what to tune to. For example, a song at −2 means D standard.
  - With an explicit tuning, your part is re-fingered for the strings you actually have. If every string is off by the same amount, it moves (or adds) a capo so the shapes stay identical. Otherwise a Viterbi search (the "optimum path" approach to guitar fingering) finds the most playable fingering. It keeps notes near the original tab, minimises hand movement and stretch, keeps hammer-ons, pull-offs and slides on one string, keeps ties in place, and never asks you to bend an open string.
  - Notes below your lowest string go up an octave as a last resort. The menu tells you when retuning would let you play it as written.
- **Stage mode** (`F`). Goes full screen and keeps only the sheet, the song map, play, and setlist navigation. Page-turner pedals that send PageDown/PageUp scroll the sheet.

- **Back up** (player menu). Saves your library and every player's practice progress on this device to a file.

## Keys

| Key | Action |
|---|---|
| Space | Play / pause |
| ← → | Previous / next section |
| L | Loop current section |
| `[` `]` | Tempo −5% / +5% |
| A | Missed it |
| C / M | Count-in / click |
| N / P | Next / previous song in setlist |
| PageDown / PageUp | Scroll the sheet |
| F | Stage mode |
| S | Switch song |
| R | Retune |
| / | Search |
| Esc | Close menu, leave stage mode, stop looping |

## How it's built

- **`public/`** is the app. It's a static site: no build tools, just ES modules. `npm run build` copies it to `dist/` together with alphaTab, the QR code library and the soundfont, and stamps every module URL with a content hash.
- **GitHub Pages** serves `dist/`. `.github/workflows/pages.yml` builds and deploys on every push to `main`, and downloads GeneralUser GS (free to use and redistribute) for playback.
- **`worker/`** is a Cloudflare Worker (free plan) for the things a static page can't do:
  - `GET /api/songs?pattern=` and `GET /api/meta/:id` pass through to Songsterr, which sends no CORS headers. Responses are cached at the edge.
  - `GET /session/:id` is the live session relay, one Durable Object per session, over a WebSocket.
  - `GET /s/:id` is the invite link: a page with the preview card that sends people on to the app.
- The per-track tab JSON comes straight from Songsterr's CDN, which allows cross-origin requests, and is cached in the browser.

### Develop

```sh
npm install
npm run soundfont     # optional: GeneralUser GS (~32 MB); without it, alphaTab's small font is used
npm run dev           # http://localhost:5050, rebuilds when public/ changes
npm run worker        # optional: the Worker on http://localhost:8787 (open the app with ?api=http://localhost:8787)
node scripts/og/render.js   # re-render the link preview images and home screen icon
```

### Deploy

```sh
cd worker && npx wrangler login && npx wrangler deploy   # prints the Worker URL (currently https://tabmonkey.tabmonkey-worker.workers.dev)
```

Put that URL in `<meta name="tm-api">` in `public/index.html`, and push to `main`. If the site moves, update `APP_URL` and `ALLOWED_ORIGINS` in `worker/wrangler.toml`.

Songsterr's terms of use apply to the tab data.
