# Tabs

A tab app for a band. It keeps your band's songs and setlists in one place and opens each song on your part. It is built for four situations:

- **Practicing alone.** Loop the hard bit, slow it down, and bring the tempo back up as you get it clean.
- **Playing alone.** Run the song top to bottom against the band, with your part turned down or off.
- **Band practice.** Jump straight to a section ("from the bridge") and keep a click going.
- **Playing a set.** Step through a setlist on a full-screen sheet that keeps the screen awake.

Tab data comes from Songsterr's public endpoints (the approach is the same as [songsterr-downloader](https://github.com/Metaphysics0/songsterr-downloader)). The server converts it to Guitar Pro 7, and [alphaTab](https://alphatab.net) renders and plays it in the browser.

## Run it

```sh
npm install
npm run soundfont   # one-time ~38 MB download of MuseScore_General.sf3 (MIT) for playback
npm start           # http://localhost:3000  (PORT and HOST env vars are respected)
```

One person hosts it, and everyone else opens it in a browser. A home machine behind a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) works well: `cloudflared tunnel --url http://localhost:3000`. Anyone with the URL can edit the band's songs and setlists, so put the tunnel behind Cloudflare Access (or similar) if the URL could leak. Over HTTPS, stage mode also keeps phones and tablets awake.

`deploy/musicvisualize.service` is a systemd unit if the host runs Linux.

## How it works

- **Songs.** Search, then **Add** the songs your band plays. Opening a search result previews the song without adding it.
- **Setlists.** Create a setlist, add songs from the library (or straight from search while the setlist is open), and drag to reorder. **Play set** opens the songs in order: `N` and `P` move to the next and previous song, and the arrows in the song bar do the same.
- **Your part.** Pick your name and instrument once per device, and every song opens on your part. The part button shows tuning and capo, and you can switch parts or show several at once from it.
- **Song map.** The bar under the header shows the song's sections drawn to scale, with a playhead. Click a section to jump there; double-click (or hold) to loop it. While looping, `←` and `→` move the loop through the sections.
- **Drag across the sheet** to loop exactly those bars. On touch screens, hold and then drag.
- **Practice strip.** It appears whenever you're looping. It shows your best clean tempo for the passage and the optional tempo trainer, which raises the tempo after each run of clean passes. **Missed it** (`A`) keeps a bad pass from counting. With count-in on, every pass starts with one.
- **You / Band faders.** Bring yourself down to play along, or bring the band down to hear only your part. Vocal guide lines never play, because a synth voice isn't a singer.
- **View menu** (`Aa`). Tab, tab + staff, or staff; page or single-line layout; sheet size; light or dark sheet.
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
