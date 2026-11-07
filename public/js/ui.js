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
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

// ---------- popover menus: one open at a time, anchored to the button that opened it
let current = null;
export function popover(anchor, render, { align = 'start', onClick, className = '', matchWidth = false } = {}) {
  if (current?.anchor === anchor) return closePopover();
  closePopover();
  const el = document.createElement('div');
  el.className = `menu ${className}`;
  el.setAttribute('role', 'menu');
  document.body.append(el);
  const draw = () => { el.innerHTML = render(); };
  draw();
  current = { el, anchor, draw };
  anchor.setAttribute('aria-expanded', 'true');
  if (matchWidth) el.style.width = `${anchor.getBoundingClientRect().width}px`;
  place(el, anchor, align);
  el.addEventListener('click', (e) => onClick?.(e, { redraw: () => { draw(); place(el, anchor, align); }, close: closePopover }));
  el.addEventListener('input', (e) => onClick?.(e, { redraw: draw, close: closePopover }));
  return current;
}

function place(el, anchor, align) {
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight, m = 8;
  let left = align === 'end' ? r.right - w : r.left;
  left = Math.max(m, Math.min(left, innerWidth - w - m));
  let top = r.bottom + 6;
  if (top + h > innerHeight - m) top = Math.max(m, r.top - h - 6); // flip above (e.g. from the transport)
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

export function closePopover() {
  if (!current) return;
  current.anchor.setAttribute('aria-expanded', 'false');
  current.el.remove();
  current = null;
}
export const popoverOpen = () => !!current;

document.addEventListener('pointerdown', (e) => {
  if (current && !current.el.contains(e.target) && !current.anchor.contains(e.target)) closePopover();
});
addEventListener('resize', closePopover);
