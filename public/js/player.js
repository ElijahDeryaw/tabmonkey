// Thin wrapper around alphaTab: rendering, bar/tick lookups, looping and the band mix.
/* global alphaTab */

export let api = null;
let barStarts = []; // midi start tick per master bar (filled once the midi is generated)
let barEnds = [];

// Built into the site by scripts/build.js (GeneralUser GS when present, else alphaTab's own sonivox).
const SOUNDFONT = document.querySelector('meta[name="tm-soundfont"]')?.content || 'soundfont/sonivox.sf2';
const VIEW = { tab: 'TabMixed', both: 'Default', notation: 'Score' };

export function create(el, scrollEl, { scale, layout, view }) {
  api = new alphaTab.AlphaTabApi(el, {
    core: { fontDirectory: new URL('alphatab/font/', document.baseURI).href, includeNoteBounds: false },
    display: {
      scale, layoutMode: alphaTab.LayoutMode[layout], staveProfile: alphaTab.StaveProfile[VIEW[view]],
      systemPaddingTop: 25, systemPaddingBottom: 15,
      // Neutral bar numbers: alphaTab's default red competes with the playhead accent.
      resources: { barNumberColor: '#8c8c86' },
    },
    notation: {
      rhythmMode: alphaTab.TabRhythmMode.ShowWithBars,
      // The app header already shows title/artist; give that space to music.
      elements: { scoreTitle: false, scoreSubTitle: false, scoreArtist: false, scoreAlbum: false, scoreWords: false, scoreMusic: false, scoreWordsAndMusic: false, scoreCopyright: false, trackNames: false },
    },
    player: {
      playerMode: alphaTab.PlayerMode.EnabledSynthesizer,
      soundFont: new URL(SOUNDFONT, document.baseURI).href,
      scrollElement: scrollEl,
      scrollOffsetY: -60,
      enableCursor: true,
      enableAnimatedBeatCursor: true,
      enableUserInteraction: true,
    },
  });
  patchMidiInfoGetter();
  // alphaTab re-highlights the loop by itself when the range changes, which throws if the layout is mid-render.
  // Swallow that; the caller redraws the highlight once layout is done (see highlightBars).
  const highlight = api.highlightPlaybackRange.bind(api);
  api.highlightPlaybackRange = (a, b) => { try { highlight(a, b); } catch { /* layout not ready */ } };
  guardSelectionCursor();
  api.midiLoaded.on(indexBars);
  return api;
}

// alphaTab's private _cursorSelectRange (name mangled in the minified build) runs from player events and throws
// when the layout it draws into isn't built yet (e.g. a range arriving mid-render). An exception there escapes
// into alphaTab's event dispatch, so make it fail quietly; the highlight is redrawn after the next render.
function guardSelectionCursor() {
  for (let proto = Object.getPrototypeOf(api); proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      const d = Object.getOwnPropertyDescriptor(proto, name);
      if (typeof d?.value !== 'function') continue;
      const src = d.value.toString();
      if (src.includes('playbackRangeHighlightChanged') && src.includes('.clear()') && src.includes('findBeat(')) {
        const fn = d.value;
        api[name] = function (...args) { try { return fn.apply(this, args); } catch { /* layout not ready */ } };
      }
    }
  }
}

// alphaTab 1.8.4 bug: AlphaSynthWebWorkerApi's `loadedMidiInfo` getter returns itself (infinite recursion),
// and subscribing to `midiLoaded` reads it. Point the getter at the backing field instead.
function patchMidiInfoGetter() {
  // Private field names are mangled in the minified build, so look through the player's members for the culprit.
  const p = api.player;
  if (!p) return;
  for (const v of Object.values(p)) {
    if (!v || typeof v !== 'object') continue;
    for (let proto = Object.getPrototypeOf(v); proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
      const d = Object.getOwnPropertyDescriptor(proto, 'loadedMidiInfo');
      if (!d) continue;
      if (d.get && /return this\.loadedMidiInfo\b/.test(d.get.toString())) {
        // The worker API stores the value in a (possibly mangled) field set when midi loads; read it from there.
        let info = null;
        const origTrigger = v.midiLoaded?.trigger?.bind(v.midiLoaded);
        if (origTrigger) v.midiLoaded.trigger = (e) => { info = e; origTrigger(e); };
        Object.defineProperty(v, 'loadedMidiInfo', { get: () => info, configurable: true });
      }
      break;
    }
  }
}

