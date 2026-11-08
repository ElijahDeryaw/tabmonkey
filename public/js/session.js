// Sessions: a private link that, while it's open, shares everyone's songs and setlists with everyone else in it.
// Nothing is stored for good: libraries stay in each browser, the session only relays them, and it disappears when
// the host ends it (or a day after everyone has left). The relay is a Durable Object behind the TabMonkey Worker.
import * as lib from './lib.js';
import * as store from './store.js';
import { API } from './songs.js';

const KEY = 'tabmonkey:session';
const PEER_KEY = 'tabmonkey:peer';
const subs = new Set();

const rand = (n) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(n)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const peerId = (() => {
  let p = null;
  try { p = localStorage.getItem(PEER_KEY); if (!p) { p = rand(12); localStorage.setItem(PEER_KEY, p); } } catch { p ??= rand(12); }
  return p;
})();

const s = {
  saved: readSaved(),     // { id, hostKey? } while you're in a session
  ws: null, state: 'off', // off | connecting | live | retrying
  host: null, peers: [], libraries: new Map(),
  retry: 0, timer: null, ping: null, status: null,
  firstLibrary: null,     // resolves when the host's library first arrives after joining
};

function readSaved() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }
function writeSaved(v) { s.saved = v; try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch { /* private mode */ } }

const emit = (ev = {}) => subs.forEach((f) => f(ev));
export const onChange = (f) => subs.add(f);

// ---------- what the UI reads
export const me = () => peerId;
export const active = () => !!s.saved;
export const isHost = () => !!s.saved?.hostKey;
export const connection = () => s.state;
export const peers = () => s.peers;
export const others = () => s.peers.filter((p) => p.peer !== peerId);
export const peer = (id) => s.peers.find((p) => p.peer === id);
export const hostPeer = () => s.peers.find((p) => p.host);
export const library = (id) => s.libraries.get(id);
/** People (not you) who are sharing something, host first. */
export const sharing = () => others().filter((p) => s.libraries.get(p.peer)?.songs?.length || s.libraries.get(p.peer)?.setlists?.length)
  .sort((a, b) => (b.host - a.host) || a.name.localeCompare(b.name));
/** The link you send people. It goes through the Worker so iMessage & co. show a session preview card. */
export const inviteUrl = () => s.saved && `${API}/s/${s.saved.id}`;

// ---------- lifecycle
export function start() {
  if (s.saved) return;
  writeSaved({ id: rand(15), hostKey: rand(24) });
  connect();
  emit({ type: 'started' });
}

/** Join from an invite. Resolves with the host's peer id once their library has arrived (or null). */
export function join(id) {
  if (!/^[\w-]{16,40}$/.test(id)) return Promise.resolve(null);
  if (s.saved?.id === id) return Promise.resolve(hostPeer()?.peer ?? null);
  if (s.saved) disconnect();
  writeSaved({ id });
  const p = new Promise((resolve) => { s.firstLibrary = resolve; setTimeout(() => resolve(null), 8000); });
  connect();
  emit({ type: 'joining' });
  return p;
}

export function leave() {
  send({ type: 'leave' });
  disconnect();
  writeSaved(null);
  emit({ type: 'left' });
}
export function end() {
  if (!isHost()) return leave();
  send({ type: 'end' });
  disconnect();
  writeSaved(null);
  emit({ type: 'left' });
}

/** What you have open, shown next to your name ("on Hotel California"). */
export function setStatus(song) {
  s.status = song ? { songId: song.songId, title: song.title, artist: song.artist } : null;
  send({ type: 'status', status: s.status });
}
/** Call after your name or instrument changes. */
export function profileChanged() {
  if (!s.saved) return;
  const p = store.profile();
  if (s.state === 'off' || !s.ws) connect();
  else send({ type: 'profile', name: p?.name, instrument: p?.instrument });
}

// ---------- connection
function wsUrl() {
  const p = store.profile();
  const q = new URLSearchParams({ peer: peerId, name: p?.name || 'Guest', instrument: p?.instrument || '' });
  if (s.saved.hostKey) q.set('host', s.saved.hostKey);
  return `${API.replace(/^http/, 'ws')}/session/${s.saved.id}?${q}`;
}

