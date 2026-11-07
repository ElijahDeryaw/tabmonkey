// Thin wrapper around alphaTab: rendering, bar/tick lookups, looping and the band mix.
/* global alphaTab */

export let api = null;
let barStarts = []; // midi start tick per master bar (filled once the midi is generated)
let barEnds = [];

const VIEW = { tab: 'TabMixed', both: 'Default', notation: 'Score' };

export function create(el, scrollEl, { scale, layout, view }) {
  api = new alphaTab.AlphaTabApi(el, {
    core: { fontDirectory: '/alphatab/font/', includeNoteBounds: false },
    display: {
      scale, layoutMode: alphaTab.LayoutMode[layout], staveProfile: alphaTab.StaveProfile[VIEW[view]],
      systemPaddingTop: 25, systemPaddingBottom: 15,
    },
    notation: {
      rhythmMode: alphaTab.TabRhythmMode.ShowWithBars,
      // The app header already shows title/artist; give that space to music.
      elements: { scoreTitle: false, scoreSubTitle: false, scoreArtist: false, scoreAlbum: false, scoreWords: false, scoreMusic: false, scoreWordsAndMusic: false, scoreCopyright: false },
    },
    player: {
      playerMode: alphaTab.PlayerMode.EnabledSynthesizer,
      soundFont: '/soundfont',
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
  api.midiLoaded.on(indexBars);
  return api;
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
  if (api.settings.display.staveProfile !== alphaTab.StaveProfile[p]) {
    api.settings.display.staveProfile = alphaTab.StaveProfile[p];
    api.updateSettings();
  }
  api.renderTracks(tracks);
}

export function updateDisplay({ scale, layout }) {
  if (!api) return;
  if (scale) api.settings.display.scale = scale;
  if (layout) api.settings.display.layoutMode = alphaTab.LayoutMode[layout];
  api.updateSettings();
  api.render();
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

export function seekBar(i) { if (api && barStarts.length) api.tickPosition = barStart(i); }

/**
 * Apply the band mix. mode: 'full' | 'along' (mute your part) | 'solo' (only your part).
 * mixer: { [scoreTrackIndex]: { vol, mute } }. mine: Set of score track indexes being shown.
 */
export function applyMix(mode, mixer, mine) {
  if (!api?.score) return;
  for (const t of api.score.tracks) {
    const m = mixer[t.index] || {};
    const isMine = mine.has(t.index);
    api.changeTrackVolume([t], m.vol ?? 1);
    api.changeTrackSolo([t], mode === 'solo' && isMine);
    api.changeTrackMute([t], mode === 'along' ? isMine || !!m.mute : mode === 'solo' ? false : !!m.mute);
  }
}

/**
 * Long-press-then-drag selection for touch screens (alphaTab's own drag selection is mouse-only).
 * A plain one-finger drag still scrolls the page.
 */
export function enableTouchSelect(surfaceEl, onDone) {
  let timer = null, startBeat = null, endBeat = null, selecting = false, x0 = 0, y0 = 0;
  const beatAt = (touch) => {
    const surface = surfaceEl.querySelector('.at-surface') || surfaceEl;
    const r = surface.getBoundingClientRect();
    return api?.boundsLookup?.getBeatAtPos(touch.clientX - r.left, touch.clientY - r.top) ?? null;
  };
  const order = (a, b) => (a.absolutePlaybackStart <= b.absolutePlaybackStart ? [a, b] : [b, a]);
  surfaceEl.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY;
    timer = setTimeout(() => {
      startBeat = endBeat = beatAt(t);
      if (!startBeat) return;
      selecting = true;
      navigator.vibrate?.(15);
      api.highlightPlaybackRange(startBeat, startBeat);
    }, 350);
  }, { passive: true });
  surfaceEl.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    if (!selecting) {
      if (Math.hypot(t.clientX - x0, t.clientY - y0) > 10) clearTimeout(timer);
      return;
    }
    e.preventDefault(); // keep the page still while selecting
    const b = beatAt(t);
    if (b && b !== endBeat) { endBeat = b; api.highlightPlaybackRange(...order(startBeat, endBeat)); }
  }, { passive: false });
  const end = () => {
    clearTimeout(timer);
    if (!selecting) return;
    selecting = false;
    api.highlightPlaybackRange(...order(startBeat, endBeat));
    api.applyPlaybackRangeFromHighlight();
    onDone?.();
  };
  surfaceEl.addEventListener('touchend', end);
  surfaceEl.addEventListener('touchcancel', end);
  surfaceEl.addEventListener('contextmenu', (e) => { if (selecting || timer) e.preventDefault(); });
}
