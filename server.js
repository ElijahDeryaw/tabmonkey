import express from 'express';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { search, getMeta, getSong, CACHE, UpstreamError } from './src/songsterr.js';
import { songsterrToScore, scoreToGp7, CONVERTER_VERSION } from './src/convert.js';
import { roleOf, partNames, isDrumTrack, displayTuning } from './src/tracks.js';
import * as band from './src/band.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // reachable on the LAN or through a tunnel
const ALPHATAB = path.join(ROOT, 'node_modules/@coderline/alphatab/dist');
// GeneralUser GS (SF2, uncompressed). SF3 fonts like MuseScore_General hit a Vorbis decoding bug in alphaTab 1.8.4
// that outputs NaN for many instruments (pianos among them), silencing the whole mix.
const SOUNDFONT = [path.join(ROOT, 'soundfonts/GeneralUser-GS.sf2'), path.join(ALPHATAB, 'soundfont/sonivox.sf2')].find(existsSync);

const app = express();
// App files revalidate each load (cheap 304s); alphaTab and the soundfont are big and versioned, so cache them hard.
// App files: always revalidate (Safari otherwise keeps old modules/styles in an open tab). index.html is never cached
// and points at the stylesheet and entry module with a version derived from the files' modification times, so a
// changed deploy is picked up on the next load everywhere, including through a tunnel.
const PUBLIC = path.join(ROOT, 'public');
async function assetVersion() {
  const files = ['index.html', 'styles.css', ...(await fs.readdir(path.join(PUBLIC, 'js'))).map((f) => `js/${f}`)];
  const times = await Promise.all(files.map((f) => fs.stat(path.join(PUBLIC, f)).then((st) => st.mtimeMs).catch(() => 0)));
  return Math.max(...times).toString(36);
}
app.get(['/', '/index.html'], (req, res, next) => {
  Promise.all([assetVersion(), fs.readFile(path.join(PUBLIC, 'index.html'), 'utf8')]).then(([v, html]) => {
    res.set('Cache-Control', 'no-store').type('html').send(html
      .replace('href="/styles.css"', `href="/styles.css?v=${v}"`)
      .replace('src="/js/main.js"', `src="/js/main.js?v=${v}"`));
  }).catch(next);
});
app.use(express.static(PUBLIC, { setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));
app.use('/alphatab', express.static(ALPHATAB, { maxAge: '30d' }));
// /soundfont redirects (uncached) to a file-specific URL that browsers may cache for a long time,
// so switching soundfonts takes effect immediately.
// (`/soundfont` itself was once served with a 30-day cache, so clients use `/api/soundfont`.)
app.get(['/api/soundfont', '/soundfont'], (req, res) => { res.set('Cache-Control', 'no-store'); res.redirect(302, `/soundfont/${path.basename(SOUNDFONT)}`); });
app.get('/soundfont/:name', (req, res) => {
  if (req.params.name !== path.basename(SOUNDFONT)) return res.status(404).end();
  res.sendFile(SOUNDFONT, { maxAge: '365d', immutable: true, headers: { 'Content-Type': 'application/octet-stream' } });
});

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(err);
    res.status(err instanceof UpstreamError ? 502 : err.status || 500).json({ error: err.message });
  });

function trackInfo(meta, parts) {
  const merged = meta.tracks.map((t, i) => ({ ...parts[i], ...t }));
  const names = partNames(merged);
  return merged.map((t, i) => ({
    index: i,
    part: names[i],
    role: roleOf(t),
    instrument: t.instrument,
    instrumentId: t.instrumentId,
    tuning: isDrumTrack(t) ? null : displayTuning(parts[i]?.tuning ?? t.tuning ?? null),
    capo: parts[i]?.capo || 0,
    difficulty: t.difficulty ?? null,
    views: t.views ?? 0,
    loaded: !!parts[i],
  }));
}

