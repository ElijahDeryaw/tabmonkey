# Tabs

A practice app that a band runs off a Raspberry Pi. Search a song and your own part opens straight away. You can loop the tricky bit, slow it down, and speed it back up as you get it clean. You can also play along with the rest of the band muted, or listen to your part on its own.

Tab data comes from Songsterr's public endpoints (the approach is the same as [songsterr-downloader](https://github.com/Metaphysics0/songsterr-downloader)). The server converts it to Guitar Pro 7, and [alphaTab](https://alphatab.net) renders and plays it in the browser.

## Run it

```sh
npm install
npm run soundfont   # one-time ~38 MB download of MuseScore_General.sf3 (MIT) for good-sounding playback
npm start
```

The server prints a localhost URL and a LAN URL. Open the LAN one on every bandmate's phone, tablet, or laptop. On a tablet you can use "Add to Home Screen" so it opens full screen. Without the soundfont, playback falls back to alphaTab's small built-in one.

## Practicing

- **Who's playing.** Pick your name and instrument once on each device. From then on, every song opens on your part.
- **Sections.** Tap a section chip to jump there. Double-tap or hold a chip to loop that section, and shift-click a second chip to loop a range.
- **Drag across the sheet** to loop exactly those bars. On touch screens, hold and then drag.
- **Speed trainer.** Set a starting speed, a target and a step. Every clean pass takes the speed up a step. If you flub a pass, press **Missed it** (`A`) so it doesn't count.
- **Count-in.** When count-in is on, every loop pass starts with one.
- **What you hear:**
  - **Full band** plays everything.
  - **Play along** mutes your part.
  - **Just me** solos your part.
  - Tap the song title to set per-track volume and mute. Vocal guide tracks start muted.
- **Progress.** Your best clean speed is saved for each section and shows as the green bar on its chip. When you reopen a song, it picks up on the loop you were working on.
- **Stage mode** (`F`) hides everything except the music and the controls, and shows a dark sheet.
- Press `?` to see the keyboard shortcuts.

Progress is stored in each device's browser and kept per player.

## Raspberry Pi

```sh
# Node 18+ (e.g. via https://github.com/nodesource/distributions), then:
git clone <this repo> ~/musicvisualize && cd ~/musicvisualize
npm install --omit=dev && npm run soundfont
sudo cp deploy/musicvisualize.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now musicvisualize
```

Bandmates can then open `http://<pi-hostname>.local:3000`. Rendering and audio both run on each viewer's device; the Pi only fetches, converts, and caches songs. Built scores are cached under `cache/`, so a song is only converted once.

## Data endpoints

| Endpoint | What |
|---|---|
| `GET /api/search?q=` | Songsterr search (falls back to cached songs when offline) |
| `GET /api/song/:id` | Song info: tracks, part names, tuning, capo |
| `GET /api/song/:id/score.gp` | Converted Guitar Pro 7 file (`?download=1` to save) |
| `GET /api/song/:id/raw.json` | Raw Songsterr metadata + per-track JSON |
| `GET /api/library` | Songs already cached on this server |

Songsterr's terms of use apply to the tab data.
