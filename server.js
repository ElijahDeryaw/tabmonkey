import express from 'express';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { search, getMeta, getSong, cachedSongs, CACHE, UpstreamError } from './src/songsterr.js';
import { songsterrToScore, scoreToGp7, CONVERTER_VERSION } from './src/convert.js';
import { roleOf, partNames, isDrumTrack, displayTuning } from './src/tracks.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // reachable by bandmates on the LAN
const ALPHATAB = path.join(ROOT, 'node_modules/@coderline/alphatab/dist');
const SOUNDFONT = [path.join(ROOT, 'soundfonts/MuseScore_General.sf3'), path.join(ALPHATAB, 'soundfont/sonivox.sf2')].find(existsSync);

const app = express();
// App files revalidate each load (cheap 304s); alphaTab and the soundfont are big and versioned, so cache them hard.
app.use(express.static(path.join(ROOT, 'public'), { maxAge: 0 }));
app.use('/alphatab', express.static(ALPHATAB, { maxAge: '30d' }));
app.get('/soundfont', (req, res) => res.sendFile(SOUNDFONT, { maxAge: '30d', headers: { 'Content-Type': 'application/octet-stream' } }));

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(err);
    res.status(err instanceof UpstreamError ? 502 : 500).json({ error: err.message });
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

// Built scores: memory first, then disk (survives Pi restarts), then build from Songsterr data.
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

// Songs already on this server (pulled by anyone in the band), newest first.
app.get('/api/library', wrap(async (req, res) => {
  const metas = await cachedSongs();
  const withTime = await Promise.all(metas.map(async (m) => {
    const st = await fs.stat(path.join(CACHE, String(m.songId), 'meta.json')).catch(() => null);
    return { songId: m.songId, title: m.title, artist: m.artist, added: st?.mtimeMs ?? 0 };
  }));
  res.json(withTime.sort((a, b) => b.added - a.added));
}));

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