function connect() {
  if (!s.saved || !API) return;
  if (!store.profile()) { s.state = 'off'; return; } // connects after "Who's playing?" (profileChanged)
  clearTimeout(s.timer);
  try { s.ws?.close(); } catch { /* already closed */ }
  s.state = s.retry ? 'retrying' : 'connecting';
  emit();
  const ws = new WebSocket(wsUrl());
  s.ws = ws;
  ws.onopen = () => {
    if (s.ws !== ws) return;
    s.state = 'live'; s.retry = 0;
    publish();
    if (s.status) send({ type: 'status', status: s.status });
    clearInterval(s.ping);
    s.ping = setInterval(() => { if (ws.readyState === 1) ws.send('ping'); }, 25000);
    emit();
  };
  ws.onmessage = (e) => { if (s.ws === ws && e.data !== 'pong') onMessage(JSON.parse(e.data)); };
  ws.onclose = (e) => {
    if (s.ws !== ws) return;
    clearInterval(s.ping);
    s.ws = null;
    if (e.code === 4404 || e.code === 4410 || !s.saved) return; // gone: handled in onMessage
    s.state = 'retrying'; emit();
    s.retry++;
    s.timer = setTimeout(connect, Math.min(15000, 600 * 2 ** Math.min(s.retry, 5)));
  };
}

function disconnect() {
  clearTimeout(s.timer); clearInterval(s.ping);
  const ws = s.ws; s.ws = null;
  try { ws?.close(1000); } catch { /* ignore */ }
  s.state = 'off'; s.host = null; s.peers = []; s.libraries = new Map(); s.retry = 0;
  lib.setRemote(s.libraries);
}

function send(msg) { if (s.ws?.readyState === 1) s.ws.send(JSON.stringify(msg)); }

let pubTimer = null;
function publish() {
  clearTimeout(pubTimer);
  pubTimer = setTimeout(() => {
    const { songs, setlists } = lib.band();
    send({ type: 'library', library: {
      songs: songs.map(({ songId, title, artist }) => ({ songId, title, artist })),
      setlists: setlists.map(({ id, name, songIds }) => ({ id, name, songIds })),
    } });
  }, 120);
}
lib.onChange(() => { if (s.state === 'live') publish(); });

function onMessage(m) {
  switch (m.type) {
    case 'welcome':
      s.host = m.host;
      s.peers = m.peers;
      s.libraries = new Map(Object.entries(m.libraries || {}).filter(([p]) => p !== peerId));
      lib.setRemote(s.libraries);
      if (s.libraries.has(m.host)) { s.firstLibrary?.(m.host); s.firstLibrary = null; }
      emit({ type: 'welcome' });
      break;
    case 'peers': {
      const before = new Set(s.peers.map((p) => p.peer));
      s.peers = m.peers;
      const joined = m.peers.filter((p) => !before.has(p.peer) && p.peer !== peerId && p.online);
      emit({ type: 'peers', joined });
      break;
    }
    case 'library':
      if (m.peer === peerId) break;
      s.libraries.set(m.peer, m.library);
      lib.setRemote(s.libraries);
      if (m.peer === s.host) { s.firstLibrary?.(m.peer); s.firstLibrary = null; }
      emit({ type: 'library', peer: m.peer });
      break;
    case 'gone':
      s.libraries.delete(m.peer);
      lib.setRemote(s.libraries);
      emit({ type: 'library', peer: m.peer });
      break;
    case 'ended':
    case 'missing': {
      const who = hostPeer()?.name;
      disconnect();
      writeSaved(null);
      s.firstLibrary?.(null); s.firstLibrary = null;
      emit({ type: 'ended', reason: m.type, who });
      break;
    }
  }
}

// iPads drop sockets when they sleep; come straight back when the app is visible again.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && s.saved && s.state !== 'live' && s.state !== 'connecting') { s.retry = 0; connect(); }
});
addEventListener('online', () => { if (s.saved && s.state !== 'live') { s.retry = 0; connect(); } });

export function boot() { if (s.saved) connect(); }
