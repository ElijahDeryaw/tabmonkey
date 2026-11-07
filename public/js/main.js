// App glue: routing, song loading, transport, sections, drawer, keyboard, stage mode.
import * as store from './store.js';
import * as player from './player.js';
import * as practice from './practice.js';
import * as home from './home.js';
import { esc } from './home.js';
import { INSTRUMENTS, pickTrack, describeTuning } from './instruments.js';
import { buildSections, sectionAt, spotFor } from './sections.js';

const $ = (id) => document.getElementById(id);
const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const DEFAULT_VIEW = { guitar: 'tab', bass: 'tab', drums: 'notation', vocals: 'notation', keys: 'notation', other: 'both' };
const MODES = ['full', 'along', 'solo'];

const app = {
  info: null, songId: null, sections: [], selected: new Set(), scoreIndexOf: [],
  spot: null, speed: 1, mode: 'full', playing: false, ready: { render: false, midi: false }, resumed: false,
  currentSection: -1, prevTick: 0,
};
let api = null;

// ---------- toast
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- profile
function drawProfileChip() {
  const p = store.profile();
  const inst = INSTRUMENTS.find((i) => i.id === p?.instrument);
  $('profile-btn').innerHTML = p ? `<span class="av">${esc(p.name[0].toUpperCase())}</span><span class="nm">${esc(p.name)} · ${inst?.label ?? ''}</span>` : 'Who are you?';
}

function openProfile(first = false) {
  const p = store.profile();
  let inst = p?.instrument ?? 'guitar';
  $('p-name').value = p?.name ?? '';
  const names = store.profileNames();
  $('profile-list').innerHTML = names.length > 1 || (names.length && !p)
    ? names.map((n) => `<button type="button" data-p="${esc(n)}" class="${n === p?.name ? 'on' : ''}">${esc(n)}</button>`).join('') : '';
  const drawInst = () => { $('p-inst').innerHTML = INSTRUMENTS.map((i) => `<button type="button" data-i="${i.id}" class="${i.id === inst ? 'on' : ''}"><span>${i.icon}</span>${i.label}</button>`).join(''); };
  drawInst();
  $('p-inst').onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) { inst = b.dataset.i; drawInst(); } };
  $('profile-list').onclick = (e) => {
    const b = e.target.closest('[data-p]'); if (!b) return;
    store.setProfile(b.dataset.p); $('profile-dlg').close(); afterProfileChange();
  };
  $('profile-form').onsubmit = (e) => {
    const name = $('p-name').value.trim();
    if (!name) { e.preventDefault(); return; }
    store.setProfile(name, inst);
    afterProfileChange();
  };
  $('profile-dlg').oncancel = (e) => { if (first) e.preventDefault(); };
  $('profile-dlg').showModal();
  if (!p) $('p-name').focus();
}

function afterProfileChange() {
  drawProfileChip();
  if (app.info) openSong(app.songId, { keepTrack: false }); else home.render();
}

// ---------- routing
function showHome() {
  stopPlayback();
  document.body.dataset.view = 'home';
  document.title = 'Tabs';
  history.replaceState(null, '', location.pathname);
  app.info = null; app.songId = null;
  home.render();
}

function stopPlayback() { if (api && app.playing) api.stop(); }

