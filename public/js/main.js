// App shell: routing, who's playing, and the song screen (sheet, song map, transport, practice).
import * as store from './store.js';
import * as bandApi from './lib.js';
import * as songs from './songs.js';
import * as session from './session.js';
import * as sessionUi from './sessionui.js';
import * as native from './native.js';
import * as player from './player.js';
import * as practice from './practice.js';
import * as library from './library.js';
import { INSTRUMENTS, pickTrack, describeTuning } from './instruments.js';
import { buildSections, sectionAt, spotFor } from './sections.js';
import { $, esc, icon, toast, popover, closePopover, popoverOpen } from './ui.js';
import { THEMES, sheetTheme, loadThemeFonts } from './themes.js';
import { openSwitcher } from './switcher.js';
import * as retune from './retune.js';

const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const DEFAULT_VIEW = { guitar: 'tab', bass: 'tab', drums: 'notation', vocals: 'notation', keys: 'notation', other: 'both' };
const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches;

const app = {
  info: null, songId: null, setId: null, sections: [], selected: new Set(), scoreIndexOf: [],
  spot: null, speed: 1, playing: false, ready: { render: false, midi: false }, resumed: false, currentSection: -1,
};
let api = null;

// ================= routing =================
function navigate(hash, opts = {}) {
  pendingOpts = opts;
  if (location.hash.slice(1) === hash) route(); else location.hash = hash;
}
let pendingOpts = {};
function route() {
  const h = new URLSearchParams(location.hash.slice(1));
  const opts = pendingOpts; pendingOpts = {};
  closePopover();
  if (h.get('join')) { joinSession(h.get('join')); return; }
  const view = h.get('set') ? { kind: 'set', id: h.get('set') } : h.get('peer') ? { kind: 'peer', peer: h.get('peer') }
    : { kind: ['sets', 'session', 'me'].includes(h.get('tab')) ? h.get('tab') : 'songs' };
  // Phones and tablets: songs push in from the right and pop back out, like a native navigation stack.
  const depth = h.get('song') ? 2 : view.kind === 'set' || view.kind === 'peer' ? 1 : 0;
  native.transition(depth, () => {
    if (h.get('song')) {
      document.body.dataset.screen = 'song';
      openSong(Number(h.get('song')), h.get('set'));
    } else {
      leaveSong();
      document.body.dataset.screen = 'library';
      document.title = 'TabMonkey';
      session.setStatus(null);
      library.render(view, opts);
    }
  });
}

// Swipe in from the left edge to go back (touch screens).
native.enableSwipeBack(() => {
  if (document.body.dataset.screen === 'song') return () => $('back').click();
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('set') || h.get('peer')) return () => navigate(native.phone() ? 'tab=sets' : '');
  return null;
});

// Opening an invite link (…#join=<id>): join, then land on the host's library once it arrives.
async function joinSession(id) {
  history.replaceState(null, '', location.pathname + location.search);
  route();
  if (!store.profile()) { pendingJoin = id; return; } // after "Who's playing?"
  toast('Joining the session…');
  const host = await session.join(id);
  const p = host && session.peer(host);
  if (!p) return; // ended / unreachable: sessionui says so
  toast(`You’re in ${/s$/i.test(p.name) ? `${p.name}’` : `${p.name}’s`} session`);
  if (document.body.dataset.screen === 'library' && !location.hash.slice(1)) navigate(`peer=${host}`);
}
let pendingJoin = null;

function leaveSong() {
  if (api && app.playing) api.pause();
  if (document.body.classList.contains('stage')) toggleStage(false);
}

// ================= who's playing =================
function drawWho() {
  const p = store.profile();
  const inst = INSTRUMENTS.find((i) => i.id === p?.instrument);
  $('who-btn').innerHTML = p ? `${esc(p.name)}<span class="meta">${inst?.label ?? ''}</span>${icon('chev-down')}` : 'Set up';
}

function whoDialog({ name = '', instrument = 'guitar', required = false } = {}) {
  let inst = instrument;
  // First launch: a welcome screen rather than a bare form.
  const first = required && !store.profileNames().length;
  $('who-welcome').hidden = !first;
  $('who-title').hidden = first;
  $('who').classList.toggle('first-run', first);
  $('who-name').value = name;
  const drawInst = () => {
    $('who-inst').innerHTML = INSTRUMENTS.map((i) => `<button type="button" role="radio" aria-checked="${i.id === inst}" data-i="${i.id}">${i.label}</button>`).join('');
  };
  drawInst();
  $('who-inst').onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) { inst = b.dataset.i; drawInst(); } };
  $('who-form').onsubmit = (e) => {
    const n = $('who-name').value.trim();
    if (!n) { e.preventDefault(); return; }
    store.setProfile(n, inst);
    afterWho();
  };
  $('who').oncancel = (e) => { if (required) e.preventDefault(); };
  // Close with the X, a tap outside, or (on phones) a swipe down, unless a name is required.
  $('who-close').hidden = required;
  $('who-close').onclick = () => $('who').close();
  $('who').onclick = (e) => {
    if (required || e.target !== $('who')) return;
    const r = $('who').getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) $('who').close();
  };
  $('who')._required = required;
  native.enableSwipeDismiss($('who'), () => $('who').close(), () => !$('who')._required);
  $('who').showModal();
  $('who-name').focus();
}

function afterWho() {
  drawWho();
  session.profileChanged();
  if (pendingJoin) { const id = pendingJoin; pendingJoin = null; setTimeout(() => joinSession(id)); }
  if (app.info) { const id = app.songId; app.songId = null; openSong(id, app.setId, { fresh: true }); }
  else route();
}

$('who-btn').onclick = () => {
  const p = store.profile();
  popover($('who-btn'), () => `
    <div class="menu-label">Players on this device</div>
    ${store.profileNames().map((n) => `<button class="menu-item" data-p="${esc(n)}"><span class="check">${n === p?.name ? icon('check') : ''}</span><span class="grow">${esc(n)}</span><span class="meta">${INSTRUMENTS.find((i) => i.id === store.profileInstrument(n))?.label ?? ''}</span></button>`).join('')}
    <div class="menu-sep"></div>
    <button class="menu-item" data-act="edit"><span class="check"></span>Edit ${esc(p?.name ?? 'player')}…</button>
    <button class="menu-item" data-act="new"><span class="check">${icon('plus')}</span>New player…</button>
    <div class="menu-sep"></div>
    <div class="menu-label">Everything is kept in this browser</div>
    <button class="menu-item" data-act="backup"><span class="check">${icon('save')}</span>Back up library and progress</button>
    <button class="menu-item" data-act="restore"><span class="check"></span>Restore from a backup…</button>`, {
    align: 'end',
    onClick: (e, m) => {
      const pick = e.target.closest('[data-p]');
      if (pick) { m.close(); store.setProfile(pick.dataset.p); afterWho(); return; }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'backup') { m.close(); backup(); return; }
      if (act === 'restore') { m.close(); $('import-file').click(); return; }
      if (act) { m.close(); whoDialog(act === 'edit' ? { name: p?.name, instrument: p?.instrument } : {}); }
    },
  });
};

