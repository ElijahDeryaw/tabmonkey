// The "app" layer for phones and tablets: haptics, push/pop screen transitions, swipe-from-the-edge to go back,
// long-press menus, offline support and the Add to Home Screen hint. Desktop (mouse + hover) gets none of it and keeps
// its web-app feel.
const html = document.documentElement;
export const touch = matchMedia('(hover: none) and (pointer: coarse)').matches;
export const phone = () => matchMedia('(max-width: 600px)').matches;
export const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
if (touch) html.classList.add('touch');
if (ios) html.classList.add('ios');
if (standalone) html.classList.add('standalone');

// ---------- haptics
// Safari has no vibration API, but toggling a native switch control plays the system "selection" tap (iOS 18+).
// Must run inside a user gesture (click / touchend). Elsewhere it falls back to navigator.vibrate.
let hapticEl = null;
export function haptic() {
  if (!touch) return;
  if (ios) {
    try {
      if (!hapticEl) {
        hapticEl = document.createElement('label');
        hapticEl.setAttribute('aria-hidden', 'true');
        hapticEl.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
        hapticEl.innerHTML = '<input type="checkbox" switch tabindex="-1">';
        document.body.append(hapticEl);
      }
      hapticEl.click();
    } catch { /* no haptics */ }
  } else navigator.vibrate?.(8);
}

// ---------- screen transitions (Safari 18+ / Chrome view transitions); instant elsewhere
/** depth: tabs 0, a setlist/library 1, a song 2. Deeper pushes in from the right, shallower pops back. */
let lastDepth = 0;
export function transition(depth, update) {
  const dir = depth > lastDepth ? 'push' : depth < lastDepth ? 'pop' : 'swap';
  lastDepth = depth;
  // Tab switches are instant (as in iOS), and a finished swipe-back has already animated.
  if (html.dataset.swiping) { delete html.dataset.swiping; update(); return; }
  if (!touch || dir === 'swap' || !document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) { update(); return; }
  html.dataset.nav = dir;
  const t = document.startViewTransition(update);
  t.finished.finally(() => { if (html.dataset.nav === dir) delete html.dataset.nav; });
}

// ---------- swipe from the left edge to go back (what every iOS app does)
/** getBack() returns a function that goes back, or null when there's nowhere to go. */
export function enableSwipeBack(getBack) {
  if (!touch) return;
  let start = null, el = null, shade = null, back = null, dx = 0, lastX = 0, lastT = 0, v = 0;
  const reset = () => { start = null; el = null; shade?.remove(); shade = null; delete html.dataset.swiping; };
  addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    if (e.touches.length !== 1 || t.clientX > 24 || document.querySelector('.menu, dialog[open]')) return;
    back = getBack();
    if (!back) return;
    start = { x: t.clientX, y: t.clientY }; dx = 0; lastX = t.clientX; lastT = e.timeStamp; v = 0;
  }, { passive: true });
  addEventListener('touchmove', (e) => {
    if (!start) return;
    const t = e.touches[0];
    const mx = t.clientX - start.x, my = t.clientY - start.y;
    if (!el) {
      if (Math.abs(my) > 12 && Math.abs(my) > Math.abs(mx)) { reset(); return; } // vertical: let it scroll
      if (mx < 8) return;
      el = document.querySelector(document.body.dataset.screen === 'song' ? '#song' : '#lib-main');
      html.dataset.swiping = '1';
      if (document.body.dataset.screen === 'song') document.body.dataset.peek = '1'; // show the library underneath
      shade = Object.assign(document.createElement('div'), { className: 'swipe-shade' });
      el.parentElement.insertBefore(shade, el);
    }
    e.preventDefault();
    dx = Math.max(0, mx);
    v = (t.clientX - lastX) / Math.max(1, e.timeStamp - lastT); lastX = t.clientX; lastT = e.timeStamp;
    el.style.transition = 'none';
    el.style.transform = `translateX(${dx}px)`;
    shade.style.opacity = String(Math.max(0, 1 - dx / innerWidth) * 0.5);
  }, { passive: false });
  const end = () => {
    if (!start || !el) { reset(); return; }
    const go = dx > innerWidth * 0.33 || v > 0.5;
    const target = el, s = shade, b = back;
    target.style.transition = 'transform .22s cubic-bezier(.2,.8,.2,1)';
    target.style.transform = go ? `translateX(${innerWidth}px)` : '';
    if (s) { s.style.transition = 'opacity .22s'; s.style.opacity = '0'; }
    start = null; el = null; shade = null;
    setTimeout(() => {
      const done = () => {
        target.style.transition = ''; target.style.transform = '';
        s?.remove();
        delete document.body.dataset.peek;
      };
      if (go) {
        haptic();
        addEventListener('hashchange', () => requestAnimationFrame(done), { once: true });
        setTimeout(() => { done(); delete html.dataset.swiping; }, 600); // fallback if nothing navigated
        b();
      } else { done(); delete html.dataset.swiping; }
    }, 230);
  };
  addEventListener('touchend', end);
  addEventListener('touchcancel', end);
}

