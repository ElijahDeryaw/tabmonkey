// TabMonkey Worker: the two things the static site can't do by itself.
//   GET  /api/songs?pattern=   Songsterr search      ┐ Songsterr's API sends no CORS headers, so the browser can't call it
//   GET  /api/meta/:id          Songsterr song info   ┘ directly. Cached at the edge.
//   GET  /session/:id  (ws)     live session relay (one Durable Object per session)
//   GET  /s/:id                 invite link: a page with a session preview card (iMessage, WhatsApp…) that opens the app
import { DurableObject } from 'cloudflare:workers';

const SONGSTERR = 'https://www.songsterr.com/api';
const UA = 'TabMonkey/1.0 (band practice tab viewer)';
const ID = /^[\w-]{16,40}$/;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin');
    if (req.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), origin, env);

    if (url.pathname === '/api/songs') {
      const q = (url.searchParams.get('pattern') || '').trim().slice(0, 100);
      if (!q) return withCors(json({ error: 'Missing ?pattern=' }, 400), origin, env);
      return withCors(await proxy(`${SONGSTERR}/songs?size=25&pattern=${encodeURIComponent(q)}`, 600, ctx), origin, env);
    }
    let m = url.pathname.match(/^\/api\/meta\/(\d{1,9})$/);
    if (m) return withCors(await proxy(`${SONGSTERR}/meta/${m[1]}`, 86400, ctx), origin, env);

    m = url.pathname.match(/^\/session\/([\w-]+)$/);
    if (m && ID.test(m[1])) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      if (!allowed(origin, env)) return new Response('Forbidden', { status: 403 });
      return env.SESSIONS.get(env.SESSIONS.idFromName(m[1])).fetch(req);
    }

    m = url.pathname.match(/^\/s\/([\w-]+)\/?$/);
    if (m && ID.test(m[1])) return invitePage(m[1], env);

    if (url.pathname === '/') return Response.redirect(env.APP_URL, 302);
    return new Response('Not found', { status: 404 });
  },
};

// ---------- Songsterr proxy
async function proxy(target, ttl, ctx) {
  const cache = caches.default;
  const key = new Request(target);
  const hit = await cache.match(key);
  if (hit) return new Response(hit.body, hit);
  let res;
  try { res = await fetch(target, { headers: { 'User-Agent': UA, Accept: 'application/json' } }); }
  catch (e) { return json({ error: `Songsterr unreachable: ${e.message}` }, 502); }
  if (!res.ok) return json({ error: `Songsterr responded ${res.status}` }, res.status === 404 ? 404 : 502);
  const out = new Response(res.body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}` } });
  ctx.waitUntil(cache.put(key, out.clone()));
  return out;
}

const origins = (env) => String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const allowed = (origin, env) => !origin || origins(env).includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
function withCors(res, origin, env) {
  const r = new Response(res.body, res);
  if (origin && allowed(origin, env)) {
    r.headers.set('Access-Control-Allow-Origin', origin);
    r.headers.set('Vary', 'Origin');
    r.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  }
  return r;
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

// ---------- invite page: link previews read these tags (they don't run scripts); people are sent on to the app.
async function invitePage(id, env) {
  let info = null;
  try { info = await (await env.SESSIONS.get(env.SESSIONS.idFromName(id)).fetch('https://session/info')).json(); } catch { /* treat as ended */ }
  const app = env.APP_URL.replace(/\/?$/, '/');
  const target = `${app}#join=${id}`;
  const live = !!info?.exists;
  const host = info?.host || 'A friend';
  const count = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const title = live ? `Join ${possessive(host)} session` : 'This TabMonkey session has ended';
  const what = live ? [info.setlists ? count(info.setlists, 'setlist') : null, info.songs ? count(info.songs, 'song') : null].filter(Boolean).join(' · ') : '';
  const desc = live
    ? `${what ? `${what}. ` : ''}Open the songs, play along, and save any setlist to your own library.${info.people > 1 ? ` ${info.people} people are in.` : ''}`
    : 'Ask for a new link, or open TabMonkey to find songs yourself.';
  const image = `${app}${live ? 'og-session.png' : 'og.png'}`;
  const e = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)}</title>