// ---------- You (the iPhone tab): players on this device, backup, install
function mePage() {
  const p = store.profile();
  const inst = (n) => INSTRUMENTS.find((i) => i.id === store.profileInstrument(n))?.label ?? '';
  return `<div class="page-head"><div class="title"><h1>You</h1></div></div>
    <div class="list-head"><span>Players on this device</span></div>
    <div class="list">
      ${store.profileNames().map((n) => `<button class="row list-row" data-me-player="${esc(n)}">
        <span class="cell"><span class="t">${esc(n)}</span><span class="s">${inst(n)}</span></span>
        ${n === p?.name ? `<span class="added">${icon('check')}Playing</span>` : '<span></span>'}</button>`).join('')}
      <button class="row list-row" data-me="edit"><span class="cell"><span class="t">Edit ${esc(p?.name ?? 'player')}</span><span class="s">Name and instrument</span></span><span class="chev">${icon('chev-right')}</span></button>
      <button class="row list-row" data-me="new"><span class="cell"><span class="t">Add a player</span><span class="s">For a shared iPad</span></span><span class="chev">${icon('plus')}</span></button>
    </div>
    ${native.canInstall() ? `<div class="list-head"><span>Install</span></div>
    <div class="install">
      <img src="apple-touch-icon.png" alt="" width="44" height="44">
      <div><strong>Add to Home Screen</strong>
      <p>In Safari, tap ${icon('ios-share')} Share, then Add to Home Screen. TabMonkey opens full screen and works offline.</p></div>
    </div>` : ''}
    <div class="list-head"><span>Your library lives on this device</span></div>
    <div class="list">
      <button class="row list-row" data-me="backup"><span class="cell"><span class="t">Back up library and progress</span><span class="s">Saves a file you can restore anywhere</span></span><span class="chev">${icon('save')}</span></button>
      <button class="row list-row" data-me="restore"><span class="cell"><span class="t">Restore from a backup</span><span class="s">Adds what's in the file to this device</span></span><span class="chev">${icon('chev-right')}</span></button>
    </div>
    <p class="fine-print">TabMonkey · Monkey see, monkey play.<br>Tab data from Songsterr.</p>`;
}
document.addEventListener('click', (e) => {
  const pl = e.target.closest('[data-me-player]');
  const a = e.target.closest('[data-me]')?.dataset.me;
  if (!pl && !a) return;
  native.haptic();
  if (pl) { store.setProfile(pl.dataset.mePlayer); afterWho(); return; }
  const p = store.profile();
  if (a === 'edit') whoDialog({ name: p?.name, instrument: p?.instrument });
  if (a === 'new') whoDialog({});
  if (a === 'backup') backup();
  if (a === 'restore') $('import-file').click();
});