// ---------- long-press (context menus on list rows)
export function onLongPress(container, selector, cb) {
  if (!touch) return;
  let timer = null, x0 = 0, y0 = 0, fired = false;
  container.addEventListener('touchstart', (e) => {
    const target = e.target.closest(selector);
    fired = false;
    if (!target || e.touches.length !== 1 || e.target.closest('button, .grip, a.btn')) return;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
    clearTimeout(timer);
    timer = setTimeout(() => { fired = true; target.classList.add('pressed'); cb(target); setTimeout(() => target.classList.remove('pressed'), 300); }, 480);
  }, { passive: true });
  container.addEventListener('touchmove', (e) => { if (Math.hypot(e.touches[0].clientX - x0, e.touches[0].clientY - y0) > 8) clearTimeout(timer); }, { passive: true });
  container.addEventListener('touchend', (e) => { clearTimeout(timer); if (fired) { e.preventDefault(); haptic(); } }, { passive: false });
  container.addEventListener('touchcancel', () => clearTimeout(timer));
  container.addEventListener('contextmenu', (e) => { if (e.target.closest(selector)) e.preventDefault(); });
}

// ---------- offline: a service worker keeps the app, alphaTab and the sounds on the device
export function registerOffline() {
  // Not during local development (it would serve stale files), unless asked for with ?sw.
  if (!('serviceWorker' in navigator) || (/^(localhost|127\.)/.test(location.hostname) && !location.search.includes('sw'))) return;
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ---------- Add to Home Screen (iOS has no install prompt, so explain it)
export const canInstall = () => ios && !standalone;

// ---------- swipe a sheet down to dismiss it (sheets and phone dialogs)
/** el: the sheet; close(): dismiss it; canClose(): false while it must stay (e.g. first-run welcome). */
export function enableSwipeDismiss(el, close, canClose = () => true) {
  if (!touch || el._swipeDismiss) return;
  el._swipeDismiss = true;
  let y0 = 0, x0 = 0, dy = 0, dragging = false, track = false, lastY = 0, lastT = 0, v = 0;
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || !canClose() || e.target.closest('input, select, textarea, input[type="range"]')) { track = false; return; }
    const scroller = e.target.closest('.sw-list') || el;
    track = scroller.scrollTop <= 0;
    y0 = lastY = e.touches[0].clientY; x0 = e.touches[0].clientX; lastT = e.timeStamp; dy = 0; dragging = false; v = 0;
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (!track) return;
    const t = e.touches[0], my = t.clientY - y0, mx = t.clientX - x0;
    if (!dragging) {
      if (my < 6 || Math.abs(mx) > Math.abs(my)) { if (my < -4 || Math.abs(mx) > 10) track = false; return; }
      dragging = true;
    }
    e.preventDefault();
    dy = Math.max(0, my);
    v = (t.clientY - lastY) / Math.max(1, e.timeStamp - lastT); lastY = t.clientY; lastT = e.timeStamp;
    el.style.transition = 'none';
    el.style.transform = `translateY(${dy}px)`;
  }, { passive: false });
  const end = () => {
    if (!dragging) return;
    dragging = false; track = false;
    const gone = dy > Math.min(140, el.offsetHeight * 0.3) || v > 0.6;
    el.style.transition = 'transform .24s cubic-bezier(.2,.8,.2,1)';
    if (gone) {
      el.style.transform = `translateY(${el.offsetHeight + 40}px)`;
      haptic();
      setTimeout(() => { close(); el.style.transition = ''; el.style.transform = ''; }, 200);
    } else {
      el.style.transform = '';
      setTimeout(() => { el.style.transition = ''; }, 260);
    }
  };
  el.addEventListener('touchend', end);
  el.addEventListener('touchcancel', end);
}
