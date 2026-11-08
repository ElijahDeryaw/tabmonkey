// Song data, entirely in the browser: Songsterr search and song info come through the TabMonkey Worker (Songsterr's
// API sends no CORS headers), the per-track tab JSON comes straight from Songsterr's CDN (which does), and the
// Guitar Pro file is built here with alphaTab. Responses are kept in the Cache API so songs reopen instantly.
import { songsterrToScore, scoreToGp7, CONVERTER_VERSION } from './convert.js';
import { roleOf, partNames, isDrumTrack, displayTuning } from './tracks.js';

/** The Worker's base URL: <meta name="tm-api">, overridable with ?api=… for local development. */
export const API = (new URLSearchParams(location.search).get('api') || document.querySelector('meta[name="tm-api"]')?.content || '').replace(/\/$/, '');
const CDNS = ['https://dqsljvtekg760.cloudfront.net', 'https://d3d3l6a6rcgkaf.cloudfront.net'];
const CACHE = 'tm-songs-v1';

async function cached(url, fetcher) {
  let cache = null;
  try { cache = await caches.open(CACHE); const hit = await cache.match(url); if (hit) return hit.json(); } catch { /* no Cache API (http, private mode) */ }
  const data = await fetcher(url);
  try { await cache?.put(url, new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })); } catch { /* quota */ }
  return data;
}

async function getJson(url) {
  let res;
  try { res = await fetch(url, { signal: AbortSignal.timeout(20000) }); } catch (e) { throw new Error(`Network error (${e.message})`); }
  if (!res.ok) throw new Error(`Songsterr responded ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  // Track JSON is gzipped; usually the browser has already decoded it (Content-Encoding), but not always.
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const text = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    return JSON.parse(text);
  }
  return JSON.parse(new TextDecoder().decode(buf));
}

const slim = (s) => ({
  songId: s.songId, artist: s.artist, title: s.title,
  tracks: (s.tracks || []).map((t) => ({ name: t.name, instrument: t.instrument })),
});

/** Songsterr search. Falls back to songs in your library when offline. */
export async function search(query, library = []) {
  try {
    const results = await getJson(`${API}/api/songs?pattern=${encodeURIComponent(query)}`);
    return { source: 'songsterr', results: results.map(slim) };
  } catch (err) {
    const q = query.toLowerCase();
    return { source: 'offline', error: err.message, results: library.filter((s) => `${s.artist} ${s.title}`.toLowerCase().includes(q)).map((s) => ({ ...s, tracks: [] })) };
  }
}

// Song info is pinned to the revision we first saw, like the server's disk cache was, so parts stay consistent.
const getMeta = (songId) => cached(`${API}/api/meta/${songId}`, getJson);

async function getPart(meta, index) {
  let lastErr;
  for (const cdn of CDNS) {
    try { return await cached(`${cdn}/${meta.songId}/${meta.revisionId}/${meta.image}/${index}.json`, getJson); }
    catch (e) { lastErr = e; }
  }
  throw lastErr;
}

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

const built = new Map();
/** { info, gp: Uint8Array, meta, parts } for a song, built once per page load. */
export function build(songId) {
  if (!built.has(songId)) {
    const p = buildSong(songId);
    built.set(songId, p);
    p.catch(() => built.delete(songId)); // retry next time
  }
  return built.get(songId);
}

async function buildSong(songId) {
  const meta = await getMeta(songId);
  const settled = await Promise.allSettled(meta.tracks.map((_, i) => getPart(meta, i)));
  const missing = [];
  const parts = settled.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    missing.push({ index: i, name: meta.tracks[i].name, error: r.reason.message });
    return null;
  });
  if (parts.every((p) => !p)) throw new Error(`No tracks could be loaded: ${missing[0]?.error ?? 'unknown error'}`);
  const score = songsterrToScore(meta, parts);
  const gp = scoreToGp7(score);
  const info = {
    songId: meta.songId, title: meta.title, artist: meta.artist, revisionId: meta.revisionId,
    bars: score.masterBars.length, sections: score.masterBars.filter((mb) => mb.section).length, tempo: score.tempo,
    defaultTrack: meta.popularTrack ?? meta.defaultTrack ?? 0,
    tracks: trackInfo(meta, parts),
    missing, converter: CONVERTER_VERSION,
  };
  return { info, gp, meta, parts };
}

/** Save a file the browser hands to the user. */
export function download(name, data, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name.replace(/[\\/:*?"<>|]/g, '_') });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
