// The only module that touches persistence. Everything is namespaced per player profile so a shared
// tablet can serve several bandmates. Reads are synchronous against an in-memory snapshot; init() is async so
// the snapshot could later be hydrated from the server (e.g. for leader mode) without touching callers.
const KEY = 'tabapp:v1';
let state = {};

const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode / quota */ } };

export async function init() { state = read(); state.profiles ??= {}; state.device ??= {}; }

const me = () => state.profiles[state.current];

export const profile = () => (me() ? { name: state.current, instrument: me().instrument } : null);
export const profileNames = () => Object.keys(state.profiles);
export const profileInstrument = (name) => state.profiles[name]?.instrument;

export function setProfile(name, instrument) {
  const p = (state.profiles[name] ??= { songs: {}, prefs: {} });
  if (instrument) p.instrument = instrument;
  state.current = name;
  save();
}

/** Per-device settings (zoom, layout): they depend on the screen, not the person. */
export const device = (k, fallback) => state.device[k] ?? fallback;
export const setDevice = (k, v) => { state.device[k] = v; save(); };

/** Per-person preferences (e.g. view per instrument). */
export const pref = (k, fallback) => me()?.prefs[k] ?? fallback;
export const setPref = (k, v) => { if (me()) { me().prefs[k] = v; save(); } };

/**
 * Per-song state for the current profile:
 * { title, artist, opened, track, speed, lastSpot, sectionCount, mix: {trackIndex: {vol, mute}},
 *   spots: { key: { label, start, end, best, passes } } }   start/end are 0-based bar indexes, best is % speed
 */
export function song(id) {
  const songs = me()?.songs;
  if (!songs) return { spots: {}, mix: {} };
  const s = (songs[id] ??= {});
  s.spots ??= {}; s.mix ??= {};
  return s;
}
export function updateSong(id, patch) { Object.assign(song(id), patch); save(); }

export function recordPass(id, spot, speed) {
  const s = song(id);
  const p = (s.spots[spot.key] ??= { label: spot.label, start: spot.start, end: spot.end, best: 0, passes: 0 });
  p.label = spot.label;
  p.passes++;
  const improved = speed > p.best;
  if (improved) p.best = speed;
  save();
  return improved;
}

/** 0..1: average of capped best speeds over every section of the song (unpracticed sections count as 0). */
export function mastery(id) {
  const s = song(id);
  const sections = Object.entries(s.spots).filter(([k]) => k.startsWith('s:'));
  const total = Math.max(s.sectionCount || 0, sections.length);
  if (!total) return 0;
  return sections.reduce((sum, [, p]) => sum + Math.min(100, p.best) / 100, 0) / total;
}

export function recentSongs() {
  return Object.entries(me()?.songs || {})
    .filter(([, s]) => s.opened)
    .sort((a, b) => b[1].opened - a[1].opened)
    .map(([id, s]) => ({ songId: Number(id), ...s }));
}
