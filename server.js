import express from 'express';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
app.use(express.static(path.join(ROOT, 'public'), { maxAge: 0 }));
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
  console.log(`Tab viewer running:\n  http://localhost:${PORT}`);
  for (const ip of lan) console.log(`  http://${ip}:${PORT}`);
  console.log(`  http://${os.hostname()}.local:${PORT}  (mDNS, if available)`);
  console.log(`Soundfont: ${path.relative(ROOT, SOUNDFONT)}`);
});
