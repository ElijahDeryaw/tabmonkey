// Songsterr data access with an on-disk cache (cache/<songId>/meta.json + <partIndex>.json).
// Endpoints match what Songsterr's own web player uses (see Metaphysics0/songsterr-downloader).
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const CACHE = path.resolve('cache');
const API = 'https://www.songsterr.com/api';
const CDNS = ['https://dqsljvtekg760.cloudfront.net', 'https://d3d3l6a6rcgkaf.cloudfront.net'];
const HEADERS = { 'User-Agent': 'musicvisualize/0.1 (personal data project)', Accept: 'application/json' };

export class UpstreamError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function getJson(url) {
  let res;
  try {
    res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  } catch (e) {
    throw new UpstreamError(`Network error fetching ${url}: ${e.message}`, 502);
  }
  if (!res.ok) throw new UpstreamError(`Songsterr responded ${res.status} for ${url}`, res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  const body = buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf) : buf; // track JSON is served gzipped
  return JSON.parse(body.toString('utf8'));
}

const readCache = async (...p) => {
  try { return JSON.parse(await fs.readFile(path.join(CACHE, ...p), 'utf8')); } catch { return null; }
};
const writeCache = async (data, ...p) => {
  await fs.mkdir(path.join(CACHE, ...p.slice(0, -1)), { recursive: true });
  await fs.writeFile(path.join(CACHE, ...p), JSON.stringify(data));
};

async function cachedSongs() {
  const dirs = await fs.readdir(CACHE).catch(() => []);
  const metas = await Promise.all(dirs.map((d) => readCache(d, 'meta.json')));
  return metas.filter(Boolean);
}

export async function search(query) {
  try {
    const results = await getJson(`${API}/songs?size=25&pattern=${encodeURIComponent(query)}`);
    return { source: 'songsterr', results: results.map(slim) };
  } catch (err) {
    // Fall back to songs already in the local cache so the app still works offline / when blocked.
    const q = query.toLowerCase();
    const local = (await cachedSongs()).filter((m) => `${m.artist} ${m.title}`.toLowerCase().includes(q));
    return { source: 'cache', error: err.message, results: local.map(slim) };
  }
}

const slim = (s) => ({
  songId: s.songId, artist: s.artist, title: s.title,
  tracks: (s.tracks || []).map((t) => ({ name: t.name, instrument: t.instrument })),
});

export async function getMeta(songId) {
  const cached = await readCache(String(songId), 'meta.json');
  if (cached) return cached;
  const meta = await getJson(`${API}/meta/${songId}`);
  await writeCache(meta, String(songId), 'meta.json');
  return meta;
}

async function getPart(meta, index) {
  const cached = await readCache(String(meta.songId), `${index}.json`);
  if (cached) return cached;
  let lastErr;
  for (const cdn of CDNS) {
    try {
      const part = await getJson(`${cdn}/${meta.songId}/${meta.revisionId}/${meta.image}/${index}.json`);
      await writeCache(part, String(meta.songId), `${index}.json`);
      return part;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

/** Returns { meta, parts: (object|null)[], missing: {index, error}[] } */
export async function getSong(songId) {
  const meta = await getMeta(songId);
  const settled = await Promise.allSettled(meta.tracks.map((_, i) => getPart(meta, i)));
  const missing = [];
  const parts = settled.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    missing.push({ index: i, name: meta.tracks[i].name, error: r.reason.message });
    return null;
  });
  return { meta, parts, missing };
}
