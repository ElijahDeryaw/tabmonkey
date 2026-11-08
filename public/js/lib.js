// Your library (songs + setlists), kept in this browser. Other tabs stay in step through the storage event.
// While you're in a session, other people's libraries are reachable here too: their setlists have ids like
// "<peer>~<setlistId>" and are read-only until you save a copy.
const KEY = 'tabmonkey:library';
let state = load();
const subs = new Set();
let remote = new Map(); // peer -> { songs, setlists } (set by session.js)

function load() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* private mode */ }
  s.songs ??= []; s.setlists ??= [];
  return s;
}
function commit() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota / private mode */ }
  subs.forEach((f) => f(state));
  return state;
}
addEventListener('storage', (e) => { if (e.key === KEY) { state = load(); subs.forEach((f) => f(state)); } });

const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('');

export const band = () => state;
export const onChange = (f) => subs.add(f);
export const refresh = async () => state;

export const hasSong = (id) => state.songs.some((s) => s.songId === id);

/** Song title/artist: yours first, then anyone's in the session. */
export function songMeta(id) {
  const mine = state.songs.find((s) => s.songId === id);
  if (mine) return mine;
  for (const lib of remote.values()) { const s = lib.songs?.find((x) => x.songId === id); if (s) return s; }
  return undefined;
}

export const isRemoteId = (id) => typeof id === 'string' && id.includes('~');
export function setlist(id) {
  if (!id) return undefined;
  if (!isRemoteId(id)) return state.setlists.find((l) => l.id === id);
  const [peer, sid] = id.split('~');
  const l = remote.get(peer)?.setlists?.find((x) => x.id === sid);
  return l && { ...l, id, peer, remote: true, sourceId: sid };
}

export function addSong(s) {
  if (!s?.songId || hasSong(s.songId)) return state;
  state.songs.push({ songId: Number(s.songId), title: String(s.title), artist: String(s.artist || ''), addedAt: Date.now() });
  return commit();
}
export function removeSong(id) {
  state.songs = state.songs.filter((x) => x.songId !== id);
  for (const l of state.setlists) l.songIds = l.songIds.filter((x) => x !== id);
  return commit();
}
export function createSetlist(name, songIds = []) {
  const l = { id: newId(), name: String(name || 'New setlist').slice(0, 80), songIds: [...songIds], updatedAt: Date.now() };
  state.setlists.push(l);
  commit();
  return l.id;
}
function local(id) { return state.setlists.find((l) => l.id === id); }
export function renameSetlist(id, name) { const l = local(id); if (l && name) { l.name = String(name).slice(0, 80); l.updatedAt = Date.now(); } return commit(); }
export function setSetlistSongs(id, songIds) {
  const l = local(id);
  if (l) { const known = new Set(state.songs.map((s) => s.songId)); l.songIds = [...new Set(songIds)].filter((n) => known.has(n)); l.updatedAt = Date.now(); }
  return commit();
}
export function deleteSetlist(id) { state.setlists = state.setlists.filter((l) => l.id !== id); return commit(); }
export function toggleInSetlist(id, song) {
  addSong(song);
  const l = local(id);
  if (!l) return state;
  return setSetlistSongs(id, l.songIds.includes(song.songId) ? l.songIds.filter((x) => x !== song.songId) : [...l.songIds, song.songId]);
}

// ---------- copies of other people's setlists
/** Your saved copy of someone's setlist, if any. */
export const savedCopy = (remoteSet) => state.setlists.find((l) => l.from && l.from === remoteSet.sourceId);
/** Is your copy identical to theirs (same name, same songs, same order)? */
export function copyIsCurrent(remoteSet) {
  const c = savedCopy(remoteSet);
  return !!c && c.name === remoteSet.name && c.songIds.join() === remoteSet.songIds.join();
}

/** Copy someone's setlist into your library (adding any songs you don't have), or bring your copy up to date. */
export function saveSetlist(remoteSet) {
  const lib = remote.get(remoteSet.peer);
  const meta = (id) => lib?.songs?.find((s) => s.songId === id) || songMeta(id);
  let added = 0;
  for (const id of remoteSet.songIds) {
    const s = meta(id);
    if (s && !hasSong(id)) { state.songs.push({ songId: id, title: s.title, artist: s.artist || '', addedAt: Date.now() }); added++; }
  }
  const ids = remoteSet.songIds.filter(hasSong);
  let copy = savedCopy(remoteSet);
  if (copy) { copy.name = remoteSet.name; copy.songIds = ids; copy.updatedAt = Date.now(); }
  else { copy = { id: newId(), name: remoteSet.name, songIds: ids, from: remoteSet.sourceId, updatedAt: Date.now() }; state.setlists.push(copy); }
  commit();
  return { id: copy.id, added };
}

/** Add every song from someone's library you don't have yet. */
export function saveSongs(songs) {
  let added = 0;
  for (const s of songs) if (!hasSong(s.songId)) { state.songs.push({ songId: s.songId, title: s.title, artist: s.artist || '', addedAt: Date.now() }); added++; }
  commit();
  return added;
}

// ---------- session plumbing (session.js)
export function setRemote(map) { remote = map; subs.forEach((f) => f(state)); }
export const remoteLibrary = (peer) => remote.get(peer);

// ---------- backup / restore
export const exportData = () => ({ songs: state.songs, setlists: state.setlists });
/** Merge a backup (or an old server data/band.json) into your library. Returns counts of what was new. */
export function importData(data) {
  const before = { songs: state.songs.length, setlists: state.setlists.length };
  for (const s of data?.songs || []) addSong(s);
  for (const l of data?.setlists || []) {
    if (!l?.name || state.setlists.some((x) => x.id === l.id)) continue;
    state.setlists.push({ id: String(l.id || newId()), name: String(l.name).slice(0, 80), songIds: (l.songIds || []).map(Number).filter(hasSong), updatedAt: l.updatedAt || Date.now(), ...(l.from ? { from: l.from } : {}) });
  }
  commit();
  return { songs: state.songs.length - before.songs, setlists: state.setlists.length - before.setlists };
}