// ---------- backup / restore: one JSON file with your library and every player's progress on this device
function backup() {
  const data = { app: 'tabmonkey', version: 1, savedAt: new Date().toISOString(), library: bandApi.exportData(), players: store.exportAll() };
  songs.download(`TabMonkey backup ${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 1), 'application/json');
}
$('import-file').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    // Accepts a TabMonkey backup or the old server's data/band.json ({ songs, setlists }).
    const r = bandApi.importData(data.library ?? data);
    if (data.players) store.importAll(data.players);
    drawWho();
    toast(`Restored ${r.songs} song${r.songs === 1 ? '' : 's'} and ${r.setlists} setlist${r.setlists === 1 ? '' : 's'}`);
    route();
  } catch (err) { toast('That file isn’t a TabMonkey backup'); console.error(err); }
};

// ================= song screen =================
async function openSong(id, setId, { fresh = false } = {}) {
  app.setId = setId || null;
  drawSetNav();
  if (id === app.songId && !fresh) { drawHeader(); return; }
  if (api && app.playing) api.stop();
  app.ready = { render: false, midi: false }; // a play press from now on waits for this song
  closeSpot(false);
  // Drop the previous song's loop range, or alphaTab tries to draw it on the new song before it's laid out.
  if (api) { api.isLooping = false; api.playbackRange = null; api.clearPlaybackRangeHighlight(); }
  loading('Loading');
  let info, gp;
  try {
    ({ info, gp } = await songs.build(id));
  } catch (e) {
    loading(null);
    toast('Could not load that song: ' + e.message);
    console.error(e);
    return;
  }
  if (Number(new URLSearchParams(location.hash.slice(1)).get('song')) !== id) return; // moved on while it loaded
  const s = store.song(id);
  app.info = info; app.songId = id; app.resumed = false;
  app.ready = { render: false, midi: false };
  let n = 0; app.scoreIndexOf = info.tracks.map((t) => (t.loaded ? n++ : -1));
  app.selected = new Set([pickTrack(info, store.profile()?.instrument, s.track)]);
  rememberPart();
  store.updateSong(id, { title: info.title, artist: info.artist, opened: Date.now(), sectionCount: info.sections || undefined });
  session.setStatus(info);

  document.title = `${info.title} · ${info.artist}`;
  $('s-title').textContent = info.title;
  $('s-artist').textContent = info.artist;
  drawHeader();
  drawMixControls();
  if (info.missing.length) toast(`${info.missing.length} part(s) couldn't be downloaded`);

  if (!api) createApi();
  api.load(gp.slice()); // alphaTab may transfer the buffer to its worker; keep ours for retries and downloads
  watchLoad(id, false, gp);
}

// Never leave the loading overlay up forever: retry the load once, then give up with a message.
let loadWatch = null;
function watchLoad(id, retried, gp) {
  clearTimeout(loadWatch);
  loadWatch = setTimeout(() => {
    if (app.songId !== id || $('loading').hidden) return;
    if (!retried) { console.warn('Score load stalled, retrying'); api.load(gp.slice()); watchLoad(id, true, gp); return; }
    loading(null);
    toast('This song is taking too long to draw. Try reloading the page.');
  }, 15000);
}

const mainTrack = () => app.info.tracks[[...app.selected][0]];
function rememberPart() {
  const t = mainTrack();
  const tun = describeTuning(t.tuning, t.role);
  const tuning = [tun && !tun.standard ? tun.name : tun ? 'Standard' : null, t.capo ? `Capo ${t.capo}` : null].filter(Boolean).join(' · ');
  store.updateSong(app.songId ?? app.info.songId, { track: t.index, partName: t.part, tuningName: tuning || null, tuningOdd: !!((tun && !tun.standard) || t.capo) });
}

function loading(msg) { $('loading').hidden = !msg; if (msg) $('loading-msg').textContent = msg; }

function drawHeader() {
  if (!app.info) return;
  const t = mainTrack();
  const staff = api?.score?.tracks[app.scoreIndexOf[t.index]]?.staves[0];
  const tuning = staff?.tuning?.length ? [...staff.tuning] : t.tuning;
  const capo = staff ? staff.capo : t.capo;
  const tun = describeTuning(tuning, t.role);
  const k = songShift();
  const odd = [k ? `Key ${k > 0 ? '+' : '−'}${Math.abs(k)}` : null, tun && !tun.standard ? tun.name : null, capo ? `Capo ${capo}` : null].filter(Boolean).join(' · ');
  const more = app.selected.size > 1 ? ` + ${app.selected.size - 1}` : '';
  $('part-name').textContent = t.part + more;
  $('part-meta').textContent = odd || (tun ? 'Standard' : '');
  $('part-meta').className = `meta ${odd ? 'warn' : ''}`;
  $('add-song').hidden = bandApi.hasSong(app.songId);
  const l = app.setId && bandApi.setlist(app.setId);
  $('back-label').textContent = l ? l.name : 'Songs';
}

function drawSetNav() {
  const l = app.setId && bandApi.setlist(app.setId);
  const current = Number(new URLSearchParams(location.hash.slice(1)).get('song')) || app.songId;
  const i = l ? l.songIds.indexOf(current) : -1;
  $('setnav').hidden = !l || i < 0;
  if (!l || i < 0) return;
  $('set-pos').textContent = `${i + 1} of ${l.songIds.length}`;
  const prev = bandApi.songMeta(l.songIds[i - 1]), next = bandApi.songMeta(l.songIds[i + 1]);
  $('set-prev').disabled = !prev; $('set-prev').title = prev ? `Previous: ${prev.title} (P)` : '';
  $('set-next').disabled = !next; $('set-next').title = next ? `Next: ${next.title} (N)` : 'End of setlist';
}
function stepSet(dir) {
  const l = app.setId && bandApi.setlist(app.setId);
  if (!l) return;
  const current = Number(new URLSearchParams(location.hash.slice(1)).get('song')) || app.songId;
  const id = l.songIds[l.songIds.indexOf(current) + dir];
  if (id) navigate(`song=${id}&set=${l.id}`);
}
$('set-prev').onclick = () => stepSet(-1);
$('set-next').onclick = () => stepSet(1);
$('back').onclick = () => navigate(app.setId && bandApi.setlist(app.setId) ? `set=${app.setId}` : '');
$('add-song').onclick = async () => {
  await bandApi.addSong(app.info);
  drawHeader();
  toast(`Added ${app.info.title} to songs`);
};

const roleOfMain = () => mainTrack()?.role ?? 'other';
const yourView = () => store.pref(`view:${roleOfMain()}`, DEFAULT_VIEW[roleOfMain()] ?? 'tab');
const scoreTracks = () => [...app.selected].sort((a, b) => a - b).map((i) => api?.score?.tracks[app.scoreIndexOf[i]]).filter(Boolean);
const autoZoom = () => { const w = innerWidth; return w < 500 ? 0.8 : w < 900 ? 0.95 : w > 1600 ? 1.1 : 1; };
const zoomLevel = () => store.device('zoom', autoZoom());
const themeName = () => store.device('theme', 'comfort');
const sheetDark = () => store.device('sheet', prefersDark ? 'dark' : 'light') === 'dark';
const theme = () => sheetTheme(themeName(), sheetDark());
const effectiveScale = () => Math.round(zoomLevel() * theme().scaleFactor * 100) / 100;

function createApi() {
  api = player.create($('sheet'), $('viewport'), { scale: effectiveScale(), layout: 'Page', view: yourView() }); // always pages: the sheet only ever scrolls up and down
  player.updateDisplay({ theme: theme().settings, scale: effectiveScale() });
  window.tabApi = api; // for debugging in the console
  api.scoreLoaded.on((score) => {
    try {
      // Guitar Pro stores key signatures per master bar, so drum staves inherit the song key on import.
      for (const t of score.tracks) for (const st of t.staves) if (st.isPercussion) for (const b of st.bars) b.keySignature = 0;
      app.sections = buildSections(score);
      drawMap();
    } catch (e) { console.error(e); } // a problem with the song map must never stop the sheet from drawing
    retune.snapshot(score);
    applyLyricsSetting();
    applyRetune({ render: false });
    player.render(scoreTracks(), yourView());
    if (songShift() || tuningChoice()) api.loadMidiForScore(); // playback must use the re-fingered pitches
  });
  api.renderFinished.on(() => loading(null));
  api.postRenderFinished.on(() => { loading(null); drawLabels(); touchHint(); });
  // Layout bounds exist only after this: resume the last loop, or redraw its highlight for the new layout.
  api.postRenderFinished.on(() => {
    if (!app.ready.render) { app.ready.render = true; maybeResume(); }
    else if (app.spot) player.highlightBars(app.spot.start, app.spot.end);
  });
  api.midiLoaded.on(() => { app.ready.midi = true; applyMix(); applyTransposition(); maybeResume(); if (wantPlay) setTimeout(() => startPlayback(), 50); });
  api.error.on((e) => { loading(null); toast('Could not draw this song'); console.error(e); });
  api.soundFontLoad.on((e) => {
    $('sf').hidden = false;
    $('sf').querySelector('i').style.width = `${Math.round((e.loaded / (e.total || 1)) * 100)}%`;
  });
  api.playerReady.on(() => { $('sf').hidden = true; $('t-play').disabled = false; applyMix(); applyToggles(); if (wantPlay) setTimeout(() => startPlayback(), 50); });
  api.playerStateChanged.on((e) => {
    app.playing = e.state === 1;
    $('t-play').innerHTML = icon(app.playing ? 'pause' : 'play');
    $('t-play').setAttribute('aria-label', app.playing ? 'Pause' : 'Play');
  });
  api.playerPositionChanged.on(onPosition);
  api.playbackRangeChanged.on((e) => onRange(e.playbackRange));
  api.playerFinished.on(onFinished);
  player.enableTouchSelect($('sheet'), () => native.haptic(), { onBeat: native.tick });
}

// Touch screens: say once how to loop a passage, since there's no mouse to drag with.
function touchHint() {
  if (!matchMedia('(pointer: coarse)').matches || store.device('touchHint', false)) return;
  store.setDevice('touchHint', true);
  setTimeout(() => toast('Tip: hold on the music, then drag to loop that bit'), 900);
}

function maybeResume() {
  if (app.resumed || !app.ready.render || !app.ready.midi) return;
  app.resumed = true;
  const s = store.song(app.songId);
  setSpeed(s.speed ?? 1, false);
  const spot = s.lastSpot?.key ? s.lastSpot : null;
  if (spot && spot.end < player.barCount()) {
    loopSpot({ key: spot.key, label: spot.label, start: spot.start, end: spot.end });
    player.seekBar(spot.start);
    setTimeout(() => showBar(spot.start), 150); // after alphaTab settles its own cursor scroll
  }
}

// ---------- position, passes, loop range
function onPosition(e) {
  lastTick = e.currentTick;
  $('t-time').innerHTML = `${fmt(e.currentTime)} <span class="meta">/ ${fmt(e.endTime)}</span>`;
  const bar = player.barAt(e.currentTick);
  const idx = sectionAt(app.sections, bar);
  const secs = $('map-track').querySelectorAll('.sec');
  if (idx !== app.currentSection) {
    app.currentSection = idx;
    secs.forEach((c, i) => c.classList.toggle('now', i === idx));
    if (app.playing) secs[idx]?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }
  const sec = app.sections[idx], el = secs[idx];
  if (sec && el) {
    const a = player.barStart(sec.start), b = player.barEnd(sec.end);
    const f = b > a ? Math.min(1, Math.max(0, (e.currentTick - a) / (b - a))) : 0;
    $('playhead').style.left = `${el.offsetLeft + el.offsetWidth * f}px`;
  }
}

// End of a pass. Without count-in alphaTab loops seamlessly; with count-in we restart playback ourselves,
// because alphaTab only counts in when playback starts.
function onFinished() {
  if (!app.spot) return;
  practice.onPass();
  if (!api.isLooping) {
    const spot = app.spot;
    setTimeout(() => {
      if (app.spot !== spot || app.playing) return;
      player.seekBar(spot.start);
      api.play();
    }, 250);
  }
}
function syncLoopMode() { if (api) api.isLooping = !!app.spot && !store.pref('countIn', true); }

function onRange(range) {
  if (!range) { if (app.spot) closeSpot(false); return; }
  const start = player.barAt(range.startTick), end = player.barAt(Math.max(range.startTick, range.endTick - 1));
  const spot = spotFor(app.sections, start, end);
  if (app.spot?.key !== spot.key) setSpot(spot);
}

// ---------- spots (what you're practicing)
function loopSpot(spot) { setSpot(spot); player.loopBars(spot.start, spot.end); }

function setSpot(spot) {
  app.spot = spot;
  store.updateSong(app.songId, { lastSpot: { key: spot.key, label: spot.label, start: spot.start, end: spot.end } });
  practice.open({
    songId: app.songId, spot,
    getSpeed: () => app.speed,
    setSpeed: (v) => setSpeed(v),
    onClose: () => closeSpot(true),
    onProgress: drawMapProgress,
    toast,
  });
  syncLoopMode();
  drawLoopState();
}

/** byUser: you stopped the loop on purpose, so forget it. Otherwise just reset the UI. */
function closeSpot(byUser = true) {
  app.spot = null;
  practice.close();
  if (byUser) {
    player.clearLoop();
    if (app.songId) store.updateSong(app.songId, { lastSpot: null });
  }
  syncLoopMode();
  drawLoopState();
}

function drawLoopState() {
  $('t-loop').setAttribute('aria-pressed', String(!!app.spot));
  const s = app.spot;
  $('map-track').querySelectorAll('.sec').forEach((c) => {
    const sec = app.sections[Number(c.dataset.i)];
    c.classList.toggle('loop', !!s && sec.start >= s.start && sec.end <= s.end);
  });
}

// ---------- song map
function drawMap() {
  $('map-track').innerHTML = app.sections.map((s, i) =>
    `<button class="sec" data-i="${i}" style="--w:${s.end - s.start + 1}" title="${esc(s.label)} · bars ${s.start + 1}–${s.end + 1}. Click to jump, double-click to loop">
      <span>${esc(s.label)}</span><i class="best"></i></button>`).join('') + '<div class="playhead" id="playhead"></div>';
  app.currentSection = -1;
  drawMapProgress(); drawLoopState();
}

function drawMapProgress() {
  const spots = store.song(app.songId).spots;
  $('map-track').querySelectorAll('.sec').forEach((c) => {
    const best = spots[app.sections[Number(c.dataset.i)].key]?.best || 0;
    c.querySelector('.best').style.width = `${Math.min(100, best)}%`;
  });
}

let holdTimer = null, held = false, holdX = 0, holdY = 0;
$('map').addEventListener('pointerdown', (e) => {
  const c = e.target.closest('.sec'); if (!c) return;
  held = false; holdX = e.clientX; holdY = e.clientY;
  holdTimer = setTimeout(() => { held = true; navigator.vibrate?.(10); loopSection(Number(c.dataset.i)); }, 450);
});
$('map').addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - holdX, e.clientY - holdY) > 8) clearTimeout(holdTimer); });
['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => $('map').addEventListener(ev, () => clearTimeout(holdTimer)));
$('map').addEventListener('click', (e) => {
  const c = e.target.closest('.sec'); if (!c || held) return;
  const i = Number(c.dataset.i), sec = app.sections[i];
  if (e.shiftKey && app.spot) loopSpot(spotFor(app.sections, Math.min(app.spot.start, sec.start), Math.max(app.spot.end, sec.end)));
  else if (app.spot) loopSection(i); // while looping, picking a section moves the loop there
  else { player.seekBar(sec.start); if (!app.playing) showBar(sec.start); }
});
$('map').addEventListener('dblclick', (e) => { const c = e.target.closest('.sec'); if (c) loopSection(Number(c.dataset.i)); });

const showBar = (i) => player.scrollToBar(i, $('viewport'), $('sheet'));

function loopSection(i) {
  const sec = app.sections[i]; if (!sec) return;
  loopSpot(spotFor(app.sections, sec.start, sec.end));
  player.seekBar(sec.start);
  if (!app.playing) showBar(sec.start);
}

function stepSection(dir) {
  if (!app.sections.length) return;
  const cur = app.spot ? sectionAt(app.sections, app.spot.start) : Math.max(0, app.currentSection);
  const next = Math.max(0, Math.min(app.sections.length - 1, cur + dir));
  if (app.spot) loopSection(next);
  else { player.seekBar(app.sections[next].start); if (!app.playing) showBar(sec.start); }
}

// ---------- transport
function setSpeed(v, persist = true) {
  app.speed = Math.round(Math.max(0.25, Math.min(1.5, v)) * 100) / 100;
  if (api) api.playbackSpeed = app.speed;
  const pct = Math.round(app.speed * 100);
  $('sp-pct').textContent = `${pct}%`;
  $('sp-val').classList.toggle('changed', pct !== 100);
  $('sp-bpm').textContent = app.info?.tempo ? `${Math.round(app.info.tempo * app.speed)} bpm` : '';
  if (persist && app.songId) store.updateSong(app.songId, { speed: app.speed });
}

// The click must cut through: it's driven above unity and the band is ducked under it while it's on.
const CLICK_GAIN = 2.5, DUCK_UNDER_CLICK = 0.5;
function applyToggles() {
  const count = store.pref('countIn', true), click = store.pref('metronome', false);
  if (api) { api.countInVolume = count ? CLICK_GAIN : 0; api.metronomeVolume = click ? CLICK_GAIN : 0; }
  $('t-count').setAttribute('aria-pressed', String(count));
  $('t-click').setAttribute('aria-pressed', String(click));
  syncLoopMode();
  applyMix();
}
const toggleCount = () => { store.setPref('countIn', !store.pref('countIn', true)); applyToggles(); };
const toggleClick = () => { store.setPref('metronome', !store.pref('metronome', false)); applyToggles(); };

// ---------- play / pause, robustly
// Ask for exactly what the button shows (never toggle: a toggle flips the wrong way if alphaTab's state and ours
// ever disagree). If the song isn't ready yet (just opened, or re-built after a key change) the press is kept and
// playback starts the moment it is. If the audio doesn't actually start (iOS suspends it after sleep, calls or
// switching apps), wake it and try once more.
let wantPlay = false, startCheck = null, lastTick = -1;
function playPause() {
  if (!api || $('t-play').disabled) return;
  native.haptic();
  if (app.playing || wantPlay) { wantPlay = false; drawPlayWaiting(); api.pause(); return; }
  startPlayback();
}
function startPlayback(retry = false) {
  wakeAudio();
  if (!api.isReadyForPlayback || !app.ready.midi) { wantPlay = true; drawPlayWaiting(); return; } // still loading this song
  wantPlay = false; drawPlayWaiting();
  api.play();
  // Did sound actually start? The audio clock only runs while the device is producing sound (a count-in counts),
  // so check it rather than the playhead.
  clearTimeout(startCheck);
  const ctx = audioContext(), t0 = ctx?.currentTime ?? 0, from = lastTick;
  startCheck = setTimeout(() => {
    if (!app.playing) return;
    const running = ctx ? ctx.state === 'running' && ctx.currentTime - t0 > 0.4 : lastTick !== from;
    if (running) return;
    api.pause();
    if (!retry) setTimeout(() => startPlayback(true), 150);
    else toast('Sound didn’t start. Tap play again.');
  }, 1100);
}
const audioContext = () => { try { return api?.player?.output?.context ?? null; } catch { return null; } };
function wakeAudio() {
  try {
    const ctx = audioContext();
    if (ctx && ctx.state !== 'running') ctx.resume(); // inside the tap, so iOS allows it
    api.player?.output?.activate?.();
  } catch { /* not available */ }
}
function drawPlayWaiting() { $('t-play').classList.toggle('waiting', wantPlay); }
// Leaving the app pauses (iOS stops web audio in the background anyway), so the button never lies.
document.addEventListener('visibilitychange', () => { if (document.hidden && api && app.playing) api.pause(); });
$('t-play').onclick = playPause;
$('t-start').onclick = () => {
  if (app.spot) return player.seekBar(app.spot.start);
  const sec = app.sections[Math.max(0, app.currentSection)];
  if (sec) player.seekBar(sec.start);
};
$('sp-down').onclick = () => setSpeed(app.speed - 0.05);
$('sp-up').onclick = () => setSpeed(app.speed + 0.05);
$('sp-val').onclick = () => setSpeed(1);
$('t-loop').onclick = () => { native.haptic(); return app.spot ? closeSpot() : loopSection(Math.max(0, app.currentSection)); };
$('t-count').onclick = toggleCount;
$('t-click').onclick = toggleClick;

// ---------- mix: two faders, you and the band
const mixMe = () => store.pref('mixMe', 100);
const mixBand = () => store.pref('mixBand', 100);
function fill(el) { el.style.setProperty('--fill', `${el.value}%`); }
function drawMixControls() {
  for (const [id, v] of [['mix-me', mixMe()], ['mix-band', mixBand()]]) { $(id).value = v; fill($(id)); }
}
function applyMix() {
  if (!api?.score || !app.info) return;
  const mine = new Set(scoreTracks().map((t) => t.index));
  const silent = new Set(app.info.tracks.filter((t) => t.role === 'vocals' && t.loaded).map((t) => app.scoreIndexOf[t.index]));
  const duck = store.pref('metronome', false) ? DUCK_UNDER_CLICK : 1;
  player.applyMix((mixMe() / 100) * duck, (mixBand() / 100) * duck, mine, silent);
}
function onFader(e) {
  const el = e.target;
  if (el.id !== 'mix-me' && el.id !== 'mix-band') return;
  fill(el);
  store.setPref(el.id === 'mix-me' ? 'mixMe' : 'mixBand', Number(el.value));
  applyMix();
  // keep the inline faders and the popover faders in step
  for (const other of document.querySelectorAll(`input[data-mix="${el.id}"], #${el.id}`)) if (other !== el) { other.value = el.value; fill(other); }
}
document.addEventListener('input', onFader);
$('mix-btn').onclick = () => {
  popover($('mix-btn'), () => `
    <label class="fader"><span>You</span><input type="range" data-mix="mix-me" min="0" max="100" value="${mixMe()}" style="--fill:${mixMe()}%"></label>
    <label class="fader"><span>Band</span><input type="range" data-mix="mix-band" min="0" max="100" value="${mixBand()}" style="--fill:${mixBand()}%"></label>
    <div class="menu-sep"></div>
    <button class="menu-item" data-t="count"><span class="check">${store.pref('countIn', true) ? icon('check') : ''}</span>Count-in</button>
    <button class="menu-item" data-t="click"><span class="check">${store.pref('metronome', false) ? icon('check') : ''}</span>Click</button>
    ${$('t-retune').offsetParent ? '' : `<div class="menu-sep"></div><button class="menu-item" data-t="retune"><span class="check"></span><span class="grow">Retune</span><span class="meta">${esc($('t-retune').textContent.replace(/^Retune ?·? ?/, '') || 'Key and tuning')}</span></button>`}`, {
    align: 'end',
    onClick: (e, m) => {
      const inp = e.target.closest('input[data-mix]');
      if (inp && e.type === 'input') {
        store.setPref(inp.dataset.mix === 'mix-me' ? 'mixMe' : 'mixBand', Number(inp.value));
        fill(inp); $(inp.dataset.mix).value = inp.value; fill($(inp.dataset.mix)); applyMix();
        return;
      }
      const t = e.target.closest('[data-t]')?.dataset.t;
      if (t === 'count') { toggleCount(); m.redraw(); }
      if (t === 'click') { toggleClick(); m.redraw(); }
      if (t === 'retune') { m.close(); setTimeout(retuneMenu, 230); }
    },
  });
};

// ---------- part picker
$('part-btn').onclick = () => {
  popover($('part-btn'), () => `
    <div class="menu-label">Part</div>
    ${app.info.tracks.filter((t) => t.loaded).map((t) => {
      const tun = describeTuning(t.tuning, t.role);
      const odd = [tun && !tun.standard ? tun.name : null, t.capo ? `Capo ${t.capo}` : null].filter(Boolean).join(' · ');
      const on = app.selected.has(t.index);
      return `<button class="menu-item" data-pick="${t.index}">
        <span class="check">${on ? icon('check') : ''}</span>
        <span class="stack grow"><span>${esc(t.part)}</span>${odd ? `<span class="meta warn">${esc(odd)}</span>` : ''}</span>
        ${on && app.selected.size === 1 ? '' : `<span class="btn icon ghost sm also" data-also="${t.index}" role="button" aria-pressed="${on}" title="${on ? 'Hide' : 'Show alongside'}">${icon(on ? 'minus' : 'plus')}</span>`}
      </button>`;
    }).join('')}`, {
    onClick: (e, m) => {
      const also = e.target.closest('[data-also]');
      const pick = e.target.closest('[data-pick]');
      if (!pick) return;
      const i = Number(pick.dataset.pick);
      if (also) {
        e.stopPropagation();
        if (app.selected.has(i)) { if (app.selected.size > 1) app.selected.delete(i); } else app.selected.add(i);
        changeParts(); m.redraw();
      } else {
        app.selected = new Set([i]);
        changeParts(); m.close();
      }
    },
  });
};
function changeParts() {
  rememberPart();
  applyRetune();
  applyMix();
}

// ---------- view menu
const VIEWS = [['tab', 'Tab'], ['both', 'Tab + staff'], ['notation', 'Staff']];
$('view-btn').onclick = () => {
  popover($('view-btn'), () => {
    const v = yourView(), dark = sheetDark();
    const seg = (name, items, cur) => `<div class="seg" role="radiogroup">${items.map(([k, label]) => `<button role="radio" data-${name}="${k}" aria-checked="${k === cur}">${label}</button>`).join('')}</div>`;
    return `
      <div class="menu-row"><span>Theme</span>${seg('theme', THEMES, themeName())}</div>
      <div class="menu-row"><span>Notation</span>${seg('view', VIEWS, v)}</div>
      <div class="menu-row"><span>Size</span><div class="stepper">
        <button class="btn icon ghost" data-zoom="-0.1" aria-label="Smaller">${icon('minus')}</button>
        <span class="tempo" style="min-width:48px">${Math.round(zoomLevel() * 100)}%</span>
        <button class="btn icon ghost" data-zoom="0.1" aria-label="Larger">${icon('plus')}</button></div></div>
      <div class="menu-row"><span>Sheet</span>${seg('sheet', [['light', 'Light'], ['dark', 'Dark']], dark ? 'dark' : 'light')}</div>
      <div class="menu-row"><span>Lyrics</span>${seg('lyrics', [['on', 'Show'], ['off', 'Hide']], lyricsOn() ? 'on' : 'off')}</div>
      <div class="menu-row"><span>String names</span>${seg('strings', [['on', 'Show'], ['off', 'Hide']], store.pref('stringNames', true) ? 'on' : 'off')}</div>`;
  }, {
    align: 'end',
    onClick: (e, m) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.view) { store.setPref(`view:${roleOfMain()}`, b.dataset.view); rerender(); }
      if (b.dataset.zoom) zoom(Number(b.dataset.zoom));
      if (b.dataset.sheet) { store.setDevice('sheet', b.dataset.sheet); applySheet(); }
      if (b.dataset.theme) { store.setDevice('theme', b.dataset.theme); applySheet(); }
      if (b.dataset.lyrics) { store.setPref('lyrics', b.dataset.lyrics === 'on'); applyLyricsSetting(); rerender(); }
      if (b.dataset.strings) { store.setPref('stringNames', b.dataset.strings === 'on'); drawLabels(); }
      m.redraw();
    },
  });
};
/** Paper color + alphaTab colors/fonts/line weights for the current theme; dark sheets are drawn natively. */
async function applySheet() {
  const t = theme();
  document.documentElement.style.setProperty('--paper', t.paper);
  document.documentElement.style.setProperty('--label-ink', t.soft);
  if (!api) return;
  await loadThemeFonts(themeName());
  rerender(() => player.updateDisplay({ theme: t.settings, scale: effectiveScale() }));
}
function zoom(d) {
  const z = Math.round(Math.max(0.5, Math.min(2, zoomLevel() + d)) * 100) / 100;
  store.setDevice('zoom', z);
  rerender(() => player.updateDisplay({ scale: effectiveScale() }));
}
$('viewport').addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 0.05 : -0.05); } }, { passive: false });

