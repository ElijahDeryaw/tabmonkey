# TabMonkey

A tab app for a band. It keeps your band's songs and setlists in one place and opens each song on your part. It is built for four situations:

- **Practicing alone.** Loop the hard bit, slow it down, and bring the tempo back up as you get it clean.
- **Playing alone.** Run the song top to bottom against the band, with your part turned down or off.
- **Band practice.** Jump straight to a section ("from the bridge") and keep a click going.
- **Playing a set.** Step through a setlist on a full-screen sheet that keeps the screen awake.

Tab data comes from Songsterr's public endpoints (the approach is the same as [songsterr-downloader](https://github.com/Metaphysics0/songsterr-downloader)). The server converts it to Guitar Pro 7, and [alphaTab](https://alphatab.net) renders and plays it in the browser.

## Run it

```sh
npm install
npm run soundfont   # one-time ~32 MB download of GeneralUser GS (free to use) for playback
npm start           # the app + a temporary Cloudflare tunnel; prints a public https link
```

`npm start` serves the app on port 3000 and shares it through a Cloudflare quick tunnel. It prints the `https://….trycloudflare.com` link with a QR code you can scan from the terminal. The same QR code sits in the bottom-right of the library screen, so you can hop between devices or hand it to a bandmate. HTTPS also lets stage mode keep the screen awake. The link changes each time you start. Ctrl+C stops both.

- **cloudflared** is found on PATH, or inside WSL on Windows. If it isn't installed, the app still runs on your network only.
- **Your own Cloudflare setup** (`~/.cloudflared/config.yml`) is left alone: the quick tunnel runs with an empty config.
- **Anyone with the link** can edit the band's songs and setlists. Share it with your band only, or put a named tunnel behind Cloudflare Access.
- **`npm run serve`** (or `TUNNEL=0 npm start`) runs the app without the tunnel. `PORT` and `HOST` are respected.

`deploy/musicvisualize.service` is a systemd unit if the host runs Linux.

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

The band library and setlists are stored on the server in `data/band.json`. Practice progress and preferences live in each browser, separately for each player.

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

## Data endpoints

| Endpoint | What |
|---|---|
| `GET /api/search?q=` | Songsterr search (falls back to downloaded songs when offline) |
| `GET /api/song/:id` | Song info: parts, tuning, capo |
| `GET /api/song/:id/score.gp` | Converted Guitar Pro 7 file (`?download=1` to save) |
| `GET /api/song/:id/raw.json` | Raw Songsterr metadata + per-track JSON |
| `GET /api/band` | The band's songs and setlists |

Songsterr's terms of use apply to the tab data.