// ---------- song loading
async function openSong(id, { keepTrack = true } = {}) {
  stopPlayback();
  document.body.dataset.view = 'song';
  loading('Fetching tabs…');
  closeSpot(false);
  let info;
  try {
    const res = await fetch('/api/song/' + id);
    info = await res.json();
    if (!res.ok) throw new Error(info.error);
  } catch (e) {
    loading(null);
    toast('Could not load that song: ' + e.message);
    if (!app.info) showHome();
    return;
  }
  const s = store.song(id);
  const role = store.profile()?.instrument;
  app.info = info; app.songId = id; app.resumed = false;
  app.ready = { render: false, midi: false };
  let n = 0; app.scoreIndexOf = info.tracks.map((t) => (t.loaded ? n++ : -1));
  const track = pickTrack(info, role, keepTrack ? s.track : null);
  app.selected = new Set([track]);
  app.mode = store.pref('bandMode', 'full');
  store.updateSong(id, { title: info.title, artist: info.artist, opened: Date.now(), track, sectionCount: info.sections || undefined });

  document.title = `${info.title} · ${info.artist}`;
  $('song-title').querySelector('.st-t').textContent = info.title;
  $('song-title').querySelector('.st-a').textContent = info.artist;
  $('dl-gp').href = `/api/song/${id}/score.gp?download=1`;
  $('dl-json').href = `/api/song/${id}/raw.json`;
  history.replaceState(null, '', `#song=${id}`);
  drawPart(); drawTracks(); drawModes(); drawView();
  if (info.missing.length) toast(`${info.missing.length} track(s) couldn't be fetched`);

  if (!api) createApi();
  loading('Drawing the music…');
  api.load(`/api/song/${id}/score.gp`);
}

function loading(msg) { $('loading').hidden = !msg; if (msg) $('loading-msg').textContent = msg; }

const yourView = () => store.pref(`view:${roleOfSelected()}`, DEFAULT_VIEW[roleOfSelected()] ?? 'tab');
const roleOfSelected = () => app.info?.tracks[[...app.selected][0]]?.role ?? 'other';
const scoreTracks = () => [...app.selected].sort((a, b) => a - b).map((i) => api?.score?.tracks[app.scoreIndexOf[i]]).filter(Boolean);
const mineSet = () => new Set(scoreTracks().map((t) => t.index));

function autoZoom() {
  const w = window.innerWidth;
  return w < 500 ? 0.8 : w < 900 ? 0.95 : w > 1600 ? 1.15 : 1.05;
}

function createApi() {
  api = player.create($('sheet'), $('viewport'), { scale: store.device('zoom', autoZoom()), layout: store.device('layout', 'Page'), view: yourView() });
  window.tabApi = api; // handy for debugging from the console
  api.scoreLoaded.on((score) => {
    // Guitar Pro stores key signatures per master bar, so drum staves inherit the song key on import; drums have none.
    for (const t of score.tracks) for (const st of t.staves) if (st.isPercussion) for (const b of st.bars) b.keySignature = 0;
    app.sections = buildSections(score);
    drawSections();
    player.render(scoreTracks(), yourView());
  });
  api.renderFinished.on(() => loading(null));
  // Layout bounds exist only after this: resume the last loop, or redraw its highlight for the new layout.
  api.postRenderFinished.on(() => {
    if (!app.ready.render) { app.ready.render = true; maybeResume(); }
    else if (app.spot) player.highlightBars(app.spot.start, app.spot.end);
  });
  api.midiLoaded.on(() => { app.ready.midi = true; applyMix(); maybeResume(); });
  api.error.on((e) => { loading(null); toast('Render error: ' + (e.message || e)); console.error(e); });
  api.soundFontLoad.on((e) => {
    $('sf-status').hidden = false;
    $('sf-status').querySelector('i').style.width = `${Math.round((e.loaded / (e.total || 1)) * 100)}%`;
  });
  api.playerReady.on(() => { $('sf-status').hidden = true; $('t-play').disabled = false; applyMix(); applyToggles(); });
  api.soundFontLoadFailed?.on(() => toast('Could not load the instrument sounds'));
  api.playerStateChanged.on((e) => {
    app.playing = e.state === 1;
    $('t-play').textContent = app.playing ? '❚❚' : '▶';
    $('t-play').classList.toggle('playing', app.playing);
    $('t-play').setAttribute('aria-label', app.playing ? 'Pause' : 'Play');
  });
  api.playerPositionChanged.on(onPosition);
  api.playbackRangeChanged.on((e) => onRange(e.playbackRange));
  api.playerFinished.on(onFinished);
  player.enableTouchSelect($('sheet'));
}