function rerender(draw = () => player.render(scoreTracks(), yourView())) {
  // alphaTab tries to redraw a stale selection against the new layout; drop it and redraw after (postRenderFinished).
  if (app.spot) api.clearPlaybackRangeHighlight();
  draw();
}

// ---------- retune: song key (per song) + how your instrument is tuned (per player, persists across songs)
const songShift = () => (app.songId ? store.song(app.songId).shift ?? 0 : 0);
const tuningChoice = () => store.pref(`tuning:${roleOfMain()}`, null); // null = tuned like the tab
// Default: re-finger to real frets. A capo is only added on request (moving a capo the tab already uses is automatic).
const allowCapo = () => store.pref('allowCapo', false);
const isStringed = (t) => t && !t.staves[0]?.isPercussion && t.staves[0]?.tuning?.length;
app.retuneStats = null;

/** Re-finger your part(s) for the current key + tuning; everything else is transposed in playback. */
function applyRetune({ render = true } = {}) {
  if (!api?.score || !app.info) return;
  const k = songShift(), choice = tuningChoice(), role = roleOfMain();
  const mine = new Set(scoreTracks().filter((t) => isStringed(t) && app.info.tracks[app.scoreIndexOf.indexOf(t.index)]?.role === role).map((t) => t.index));
  let stats = null;
  for (const t of api.score.tracks) {
    if (!isStringed(t)) continue;
    const staff = t.staves[0];
    if (mine.has(t.index)) {
      const written = staff._origTuning ?? staff.tuning;
      const target = retune.tuningFor(choice, role, written.length) ?? written.map((p) => p + k);
      const s = retune.refret(staff, k, target, { allowCapo: allowCapo() });
      stats = stats ? { ...s, moved: stats.moved + s.moved, octave: stats.octave + s.octave, dropped: stats.dropped + s.dropped, total: stats.total + s.total } : s;
    } else retune.restore(staff);
  }
  app.retuneStats = stats;
  app.retuned = mine;
  $('t-retune').setAttribute('aria-pressed', String(!!(k || choice)));
  // e.g. "Retune · D std · −2"
  const short = choice ? (retune.tuningOptions(role, (api.score.tracks[[...mine][0]]?.staves[0]?._origTuning ?? []).length).find((o) => o.key === choice)?.label ?? '').replace(' standard', ' std') : '';
  $('t-retune').textContent = ['Retune', short, k ? `${k > 0 ? '+' : '−'}${Math.abs(k)}` : ''].filter(Boolean).join(' · ');
  drawHeader();
  if (render) {
    rerender();
    api.loadMidiForScore(); // re-fingered notes change pitch; midiLoaded then re-applies mix + transposition
  }
}

