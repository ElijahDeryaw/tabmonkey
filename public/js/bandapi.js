// Client for the shared band library (songs + setlists) stored on the server.
let state = { songs: [], setlists: [] };
const subs = new Set();

async function call(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  state = data;
  subs.forEach((f) => f(state));
  return data;
}

export const band = () => state;
export const onChange = (f) => subs.add(f);
export const refresh = () => call('GET', '/api/band');

export const hasSong = (id) => state.songs.some((s) => s.songId === id);
export const songMeta = (id) => state.songs.find((s) => s.songId === id);
export const setlist = (id) => state.setlists.find((l) => l.id === id);

export const addSong = (s) => call('POST', '/api/band/songs', { songId: s.songId, title: s.title, artist: s.artist });
export const removeSong = (id) => call('DELETE', `/api/band/songs/${id}`);
export async function createSetlist(name) { const r = await call('POST', '/api/band/setlists', { name }); return r.created; }
export const renameSetlist = (id, name) => call('PATCH', `/api/band/setlists/${id}`, { name });
export const setSetlistSongs = (id, songIds) => call('PATCH', `/api/band/setlists/${id}`, { songIds });
export const deleteSetlist = (id) => call('DELETE', `/api/band/setlists/${id}`);

export async function toggleInSetlist(id, song) {
  if (!hasSong(song.songId)) await addSong(song);
  const l = setlist(id);
  const ids = l.songIds.includes(song.songId) ? l.songIds.filter((x) => x !== song.songId) : [...l.songIds, song.songId];
  return setSetlistSongs(id, ids);
}