function maybeResume() {
  if (app.resumed || !app.ready.render || !app.ready.midi) return;
  app.resumed = true;
  const s = store.song(app.songId);
  setSpeed(s.speed ?? 1, false);
  const spot = s.lastSpot?.key ? s.lastSpot : null;
  if (spot && spot.end < player.barCount()) {
    const best = s.spots[spot.key]?.best;
    loopSpot({ key: spot.key, label: spot.label, start: spot.start, end: spot.end });
    player.seekBar(spot.start);
    setTimeout(() => api.scrollToCursor(), 50);
    toast(`Picking up at ${spot.label}${best ? `, best ${best}%` : ''}`);
  } else {
    const t = app.info.tracks[[...app.selected][0]];
    const tun = describeTuning(t?.tuning, t?.role);
    toast(`Your part: ${t?.part}${tun && !tun.standard ? ` · ${tun.name}` : ''}${t?.capo ? ` · capo ${t.capo}` : ''}`);
  }
}

// ---------- playback position → time, current section, loop passes
function onPosition(e) {
  $('t-time').textContent = `${fmt(e.currentTime)} / ${fmt(e.endTime)}`;
  const idx = sectionAt(app.sections, player.barAt(e.currentTick));
  if (idx !== app.currentSection) {
    app.currentSection = idx;
    document.querySelectorAll('.chip').forEach((c, i) => c.classList.toggle('now', i === idx));
    $('sections').children[idx]?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }
}

// End of a pass through the loop. Without count-in alphaTab loops seamlessly by itself; with count-in we restart
// playback ourselves, because alphaTab only counts in when playback starts.
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

/** Seamless looping, unless count-in is on: then every pass gets its own count-in. */
function syncLoopMode() { if (api) api.isLooping = !!app.spot && !store.pref('countIn', true); }

// alphaTab tells us whenever the loop range changes, from our code or from dragging across the sheet.
function onRange(range) {
  if (!range) { if (app.spot) closeSpot(false); return; }
  const start = player.barAt(range.startTick), end = player.barAt(Math.max(range.startTick, range.endTick - 1));
  const spot = spotFor(app.sections, start, end);
  if (app.spot?.key === spot.key) return;
  setSpot(spot);
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
    onProgress: drawSectionMeters,
    toast,
  });
  syncLoopMode();
  drawLoopState();
}

/** byUser: you closed the loop on purpose, so forget it for next time. Otherwise just reset the UI. */
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
  $('t-loop').classList.toggle('on', !!app.spot);
  const s = app.spot;
  document.querySelectorAll('.chip').forEach((c) => {
    const sec = app.sections[Number(c.dataset.i)];
    c.classList.toggle('loop', !!s && sec.start >= s.start && sec.end <= s.end);
  });
}

// ---------- sections strip
function drawSections() {
  $('sections').innerHTML = app.sections.map((s, i) => `<button class="chip" data-i="${i}" title="Tap: jump · Double-tap or hold: loop · Shift-click: loop a range">${esc(s.label)}<span class="m"></span></button>`).join('');
  app.currentSection = -1;
  drawSectionMeters(); drawLoopState();
}

function drawSectionMeters() {
  const spots = store.song(app.songId).spots;
  document.querySelectorAll('.chip').forEach((c) => {
    const best = spots[app.sections[Number(c.dataset.i)].key]?.best || 0;
    c.querySelector('.m').style.width = `${Math.min(100, best)}%`;
  });
}

