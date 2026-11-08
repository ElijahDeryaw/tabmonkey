// Small UI helpers shared by the library and song screens.
export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const icon = (name, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

export function ago(t) {
  if (!t) return '—';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  if (d === 1) return 'Yesterday';
  if (d < 7) return `${d} days ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

let toastTimer;
export function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), Math.max(2400, msg.length * 55));
}

// ---------- popover menus: one open at a time, anchored to the button that opened it.
// On phones they become bottom sheets (thumb-reachable, like native action sheets), except menus with a text field
// (search results, the song switcher), which stay under their field so the keyboard never covers them.
let current = null;
const phone = matchMedia('(max-width: 600px)');
export function popover(anchor, render, { align = 'start', onClick, className = '', matchWidth = false } = {}) {
  if (current?.anchor === anchor) return closePopover();
  closePopover();
  const sheet = phone.matches && !/\b(results|switcher)\b/.test(className);
  const el = document.createElement('div');
  el.className = `menu ${className} ${sheet ? 'bottom-sheet' : ''}`;
  el.setAttribute('role', 'menu');
  let backdrop = null;
  if (sheet) {
    backdrop = document.createElement('div');
    backdrop.className = 'menu-backdrop';
    document.body.append(backdrop);
  }
  document.body.append(el);
  const draw = () => { el.innerHTML = render(); };
  draw();
  current = { el, anchor, draw, backdrop, sheet, align };
  anchor.setAttribute('aria-expanded', 'true');
  if (matchWidth) el.style.width = `${anchor.getBoundingClientRect().width}px`;
  place(current);
  if (sheet) requestAnimationFrame(() => { el.classList.add('in'); backdrop.classList.add('in'); });
  const redraw = () => { draw(); place(current); }; // content can grow; keep it on screen
  el.addEventListener('click', (e) => onClick?.(e, { redraw, close: closePopover }));
  el.addEventListener('input', (e) => onClick?.(e, { redraw, close: closePopover }));
  return current;
}

function place(c) {
  if (!c || c.sheet) return;
  const { el, anchor, align } = c;
  const vv = window.visualViewport;
  const viewH = vv ? vv.height : innerHeight; // excludes the on-screen keyboard
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth, m = 8;
  let left = align === 'end' ? r.right - w : r.left;
  left = Math.max(m, Math.min(left, innerWidth - w - m));
  el.style.maxHeight = '';
  const h = el.offsetHeight;
  let top = r.bottom + 6;
  if (top + h > viewH - m && r.top - h - 6 >= m) top = r.top - h - 6; // flip above (e.g. from the transport)
  else if (top + h > viewH - m) el.style.maxHeight = `${Math.max(160, viewH - top - m)}px`;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

export function closePopover() {
  if (!current) return;
  const { el, anchor, backdrop, sheet } = current;
  current = null;
  anchor.setAttribute('aria-expanded', 'false');
  if (sheet) {
    el.classList.remove('in'); backdrop.classList.remove('in');
    setTimeout(() => { el.remove(); backdrop.remove(); }, 220);
  } else el.remove();
}
export const popoverOpen = () => !!current;

document.addEventListener('pointerdown', (e) => {
  if (current && !current.el.contains(e.target) && !current.anchor.contains(e.target)) closePopover();
});
// Rotating or resizing closes menus, but the on-screen keyboard opening (also a resize on iOS) must not close a menu
// you're typing into; keep it in place instead.
const typingIn = (c) => c && (c.el.contains(document.activeElement) || c.anchor.contains(document.activeElement));
let lastW = innerWidth;
addEventListener('resize', () => {
  const rotated = innerWidth !== lastW;
  lastW = innerWidth;
  if (!current) return;
  if (!rotated && typingIn(current)) place(current); else closePopover();
});
window.visualViewport?.addEventListener('resize', () => { if (typingIn(current)) place(current); });