function indexBars() {
  const cache = api.tickCache;
  if (!cache || !api.score) return;
  barStarts = []; barEnds = [];
  for (const mb of api.score.masterBars) {
    const l = cache.getMasterBar(mb);
    barStarts.push(l?.start ?? mb.start);
    barEnds.push(l?.end ?? mb.start + mb.calculateDuration());
  }
}

export const barCount = () => api?.score?.masterBars.length ?? 0;
export const barStart = (i) => barStarts[i] ?? 0;
export const barEnd = (i) => barEnds[i] ?? 0;

/** Index of the master bar containing a midi tick. */
export function barAt(tick) {
  let lo = 0, hi = barStarts.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (barStarts[mid] <= tick) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** Render a set of score tracks. Drum kits can't be drawn tab-only, so they fall back to notation. */
export function render(tracks, view) {
  if (!api?.score || !tracks.length) return;
  const p = view === 'tab' && tracks.some((t) => t.staves[0]?.isPercussion) ? 'Default' : VIEW[view];
  const names = tracks.length > 1; // staff labels only help when several parts are stacked
  const els = api.settings.notation.elements;
  if (api.settings.display.staveProfile !== alphaTab.StaveProfile[p] || els.get(alphaTab.NotationElement.TrackNames) !== names) {
    api.settings.display.staveProfile = alphaTab.StaveProfile[p];
    els.set(alphaTab.NotationElement.TrackNames, names);
    api.updateSettings();
  }
  api.renderTracks(tracks);
}

/**
 * Apply a theme ({ display: { systemPadding…, resources: { colors, fonts, engravingSettings } } }) directly on the
 * live settings objects. (Settings.fillFromJson expects alphaTab's internal Map form, not plain objects.)
 */
function applyTheme(theme) {
  const d = api.settings.display, src = theme.display ?? {};
  for (const [k, v] of Object.entries(src)) {
    if (k === 'resources') continue;
    d[k] = v;
  }
  const res = d.resources;
  for (const [k, v] of Object.entries(src.resources ?? {})) {
    if (k === 'engravingSettings') Object.assign(res.engravingSettings, v);
    else if (typeof v === 'string') res[k] = alphaTab.model.Color.fromJson(v);
    else res[k] = alphaTab.model.Font.withFamilyList(v.families, v.size, alphaTab.model.FontStyle[v.style], alphaTab.model.FontWeight[v.weight]);
  }
}

export function updateDisplay({ scale, layout, theme }) {
  if (!api) return;
  if (theme) applyTheme(theme);
  if (scale) api.settings.display.scale = scale;
  if (layout) api.settings.display.layoutMode = alphaTab.LayoutMode[layout];
  api.updateSettings();
  if (api.score) api.render();
}

const firstBeat = (bar) => bar?.voices[0]?.beats[0] ?? null;
const lastBeat = (bar) => bar?.voices[0]?.beats.at(-1) ?? null;

const beatsFor = (start, end) => {
  const bars = api?.tracks?.[0]?.staves[0]?.bars;
  const a = firstBeat(bars?.[start]), b = lastBeat(bars?.[end]);
  return a && b ? [a, b] : null;
};

/** Loop bars [start, end] (inclusive), highlighting them on the sheet. */
export function loopBars(start, end) {
  const beats = beatsFor(start, end);
  if (!beats) return;
  api.highlightPlaybackRange(...beats);
  // Set the range from bar ticks directly: it doesn't depend on the highlight having succeeded.
  if (barStarts.length) api.playbackRange = { startTick: barStart(start), endTick: barEnd(end) };
  else api.applyPlaybackRangeFromHighlight();
}

/** Redraw the loop highlight only (after a re-render), leaving playback untouched. */
export function highlightBars(start, end) {
  const beats = beatsFor(start, end);
  if (beats) api.highlightPlaybackRange(...beats);
}

export function clearLoop() {
  if (!api) return;
  api.clearPlaybackRangeHighlight();
  api.playbackRange = null;
  api.isLooping = false;
}

/** Turn an alphaTab notation element (e.g. 'EffectLyrics') on or off; returns true if it changed. */
export function setElement(name, on) {
  const els = api?.settings.notation.elements;
  const key = alphaTab.NotationElement[name];
  if (!els || els.get(key) === on) return false;
  els.set(key, on);
  api.updateSettings();
  return true;
}

/**
 * String names (e B G D A E) to the left of every tab staff, from the staff's actual tuning. alphaTab has no option
 * for this, so they're drawn as an overlay from its layout bounds after each render.
 */
const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export function drawStringLabels(sheetEl, show, view) {
  let layer = sheetEl.querySelector('.string-labels');
  if (!layer) { layer = document.createElement('div'); layer.className = 'string-labels'; sheetEl.append(layer); }
  layer.innerHTML = '';
  const lookup = api?.boundsLookup;
  if (!show || !lookup) return;
  const surface = sheetEl.querySelector('.at-surface');
  const dx = surface ? surface.offsetLeft : 0, dy = surface ? surface.offsetTop : 0;
  // Each system lists one bounds box per renderer, in render order: for every shown staff, standard notation
  // (if shown) then tab. (BarBounds.bar isn't populated in this build, so match by order.)
  const renderers = [];
  for (const track of api.tracks ?? []) for (const staff of track.staves) {
    if (staff.isPercussion) renderers.push(null);
    else if (view === 'tab') renderers.push(staff);
    else if (view === 'both') renderers.push(null, staff);
    else renderers.push(null);
  }
  const html = [];
  for (const system of lookup.staffSystems) {
    const first = system.bars[0];
    if (!first || first.bars.length !== renderers.length) continue;
    first.bars.forEach((bb, i) => {
      const staff = renderers[i];
      if (!staff?.tuning?.length) return;
      const vb = bb.visualBounds, n = staff.tuning.length;
      const names = staff.tuning.map((m) => NOTE_NAMES[((m % 12) + 12) % 12]);
      if (names[0] === names[n - 1]) names[0] = names[0].toLowerCase(); // e B G D A E
      const step = n > 1 ? vb.h / (n - 1) : 0;
      names.forEach((name, j) => html.push(`<span style="left:${dx + vb.x - 5}px;top:${dy + vb.y + j * step}px">${name}</span>`));
    });
  }
  layer.innerHTML = html.join('');
}

/** Scroll the sheet so bar i's system is near the top (alphaTab only auto-scrolls while playing). */
export function scrollToBar(i, scrollEl, sheetEl) {
  const mb = api?.score?.masterBars[i];
  const b = mb && api.boundsLookup?.findMasterBar(mb);
  if (!b) return;
  const y = (b.lineAlignedBounds ?? b.realBounds ?? b.visualBounds).y;
  const sheetTop = sheetEl.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop;
  scrollEl.scrollTo({ top: Math.max(0, sheetTop + y - 64), behavior: 'smooth' });
}

export function seekBar(i) { if (api && barStarts.length) api.tickPosition = barStart(i); }

/**
 * Two-fader mix: `me` for the parts you're reading, `band` for everything else (0..1).
 * `silent` holds score track indexes that never play with the band (synth vocal guide lines).
 */
export function applyMix(me, band, mine, silent) {
  if (!api?.score) return;
  for (const t of api.score.tracks) {
    const isMine = mine.has(t.index);
    const v = isMine ? me : silent.has(t.index) ? 0 : band;
    api.changeTrackVolume([t], v);
    api.changeTrackMute([t], v === 0);
  }
}

/**
 * Long-press-then-drag selection for touch screens (alphaTab's own drag selection is mouse-only).
 * A plain one-finger drag still scrolls the page.
 */
/**
 * Touch: hold on the music, then drag across it to loop exactly those beats (like selecting text).
 * A quick swipe still scrolls. iOS long-press behaviours (text selection, the loupe, callouts) are switched off on the
 * sheet in CSS, otherwise they cancel the touch. Dragging near the top or bottom edge scrolls the sheet along.
 */
export function enableTouchSelect(surfaceEl, onDone, scrollEl = surfaceEl.parentElement) {
  let timer = null, startBeat = null, endBeat = null, selecting = false, x0 = 0, y0 = 0, lastTouch = null, raf = 0;
  const beatAt = (pt) => {
    const surface = surfaceEl.querySelector('.at-surface') || surfaceEl;
    const r = surface.getBoundingClientRect();
    return api?.boundsLookup?.getBeatAtPos(pt.clientX - r.left, pt.clientY - r.top) ?? null;
  };
  const order = (a, b) => (a.absolutePlaybackStart <= b.absolutePlaybackStart ? [a, b] : [b, a]);
  const extend = () => {
    if (!selecting || !lastTouch) return;
    const b = beatAt(lastTouch);
    if (b && b !== endBeat) { endBeat = b; api.highlightPlaybackRange(...order(startBeat, endBeat)); }
  };
  const edgeScroll = () => {
    raf = 0;
    if (!selecting || !lastTouch || !scrollEl) return;
    const r = scrollEl.getBoundingClientRect(), edge = 70, y = lastTouch.clientY;
    const v = y < r.top + edge ? -(r.top + edge - y) / 5 : y > r.bottom - edge ? (y - (r.bottom - edge)) / 5 : 0;
    if (v) { scrollEl.scrollTop += v; extend(); raf = requestAnimationFrame(edgeScroll); }
  };
  surfaceEl.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { clearTimeout(timer); return; }
    const t = e.touches[0];
    x0 = t.clientX; y0 = t.clientY;
    lastTouch = { clientX: t.clientX, clientY: t.clientY };
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      startBeat = endBeat = beatAt(lastTouch);
      if (!startBeat) return;
      selecting = true;
      surfaceEl.classList.add('selecting');
      navigator.vibrate?.(15);
      api.highlightPlaybackRange(startBeat, startBeat);
    }, 320);
  }, { passive: true });
  surfaceEl.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    lastTouch = { clientX: t.clientX, clientY: t.clientY };
    if (!selecting) {
      if (timer && Math.hypot(t.clientX - x0, t.clientY - y0) > 10) { clearTimeout(timer); timer = null; } // it's a scroll
      return;
    }
    e.preventDefault(); // keep the sheet still while selecting
    extend();
    if (!raf) raf = requestAnimationFrame(edgeScroll);
  }, { passive: false });
  const end = (e) => {
    clearTimeout(timer); timer = null;
    cancelAnimationFrame(raf); raf = 0;
    if (!selecting) return;
    selecting = false;
    surfaceEl.classList.remove('selecting');
    e?.preventDefault?.(); // no synthetic click (which would seek and clear the loop)
    api.highlightPlaybackRange(...order(startBeat, endBeat));
    api.applyPlaybackRangeFromHighlight();
    onDone?.();
  };
  surfaceEl.addEventListener('touchend', end, { passive: false });
  surfaceEl.addEventListener('touchcancel', end);
  surfaceEl.addEventListener('contextmenu', (e) => { if (selecting || timer) e.preventDefault(); });
}