let holdTimer = null, held = false;
$('sections').addEventListener('pointerdown', (e) => {
  const c = e.target.closest('.chip'); if (!c) return;
  held = false;
  holdTimer = setTimeout(() => { held = true; navigator.vibrate?.(15); loopSection(Number(c.dataset.i)); }, 450);
});
['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => $('sections').addEventListener(ev, () => clearTimeout(holdTimer)));
$('sections').addEventListener('click', (e) => {
  const c = e.target.closest('.chip'); if (!c || held) return;
  const i = Number(c.dataset.i), sec = app.sections[i];
  if (e.shiftKey && app.spot) {
    loopSpot(spotFor(app.sections, Math.min(app.spot.start, sec.start), Math.max(app.spot.end, sec.end)));
  } else if (app.spot) {
    loopSection(i); // while practicing, tapping another section moves the loop there
  } else {
    player.seekBar(sec.start);
    if (!app.playing) setTimeout(() => api.scrollToCursor(), 50);
  }
});
$('sections').addEventListener('dblclick', (e) => { const c = e.target.closest('.chip'); if (c) loopSection(Number(c.dataset.i)); });

function loopSection(i) {
  const sec = app.sections[i]; if (!sec) return;
  loopSpot(spotFor(app.sections, sec.start, sec.end));
  player.seekBar(sec.start);
  if (!app.playing) setTimeout(() => api.scrollToCursor(), 50); // show the section even before you press play
}

function stepSection(dir) {
  if (!app.sections.length) return;
  const cur = app.spot ? sectionAt(app.sections, app.spot.start) : Math.max(0, app.currentSection);
  const next = Math.max(0, Math.min(app.sections.length - 1, cur + dir));
  if (app.spot) loopSection(next); else player.seekBar(app.sections[next].start);
}

// ---------- transport
function setSpeed(v, persist = true) {
  app.speed = Math.round(Math.max(0.25, Math.min(1.5, v)) * 100) / 100;
  if (api) api.playbackSpeed = app.speed;
  const pct = Math.round(app.speed * 100);
  $('sp-val').querySelector('b').textContent = `${pct}%`;
  $('sp-val').classList.toggle('slow', pct !== 100);
  $('sp-bpm').textContent = app.info?.tempo ? `${Math.round(app.info.tempo * app.speed)} bpm` : '';
  if (persist && app.songId) store.updateSong(app.songId, { speed: app.speed });
}

function applyToggles() {
  const count = store.pref('countIn', true), metro = store.pref('metronome', false);
  if (api) { api.countInVolume = count ? 1 : 0; api.metronomeVolume = metro ? 1 : 0; }
  $('t-count').classList.toggle('on', count);
  syncLoopMode();
  $('t-metro').classList.toggle('on', metro);
}

function playPause() { if (api && !$('t-play').disabled) api.playPause(); }

$('t-play').onclick = playPause;
$('t-back').onclick = () => {
  if (app.spot) return player.seekBar(app.spot.start);
  const sec = app.sections[Math.max(0, app.currentSection)];
  if (sec) player.seekBar(sec.start);
};
$('sp-down').onclick = () => setSpeed(app.speed - 0.05);
$('sp-up').onclick = () => setSpeed(app.speed + 0.05);
$('sp-val').onclick = () => setSpeed(1);
$('t-loop').onclick = () => (app.spot ? closeSpot() : loopSection(Math.max(0, app.currentSection)));
$('t-count').onclick = () => { store.setPref('countIn', !store.pref('countIn', true)); applyToggles(); };
$('t-metro').onclick = () => { store.setPref('metronome', !store.pref('metronome', false)); applyToggles(); };

// ---------- band mode + mix
function drawModes() { document.querySelectorAll('#band-mode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === app.mode)); }
function setMode(m) {
  app.mode = m; store.setPref('bandMode', m); drawModes(); applyMix();
  toast({ full: 'Full band', along: 'Play along: your part is muted', solo: 'Just your part' }[m]);
}
$('band-mode').onclick = (e) => { const b = e.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode); };

/** Song mix in Songsterr track indexes; vocals start muted (they're a guide melody) unless you sing. */
function mixFor(i) {
  const m = store.song(app.songId).mix[i] || {};
  const t = app.info.tracks[i];
  const vocalDefault = t.role === 'vocals' && store.profile()?.instrument !== 'vocals';
  return { vol: m.vol ?? 1, mute: m.mute ?? vocalDefault };
}
function applyMix() {
  if (!api?.score || !app.info) return;
  const mixer = {};
  app.info.tracks.forEach((t, i) => { if (app.scoreIndexOf[i] >= 0) mixer[app.scoreIndexOf[i]] = mixFor(i); });
  player.applyMix(app.mode, mixer, mineSet());
}

// ---------- header part + drawer
function drawPart() {
  const t = app.info.tracks[[...app.selected][0]];
  const tun = describeTuning(t.tuning, t.role);
  const more = app.selected.size > 1 ? ` +${app.selected.size - 1}` : '';
  $('st-part').innerHTML = `<span>${esc(t.part)}${more}</span><span>${tun ? `<span class="badge ${tun.standard ? '' : 'warn'}" title="${esc(tun.notes)}">${esc(tun.name)}</span>` : ''}${t.capo ? ` <span class="badge warn">Capo ${t.capo}</span>` : ''}</span>`;
}

function drawTracks() {
  const info = app.info;
  $('tracks').innerHTML = info.tracks.map((t) => {
    const tun = describeTuning(t.tuning, t.role);
    const m = mixFor(t.index);
    return `<div class="trk ${app.selected.has(t.index) ? 'on' : ''} ${t.loaded ? '' : 'off'}">
      <button class="trk-pick" data-i="${t.index}" ${t.loaded ? '' : 'disabled'}>
        <span class="n">${esc(t.part)}${app.selected.has(t.index) ? ' · yours' : ''}</span>
        <span class="b">${t.loaded ? '' : '<span class="badge">unavailable</span>'}${tun && !tun.standard ? `<span class="badge warn" title="${esc(tun.notes)}">${esc(tun.name)}</span>` : ''}${t.capo ? `<span class="badge warn">Capo ${t.capo}</span>` : ''}${t.role === 'vocals' ? '<span class="badge">guide melody</span>' : t.role === 'drums' ? '' : `<span class="badge">${esc(t.instrument)}</span>`}</span>
      </button>
      ${t.loaded ? `<div class="trk-mix"><input type="range" min="0" max="1.5" step="0.05" value="${m.vol}" data-vol="${t.index}" aria-label="${esc(t.part)} volume">
        <button class="mute ${m.mute ? 'on' : ''}" data-mute="${t.index}" title="${m.mute ? 'Unmute' : 'Mute'}" aria-label="Mute ${esc(t.part)}">${m.mute ? '🔇' : '🔊'}</button></div>` : ''}
    </div>`;
  }).join('');
}

let trkHold = null, trkHeld = false;
$('tracks').addEventListener('pointerdown', (e) => {
  const b = e.target.closest('.trk-pick'); if (!b) return;
  trkHeld = false;
  trkHold = setTimeout(() => { trkHeld = true; navigator.vibrate?.(15); pickTrackUI(Number(b.dataset.i), true); }, 450);
});
['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => $('tracks').addEventListener(ev, () => clearTimeout(trkHold)));
$('tracks').addEventListener('click', (e) => {
  const b = e.target.closest('.trk-pick');
  if (b && !b.disabled && !trkHeld) pickTrackUI(Number(b.dataset.i), e.ctrlKey || e.metaKey || e.shiftKey);
  const mu = e.target.closest('[data-mute]');
  if (mu) {
    const i = Number(mu.dataset.mute), m = mixFor(i);
    store.song(app.songId).mix[i] = { ...m, mute: !m.mute };
    store.updateSong(app.songId, {});
    applyMix(); drawTracks();
  }
});
$('tracks').addEventListener('input', (e) => {
  const v = e.target.closest('[data-vol]'); if (!v) return;
  const i = Number(v.dataset.vol);
  store.song(app.songId).mix[i] = { ...mixFor(i), vol: Number(v.value) };
  store.updateSong(app.songId, {});
  applyMix();
});

function pickTrackUI(i, add) {
  if (add) { if (app.selected.has(i) && app.selected.size > 1) app.selected.delete(i); else app.selected.add(i); }
  else app.selected = new Set([i]);
  store.updateSong(app.songId, { track: [...app.selected][0] });
  drawTracks(); drawPart(); drawView();
  rerender();
  applyMix();
}

function drawView() {
  const v = yourView();
  document.querySelectorAll('#view-seg button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  const l = store.device('layout', 'Page');
  document.querySelectorAll('#layout-seg button').forEach((b) => b.classList.toggle('on', b.dataset.layout === l));
  $('z-val').textContent = `${Math.round(store.device('zoom', autoZoom()) * 100)}%`;
}
$('view-seg').onclick = (e) => {
  const b = e.target.closest('[data-view]'); if (!b) return;
  store.setPref(`view:${roleOfSelected()}`, b.dataset.view);
  drawView(); rerender();
};
$('layout-seg').onclick = (e) => {
  const b = e.target.closest('[data-layout]'); if (!b) return;
  store.setDevice('layout', b.dataset.layout); drawView();
  rerender(() => player.updateDisplay({ layout: b.dataset.layout }));
};
function zoom(d) {
  const z = Math.round(Math.max(0.5, Math.min(2, store.device('zoom', autoZoom()) + d)) * 100) / 100;
  store.setDevice('zoom', z); drawView();
  rerender(() => player.updateDisplay({ scale: z }));
}
$('z-in').onclick = () => zoom(0.1);
$('z-out').onclick = () => zoom(-0.1);
$('viewport').addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 0.05 : -0.05); } }, { passive: false });

