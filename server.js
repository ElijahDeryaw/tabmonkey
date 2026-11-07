import express from 'express';
import path from 'node:path';
import { search, getSong, UpstreamError } from './src/songsterr.js';
import { songsterrToScore, scoreToGp7 } from './src/convert.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.use('/alphatab', express.static(path.resolve('node_modules/@coderline/alphatab/dist')));

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(err);
    res.status(err instanceof UpstreamError ? 502 : 500).json({ error: err.message });
  });

// Built scores are cached in memory: { gp, info }
const built = new Map();
async function build(songId) {
  if (built.has(songId)) return built.get(songId);
  const { meta, parts, missing } = await getSong(songId);
  if (parts.every((p) => !p)) throw new UpstreamError(`No tracks could be loaded: ${missing[0]?.error ?? 'unknown error'}`, 502);
  const score = songsterrToScore(meta, parts);
  const entry = {
    gp: Buffer.from(scoreToGp7(score)),
    raw: { meta, parts },
    info: {
      songId: meta.songId, title: meta.title, artist: meta.artist, revisionId: meta.revisionId,
      bars: score.masterBars.length, tempo: score.tempo,
      defaultTrack: meta.popularTrack ?? meta.defaultTrack ?? 0,
      tracks: parts.map((p, i) => ({ index: i, name: meta.tracks[i].name, instrument: meta.tracks[i].instrument, loaded: !!p })),
      missing,
    },
  };
  built.set(songId, entry);
  return entry;
}

app.get('/api/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Missing ?q=' });
  res.json(await search(q));
}));

app.get('/api/song/:id', wrap(async (req, res) => res.json((await build(Number(req.params.id))).info)));

app.get('/api/song/:id/score.gp', wrap(async (req, res) => {
  const { gp, info } = await build(Number(req.params.id));
  res.type('application/octet-stream');
  if (req.query.download) res.attachment(`${info.artist} - ${info.title}.gp`.replace(/[\\/:*?"<>|]/g, '_'));
  res.send(gp);
}));

app.get('/api/song/:id/raw.json', wrap(async (req, res) => {
  const { raw, info } = await build(Number(req.params.id));
  res.attachment(`${info.songId}-raw.json`).json(raw);
}));

app.listen(PORT, () => console.log(`Tab viewer running at http://localhost:${PORT}`));