<meta name="description" content="${e(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="TabMonkey">
<meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(desc)}">
<meta property="og:image" content="${e(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="TabMonkey session invite">
<meta property="og:url" content="${e(env.WORKER_URL ? `${env.WORKER_URL.replace(/\/$/, '')}/s/${id}` : target)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${e(title)}">
<meta name="twitter:description" content="${e(desc)}">
<meta name="twitter:image" content="${e(image)}">
<meta name="theme-color" content="#16161a">
<link rel="icon" href="${e(app)}icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${e(app)}apple-touch-icon.png">
<style>
  :root{color-scheme:light dark;--bg:#f6f6f4;--ink:#18181a;--soft:#6b6b66}
  @media (prefers-color-scheme:dark){:root{--bg:#121211;--ink:#ededea;--soft:#9a9a94}}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.45 system-ui,-apple-system,sans-serif;padding:16px;box-sizing:border-box;text-align:center}
  a{color:inherit;font-weight:600}
  p{color:var(--soft);margin:.4em 0 0}
</style></head>
<body><main><h1 style="font-size:20px;margin:0">${e(title)}</h1><p>${live ? 'Opening TabMonkey…' : e(desc)}</p><p><a href="${e(live ? target : app)}">Open TabMonkey</a></p></main>
<script>location.replace(${JSON.stringify(live ? target : app)});</script>
</body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
const possessive = (name) => (/s$/i.test(name) ? `${name}’` : `${name}’s`);

// ---------- the session relay
// Storage: meta { hostKey, hostPeer, created, touched }, peers { [peer]: { name, instrument, color, host, status } },
// lib:<peer> { songs, setlists }. Guests' libraries are dropped when they leave; the host's stays while the session lives.
const COLORS = ['#f2555a', '#3d8ef7', '#2fb36d', '#f5a524', '#9b5de5', '#14b8a6', '#ec4899', '#f97316', '#84cc16', '#0ea5e9'];
const TTL = 24 * 3600 * 1000; // a session nobody is in disappears a day later
const MAX_MSG = 600_000;

const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);
function cleanLibrary(lib) {
  const songs = (Array.isArray(lib?.songs) ? lib.songs : []).slice(0, 3000)
    .map((s) => ({ songId: Number(s.songId), title: clean(s.title, 200), artist: clean(s.artist, 200) }))
    .filter((s) => Number.isInteger(s.songId) && s.songId > 0 && s.title);
  const known = new Set(songs.map((s) => s.songId));
  const setlists = (Array.isArray(lib?.setlists) ? lib.setlists : []).slice(0, 300)
    .map((l) => ({ id: clean(l.id, 24).replace(/[^\w-]/g, ''), name: clean(l.name, 80) || 'Setlist', songIds: (Array.isArray(l.songIds) ? l.songIds : []).map(Number).filter((n) => known.has(n)).slice(0, 500) }))
    .filter((l) => l.id);
  return { songs, setlists };
}

export class Session extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/info') return json(await this.info());

    const peer = url.searchParams.get('peer') || '';
    const hostKey = url.searchParams.get('host') || '';
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    if (!/^[\w-]{8,40}$/.test(peer)) { server.accept(); server.close(4400, 'bad peer'); return new Response(null, { status: 101, webSocket: client }); }

    let meta = await this.ctx.storage.get('meta');
    if (!meta) {
      if (!hostKey) {
        server.accept();
        server.send(JSON.stringify({ type: 'missing' }));
        server.close(4404, 'no such session');
        return new Response(null, { status: 101, webSocket: client });
      }
      meta = { hostKey, hostPeer: peer, created: Date.now() };
    }
    const isHost = peer === meta.hostPeer && hostKey === meta.hostKey;
    meta.touched = Date.now();
    await this.ctx.storage.put('meta', meta);

    const peers = (await this.ctx.storage.get('peers')) || {};
    const used = new Set(Object.entries(peers).filter(([p]) => p !== peer).map(([, v]) => v.color));
    const p = peers[peer] || { color: COLORS.find((c) => !used.has(c)) || COLORS[Object.keys(peers).length % COLORS.length], joined: Date.now() };
    p.name = clean(url.searchParams.get('name'), 24) || 'Guest';
    p.instrument = clean(url.searchParams.get('instrument'), 12);
    p.host = isHost;
    peers[peer] = p;
    await this.ctx.storage.put('peers', peers);

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ peer });
    server.send(JSON.stringify({ type: 'welcome', you: peer, host: meta.hostPeer, peers: this.roster(peers, meta), libraries: await this.libraries(peers, meta) }));
    this.broadcast({ type: 'peers', peers: this.roster(peers, meta) }, server);
    await this.ctx.storage.setAlarm(Date.now() + TTL);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Peers with an open socket (optionally ignoring one that is closing). */
  online(except) {
    const set = new Set();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except || ws.readyState !== WebSocket.OPEN) continue;
      const a = ws.deserializeAttachment();
      if (a?.peer) set.add(a.peer);
    }
    return set;
  }

  roster(peers, meta, except) {
    const on = this.online(except);
    return Object.entries(peers)
      .filter(([id]) => on.has(id) || id === meta.hostPeer)
      .map(([id, v]) => ({ peer: id, name: v.name, instrument: v.instrument, color: v.color, host: id === meta.hostPeer, online: on.has(id), status: v.status || null, joined: v.joined }))
      .sort((a, b) => (b.host - a.host) || a.joined - b.joined);
  }

  async libraries(peers, meta) {
    const on = this.online();
    const ids = Object.keys(peers).filter((id) => on.has(id) || id === meta.hostPeer);
    const libs = await this.ctx.storage.get(ids.map((id) => `lib:${id}`));
    const out = {};
    for (const id of ids) { const l = libs.get(`lib:${id}`); if (l) out[id] = l; }
    return out;
  }

  broadcast(msg, except) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try { ws.send(data); } catch { /* closing */ }
    }
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX_MSG) return;
    let m; try { m = JSON.parse(raw); } catch { return; }
    const { peer } = ws.deserializeAttachment() || {};
    if (!peer) return;
    const meta = await this.ctx.storage.get('meta');
    if (!meta) return;
    const peers = (await this.ctx.storage.get('peers')) || {};
    if (!peers[peer]) return;

    switch (m.type) {
      case 'library': {
        const library = cleanLibrary(m.library);
        await this.ctx.storage.put(`lib:${peer}`, library);
        this.broadcast({ type: 'library', peer, library }, ws);
        break;
      }
      case 'status':
        peers[peer].status = m.status?.songId ? { songId: Number(m.status.songId), title: clean(m.status.title, 200), artist: clean(m.status.artist, 200) } : null;
        await this.ctx.storage.put('peers', peers);
        this.broadcast({ type: 'peers', peers: this.roster(peers, meta) });
        break;
      case 'profile':
        peers[peer].name = clean(m.name, 24) || peers[peer].name;
        peers[peer].instrument = clean(m.instrument, 12);
        await this.ctx.storage.put('peers', peers);
        this.broadcast({ type: 'peers', peers: this.roster(peers, meta) });
        break;
      case 'leave':
        if (peer === meta.hostPeer) break;
        delete peers[peer];
        await this.ctx.storage.put('peers', peers);
        await this.ctx.storage.delete(`lib:${peer}`);
        this.broadcast({ type: 'gone', peer }, ws);
        this.broadcast({ type: 'peers', peers: this.roster(peers, meta, ws) }, ws);
        break;
      case 'end':
        if (peer !== meta.hostPeer) break;
        this.broadcast({ type: 'ended' }, ws);
        for (const s of this.ctx.getWebSockets()) { try { s.close(4410, 'ended'); } catch { /* closed */ } }
        await this.ctx.storage.deleteAlarm();
        await this.ctx.storage.deleteAll();
        break;
    }
  }

  async webSocketClose(ws, code) {
    try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch { /* already closed */ }
    await this.departed(ws);
  }
  async webSocketError(ws) { await this.departed(ws); }

  async departed(ws) {
    const { peer } = ws.deserializeAttachment() || {};
    const meta = await this.ctx.storage.get('meta');
    if (!peer || !meta) return;
    const peers = (await this.ctx.storage.get('peers')) || {};
    if (this.online(ws).has(peer)) return; // still here in another tab
    if (peer !== meta.hostPeer) {
      await this.ctx.storage.delete(`lib:${peer}`);
      this.broadcast({ type: 'gone', peer }, ws);
    }
    meta.touched = Date.now();
    await this.ctx.storage.put('meta', meta);
    this.broadcast({ type: 'peers', peers: this.roster(peers, meta, ws) }, ws);
  }

  async alarm() {
    const meta = await this.ctx.storage.get('meta');
    if (!meta) return;
    if (this.online().size || Date.now() - (meta.touched || meta.created) < TTL) { await this.ctx.storage.setAlarm(Date.now() + TTL); return; }
    await this.ctx.storage.deleteAll();
  }

  async info() {
    const meta = await this.ctx.storage.get('meta');
    if (!meta) return { exists: false };
    const peers = (await this.ctx.storage.get('peers')) || {};
    const lib = (await this.ctx.storage.get(`lib:${meta.hostPeer}`)) || { songs: [], setlists: [] };
    return { exists: true, host: peers[meta.hostPeer]?.name || null, songs: lib.songs.length, setlists: lib.setlists.length, people: this.online().size };
  }
}