function rerender(draw = () => player.render(scoreTracks(), yourView())) {
  const spot = app.spot;
  // alphaTab tries to redraw a stale selection against the new layout and throws; drop it, redraw it after.
  if (spot) api.clearPlaybackRangeHighlight();
  draw();
}

function openDrawer(open = true) {
  $('drawer').classList.toggle('open', open);
  $('scrim').classList.toggle('open', open);
}
$('song-title').onclick = () => openDrawer(true);
$('scrim').onclick = () => openDrawer(false);
$('drawer').querySelector('[data-close]').onclick = () => openDrawer(false);

// ---------- header buttons
$('home-btn').onclick = showHome;
$('profile-btn').onclick = () => openProfile(false);
$('search-toggle').onclick = () => { document.body.classList.toggle('searching'); if (document.body.classList.contains('searching')) $('q').focus(); };

// ---------- stage mode
let wakeLock = null;
async function toggleStage(on = !document.body.classList.contains('stage')) {
  document.body.classList.toggle('stage', on);
  try {
    if (on) wakeLock = await navigator.wakeLock?.request('screen');
    else { await wakeLock?.release(); wakeLock = null; }
  } catch { /* needs HTTPS or localhost; ignore on plain LAN http */ }
  if (on && !navigator.wakeLock && !window.isSecureContext) toast('Tip: turn off auto-lock on this device so the screen stays on');
}
$('stage-btn').onclick = () => toggleStage();
$('stage-exit').onclick = () => toggleStage(false);