// Built scores: memory first, then disk (survives restarts), then build from Songsterr data.
const built = new Map();
async function build(songId) {
  if (built.has(songId)) return built.get(songId);
  const meta = await getMeta(songId);
  const key = `score.${meta.revisionId}.v${CONVERTER_VERSION}`;
  const gpFile = path.join(CACHE, String(songId), `${key}.gp`);
  const infoFile = path.join(CACHE, String(songId), `${key}.json`);
  let entry;
  try {
    entry = { gp: await fs.readFile(gpFile), info: JSON.parse(await fs.readFile(infoFile, 'utf8')) };
  } catch {
    const { parts, missing } = await getSong(songId);
    if (parts.every((p) => !p)) throw new UpstreamError(`No tracks could be loaded: ${missing[0]?.error ?? 'unknown error'}`, 502);
    const score = songsterrToScore(meta, parts);
    const sections = score.masterBars.filter((mb) => mb.section).length;
    entry = {
      gp: Buffer.from(scoreToGp7(score)),
      info: {
        songId: meta.songId, title: meta.title, artist: meta.artist, revisionId: meta.revisionId,
        bars: score.masterBars.length, sections, tempo: score.tempo,
        defaultTrack: meta.popularTrack ?? meta.defaultTrack ?? 0,
        tracks: trackInfo(meta, parts),
        missing,
      },
    };
    // Only persist complete builds; a song with missing tracks is retried next time.
    if (!missing.length) await Promise.all([fs.writeFile(gpFile, entry.gp), fs.writeFile(infoFile, JSON.stringify(entry.info))]);
  }
  built.set(songId, entry);
  return entry;
}

app.get('/api/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Missing ?q=' });
  res.json(await search(q));
}));

// Link + QR code for opening the app on another device: the tunnel's public link when `npm start` made one,
// otherwise this machine's address on the local network.
function lanAddress() {
  const addrs = Object.entries(os.networkInterfaces())
    .filter(([name]) => !/vEthernet|WSL|Hyper-V|VirtualBox|VMware|docker/i.test(name))
    .flatMap(([, list]) => list || [])
    .filter((a) => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'));
  return (addrs.find((a) => /^(192\.168|10\.)/.test(a.address)) ?? addrs[0])?.address;
}
app.get('/api/share', wrap(async (req, res) => {
  const lan = lanAddress();
  const url = process.env.PUBLIC_URL || (lan ? `http://${lan}:${PORT}` : `http://localhost:${PORT}`);
  const svg = await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
  res.set('Cache-Control', 'no-store').json({ url, public: !!process.env.PUBLIC_URL, svg });
}));

// Shared band library + setlists.
const sendBand = (res) => (st) => res.json(st);
app.use('/api/band', express.json({ limit: '64kb' }));
app.get('/api/band', wrap(async (req, res) => res.json(await band.get())));
app.post('/api/band/songs', wrap(async (req, res) => sendBand(res)(await band.addSong(req.body || {}))));
app.delete('/api/band/songs/:id', wrap(async (req, res) => sendBand(res)(await band.removeSong(req.params.id))));
app.post('/api/band/setlists', wrap(async (req, res) => { const r = await band.createSetlist(req.body?.name); res.json({ ...r.state, created: r.setlist.id }); }));
app.patch('/api/band/setlists/:id', wrap(async (req, res) => sendBand(res)(await band.updateSetlist(req.params.id, req.body || {}))));
app.delete('/api/band/setlists/:id', wrap(async (req, res) => sendBand(res)(await band.deleteSetlist(req.params.id))));

app.get('/api/song/:id', wrap(async (req, res) => res.json((await build(Number(req.params.id))).info)));

app.get('/api/song/:id/score.gp', wrap(async (req, res) => {
  const { gp, info } = await build(Number(req.params.id));
  res.type('application/octet-stream');
  if (req.query.download) res.attachment(`${info.artist} - ${info.title}.gp`.replace(/[\\/:*?"<>|]/g, '_'));
  res.send(gp);
}));

app.get('/api/song/:id/raw.json', wrap(async (req, res) => {
  const { meta, parts } = await getSong(Number(req.params.id));
  res.attachment(`${meta.songId}-raw.json`).json({ meta, parts });
}));

app.listen(PORT, HOST, () => {
  const lan = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
  console.log(`TabMonkey running:\n  http://localhost:${PORT}`);
  for (const ip of lan) console.log(`  http://${ip}:${PORT}`);
  console.log(`  http://${os.hostname()}.local:${PORT}  (mDNS, if available)`);
  console.log(`Soundfont: ${path.relative(ROOT, SOUNDFONT)}`);
});
