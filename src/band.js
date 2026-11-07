// Shared band state: the songs the band plays and its setlists. One JSON file, written atomically.
// Personal things (who you are, your practice progress) stay in each browser.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const FILE = path.resolve('data', 'band.json');
let state = null;
let writing = Promise.resolve();

async function load() {
  if (state) return state;
  try { state = JSON.parse(await fs.readFile(FILE, 'utf8')); } catch { state = {}; }
  state.songs ??= [];
  state.setlists ??= [];
  return state;
}

function save() {
  const snapshot = JSON.stringify(state, null, 2);
  writing = writing.then(async () => {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE + '.tmp', snapshot);
    await fs.rename(FILE + '.tmp', FILE);
  });
  return writing;
}

export class BandError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export async function get() { return load(); }

export async function addSong({ songId, title, artist }) {
  const s = await load();
  songId = Number(songId);
  if (!songId || !title) throw new BandError('songId and title are required');
  if (!s.songs.some((x) => x.songId === songId)) {
    s.songs.push({ songId, title: String(title), artist: String(artist || ''), addedAt: Date.now() });
    await save();
  }
  return s;
}

export async function removeSong(songId) {
  const s = await load();
  songId = Number(songId);
  s.songs = s.songs.filter((x) => x.songId !== songId);
  for (const l of s.setlists) l.songIds = l.songIds.filter((id) => id !== songId);
  await save();
  return s;
}

export async function createSetlist(name) {
  const s = await load();
  const list = { id: crypto.randomBytes(4).toString('hex'), name: String(name || 'New setlist').slice(0, 80), songIds: [], updatedAt: Date.now() };
  s.setlists.push(list);
  await save();
  return { state: s, setlist: list };
}

export async function updateSetlist(id, { name, songIds }) {
  const s = await load();
  const list = s.setlists.find((l) => l.id === id);
  if (!list) throw new BandError('No such setlist', 404);
  if (name != null) list.name = String(name).slice(0, 80) || list.name;
  if (Array.isArray(songIds)) {
    const known = new Set(s.songs.map((x) => x.songId));
    list.songIds = [...new Set(songIds.map(Number))].filter((n) => known.has(n));
  }
  list.updatedAt = Date.now();
  await save();
  return s;
}

export async function deleteSetlist(id) {
  const s = await load();
  s.setlists = s.setlists.filter((l) => l.id !== id);
  await save();
  return s;
}