// ---------- keyboard
document.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || document.querySelector('dialog[open]')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '/') { e.preventDefault(); document.body.classList.add('searching'); $('q').focus(); return; }
  if (e.key === '?') { $('keys-dlg').showModal(); return; }
  if (e.key === 'Escape') {
    if ($('drawer').classList.contains('open')) return openDrawer(false);
    if (document.body.classList.contains('stage')) return toggleStage(false);
    if (app.spot) return closeSpot();
    return;
  }
  if (document.body.dataset.view !== 'song') return;
  const k = e.key.toLowerCase();
  const actions = {
    ' ': playPause,
    arrowleft: () => stepSection(-1),
    arrowright: () => stepSection(1),
    l: () => $('t-loop').click(),
    '[': () => setSpeed(app.speed - 0.05),
    ']': () => setSpeed(app.speed + 0.05),
    a: () => practice.missed(),
    b: () => setMode(MODES[(MODES.indexOf(app.mode) + 1) % MODES.length]),
    c: () => $('t-count').click(),
    m: () => $('t-metro').click(),
    t: () => openDrawer(!$('drawer').classList.contains('open')),
    f: () => toggleStage(),
  };
  if (actions[k]) { e.preventDefault(); actions[k](); }
});

// ---------- boot
await store.init();
home.init((id) => openSong(id));
drawProfileChip();
applyToggles();
const hash = new URLSearchParams(location.hash.slice(1));
if (hash.get('song')) openSong(Number(hash.get('song'))); else home.render();
if (!store.profile()) openProfile(true);
window.addEventListener('hashchange', () => {
  const id = Number(new URLSearchParams(location.hash.slice(1)).get('song'));
  if (id && id !== app.songId) openSong(id);
});