/** Parts you're not reading follow the key change in playback only. */
function applyTransposition() {
  if (!api?.score) return;
  const k = songShift();
  for (const t of api.score.tracks) {
    if (t.staves[0]?.isPercussion) continue;
    api.changeTrackTranspositionPitch([t], app.retuned?.has(t.index) ? 0 : k);
  }
}

function retuneMenu() {
  if (!app.info) return;
  const role = roleOfMain();
  const t = scoreTracks()[0];
  const strings = t?.staves[0]?._origTuning?.length ?? t?.staves[0]?.tuning?.length ?? 6;
  const opts = retune.tuningOptions(role, strings);
  const inst = role === 'bass' ? 'bass' : 'guitar';
  // On phones the Retune button lives in the mix menu, so open from whichever control is on screen.
  const anchor = $('t-retune').offsetParent ? $('t-retune') : $('mix-btn');
  popover(anchor, () => {
    const k = songShift(), choice = tuningChoice(), st = app.retuneStats;
    const staff = t?.staves[0];
    const tun = staff ? describeTuning([...staff.tuning], role) : null;
    const tunName = tun ? (tun.standard ? 'standard tuning' : tun.name) : 'the tab’s tuning';
    const sound = k ? `${Math.abs(k)} semitone${Math.abs(k) === 1 ? '' : 's'} ${k < 0 ? 'lower' : 'higher'}` : 'the original key';
    const summary = choice
      ? `Frets are for your ${inst} in ${tunName}${staff?.capo ? ` with capo ${staff.capo}` : ''}, sounding in ${sound}.`
      : `Tune your ${inst} to ${tunName}${staff?.capo ? `, capo ${staff.capo}` : ''}; the frets stay as written and it sounds in ${sound}.`;
    const lines = [];
    if (st && (st.moved || st.octave || st.dropped)) {
      lines.push(`Re-fingered ${st.moved} note${st.moved === 1 ? '' : 's'}${st.octave ? ` · ${st.octave} moved an octave` : ''}${st.dropped ? ` · ${st.dropped} doubled note${st.dropped === 1 ? '' : 's'} left out` : ''}.`);
      if ((st.octave + st.dropped) / Math.max(1, st.total) > 0.03 && staff?._origTuning) {
        const ideal = describeTuning(staff._origTuning.map((p) => p + k), role);
        if (ideal) lines.push(`In ${ideal.standard ? 'standard' : ideal.name} it would play exactly as written.`);
      }
    }
    const kLabel = k ? `${Math.abs(k)} ${k < 0 ? 'lower' : 'higher'}` : 'Original key';
    return `
      <div class="menu-row"><span>My ${inst} is tuned to</span>
        <select class="mini-select" id="rt-tuning" aria-label="How your ${inst} is tuned">
          <option value="" ${!choice ? 'selected' : ''}>Whatever the tab needs</option>
          ${opts.map((o) => `<option value="${o.key}" ${o.key === choice ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select></div>
      <div class="menu-row"><span>The song should sound</span><div class="stepper">
        <button class="btn icon ghost" data-k="-1" aria-label="A semitone lower">${icon('minus')}</button>
        <span class="tempo" style="min-width:96px"><span>${kLabel}</span></span>
        <button class="btn icon ghost" data-k="1" aria-label="A semitone higher">${icon('plus')}</button></div></div>
      <div class="menu-sep"></div>
      <div class="note">${esc(summary)}</div>
      ${lines.map((l) => `<div class="note" style="padding-top:0">${esc(l)}</div>`).join('')}
      ${choice ? `<label class="menu-row" style="cursor:pointer"><span>Use a capo instead when it keeps the shapes</span><input type="checkbox" class="switch" id="rt-capo" ${allowCapo() ? 'checked' : ''}></label>` : ''}
      ${k || choice ? `<div class="menu-sep"></div><button class="menu-item" data-reset><span class="check"></span>Back to the original</button>` : ''}`;
  }, {
    align: 'end',
    className: 'retune-menu',
    onClick: (e, m) => {
      const kb = e.target.closest('[data-k]');
      if (kb && e.type === 'click') {
        const k = Math.max(-12, Math.min(12, songShift() + Number(kb.dataset.k)));
        store.updateSong(app.songId, { shift: k });
        applyRetune(); m.redraw(); return;
      }
      if (e.target.id === 'rt-tuning' && e.type === 'input') { store.setPref(`tuning:${roleOfMain()}`, e.target.value || null); applyRetune(); m.redraw(); return; }
      if (e.target.id === 'rt-capo' && e.type === 'input') { store.setPref('allowCapo', e.target.checked); applyRetune(); m.redraw(); return; }
      if (e.target.closest('[data-reset]')) { store.updateSong(app.songId, { shift: 0 }); store.setPref(`tuning:${roleOfMain()}`, null); applyRetune(); m.redraw(); }
    },
  });
}
$('t-retune').onclick = retuneMenu;

// ---------- lyrics + string names
const lyricsOn = () => store.pref('lyrics', true);
function applyLyricsSetting() { player.setElement('EffectLyrics', lyricsOn()); }
const drawLabels = () => {
  const v = yourView();
  // Drum staves can't be tab; mirror player.render's fallback so the overlay matches what's drawn.
  const shown = v === 'tab' && scoreTracks().some((t) => t.staves[0]?.isPercussion) ? 'both' : v;
  player.drawStringLabels($('sheet'), store.pref('stringNames', true) && shown !== 'notation', shown);
};

// ---------- song switcher: tap the title to jump to another song without leaving
function switchSong() {
  if (!app.info) return;
  openSwitcher($('song-switch'), {
    currentId: app.songId,
    setId: app.setId,
    onPick: (id) => {
      const l = app.setId && bandApi.setlist(app.setId);
      navigate(l && l.songIds.includes(id) ? `song=${id}&set=${l.id}` : `song=${id}`);
    },
  });
}
$('song-switch').onclick = switchSong;

// ---------- more menu
$('more-btn').onclick = () => {
  $('more-btn')._song = { songId: app.songId, title: app.info.title, artist: app.info.artist };
  library.songMenu($('more-btn'), app.songId, `
    <div class="menu-sep"></div>
    <button class="menu-item" data-download="gp"><span class="check"></span>Download Guitar Pro file</button>
    <button class="menu-item" data-download="raw"><span class="check"></span>Download raw JSON</button>`);
};
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-download]');
  if (!b || !app.songId) return;
  closePopover();
  const { info, gp, meta, parts } = await songs.build(app.songId);
  const base = `${info.artist} - ${info.title}`;
  if (b.dataset.download === 'gp') songs.download(`${base}.gp`, gp);
  else songs.download(`${info.songId}-raw.json`, JSON.stringify({ meta, parts }), 'application/json');
});
// The library's song menu reads anchor._song for songs that aren't in the library yet.
bandApi.onChange(() => { if (app.info) { drawHeader(); drawSetNav(); } });

// ---------- stage mode (band play): fullscreen, screen awake, only the music and navigation
let wakeLock = null;
async function toggleStage(on = !document.body.classList.contains('stage')) {
  document.body.classList.toggle('stage', on);
  $('stage-btn').innerHTML = icon(on ? 'shrink' : 'expand');
  try {
    if (on) { await document.documentElement.requestFullscreen?.(); wakeLock = await navigator.wakeLock?.request('screen'); }
    else { if (document.fullscreenElement) await document.exitFullscreen(); await wakeLock?.release(); wakeLock = null; }
  } catch { /* not supported or not allowed */ }
}
$('stage-btn').onclick = () => toggleStage();
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && document.body.classList.contains('stage')) toggleStage(false); });

// ---------- keyboard (and page-turner pedals, which send PageDown/PageUp)
document.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || document.querySelector('dialog[open]')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape') {
    if (popoverOpen()) return closePopover();
    if (document.body.classList.contains('stage')) return toggleStage(false);
    if (app.spot) return closeSpot();
    return;
  }
  if (e.key === '/') { e.preventDefault(); if (document.body.dataset.screen !== 'library') navigate(''); setTimeout(() => $('q').focus()); return; }
  if (document.body.dataset.screen !== 'song') return;
  const vp = $('viewport');
  const actions = {
    ' ': playPause,
    ArrowLeft: () => stepSection(-1),
    ArrowRight: () => stepSection(1),
    PageDown: () => vp.scrollBy({ top: vp.clientHeight * 0.8, behavior: 'smooth' }),
    PageUp: () => vp.scrollBy({ top: -vp.clientHeight * 0.8, behavior: 'smooth' }),
    l: () => $('t-loop').click(),
    '[': () => setSpeed(app.speed - 0.05),
    ']': () => setSpeed(app.speed + 0.05),
    a: () => practice.missed(),
    c: toggleCount,
    m: toggleClick,
    n: () => stepSet(1),
    p: () => stepSet(-1),
    f: () => toggleStage(),
    s: switchSong,
    r: retuneMenu,
  };
  const fn = actions[e.key] ?? actions[e.key.toLowerCase()];
  if (fn) { e.preventDefault(); fn(); }
});

// ---------- iOS audio: Web Audio is "ambient" by default, so Silent Mode mutes it. Ask for the playback audio
// session (Safari 17+), or on older iOS start a silent looping <audio> element, which switches the session the same way.
function unlockAudio() {
  try { if (navigator.audioSession) { navigator.audioSession.type = 'playback'; return; } } catch { /* ignore */ }
  if (unlockAudio.el) return;
  const rate = 8000, samples = 800, buf = new ArrayBuffer(44 + samples * 2), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + samples * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, samples * 2, true);
  const el = new Audio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })));
  el.loop = true; el.setAttribute('playsinline', '');
  el.play().catch(() => {});
  unlockAudio.el = el;
}
['pointerdown', 'keydown', 'touchend'].forEach((ev) => document.addEventListener(ev, unlockAudio, { capture: true, passive: true }));

// ---------- touch: faders you can grab anywhere, and pinch to resize the sheet
// iOS range inputs only move when you hit the thumb exactly. On touch, set the value from wherever the finger is.
document.addEventListener('pointerdown', (e) => {
  const input = e.target.closest?.('input[type="range"]');
  if (!input || e.pointerType === 'mouse') return;
  e.preventDefault();
  const set = (ev) => {
    const r = input.getBoundingClientRect(), thumb = 14;
    const f = Math.min(1, Math.max(0, (ev.clientX - r.left - thumb) / (r.width - thumb * 2)));
    const min = Number(input.min || 0), max = Number(input.max || 100), step = Number(input.step || 1);
    const v = Math.round((min + f * (max - min)) / step) * step;
    if (String(v) !== input.value) { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); }
  };
  set(e);
  input.setPointerCapture?.(e.pointerId);
  const move = (ev) => set(ev);
  const up = () => { input.removeEventListener('pointermove', move); input.dispatchEvent(new Event('change', { bubbles: true })); };
  input.addEventListener('pointermove', move);
  input.addEventListener('pointerup', up, { once: true });
  input.addEventListener('pointercancel', up, { once: true });
}, { capture: true });

// Pinch on the sheet changes the sheet size (re-laid out crisply) instead of zooming the whole page.
// Safari sends gesture* events; elsewhere pinch is ctrl+wheel (handled above). Page-level pinch zoom is blocked
// because it scales the toolbars too and leaves the app half off-screen.
let pinchBase = null;
document.addEventListener('gesturestart', (e) => {
  e.preventDefault();
  if (document.body.dataset.screen === 'song' && e.target.closest?.('#viewport')) pinchBase = zoomLevel();
}, { passive: false });
document.addEventListener('gesturechange', (e) => {
  e.preventDefault();
  if (pinchBase != null) $('sheet').style.transform = `scale(${Math.max(0.5, Math.min(2.5, e.scale))})`;
}, { passive: false });
document.addEventListener('gestureend', (e) => {
  e.preventDefault();
  if (pinchBase == null) return;
  $('sheet').style.transform = '';
  const z = Math.round(Math.max(0.5, Math.min(2, pinchBase * e.scale)) * 20) / 20;
  pinchBase = null;
  if (z !== zoomLevel()) zoom(z - zoomLevel());
}, { passive: false });

// ================= boot =================
await store.init();
await loadThemeFonts(themeName());
applySheet();
drawWho();
library.init({ navigate, sessionPage: sessionUi.pageHtml, mePage });
sessionUi.init({ navigate });
session.boot();
native.registerOffline();
addEventListener('hashchange', route);
route();
if (!store.profile()) whoDialog({ required: true });
