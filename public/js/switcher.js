// Song switcher: tap the song title, see the setlist and your songs right away, type to filter or to find
// anything on Songsterr. Enter opens the highlighted song.
import * as bandApi from './lib.js';
import * as songs from './songs.js';
import { esc, icon, popover, closePopover } from './ui.js';

export function openSwitcher(anchor, { currentId, setId, onPick }) {
  let query = '', remote = [], active = 0, seq = 0, timer = null;
  const set = setId ? bandApi.setlist(setId) : null;

  const items = () => {
    const q = query.trim().toLowerCase();
    const match = (s) => !q || `${s.title} ${s.artist}`.toLowerCase().includes(q);
    const groups = [];
    if (set) {
      const inSet = set.songIds.map((id, i) => ({ ...bandApi.songMeta(id), n: i + 1 })).filter((s) => s.songId && match(s));
      if (inSet.length) groups.push({ label: set.name, songs: inSet });
    }
    const shown = new Set(groups.flatMap((g) => g.songs.map((s) => s.songId)));
    const lib = bandApi.band().songs.filter((s) => !shown.has(s.songId) && match(s)).sort((a, b) => a.title.localeCompare(b.title));
    if (lib.length) groups.push({ label: set ? 'Other songs' : 'Your songs', songs: lib });
    lib.forEach((s) => shown.add(s.songId));
    const more = remote.filter((s) => !shown.has(s.songId));
    if (q && more.length) groups.push({ label: 'From Songsterr', songs: more.map((s) => ({ ...s, remote: true })) });
    return groups;
  };

  const listHtml = () => {
    const groups = items();
    let i = 0;
    if (!groups.length) return `<div class="note">${query.trim() ? 'Searching…' : 'No songs yet.'}</div>`;
    return groups.map((g) => `<div class="menu-label">${esc(g.label)}</div>` + g.songs.map((s) => {
      const idx = i++;
      return `<button class="sw-item ${idx === active ? 'active' : ''}" data-idx="${idx}" data-id="${s.songId}" ${s.songId === currentId ? 'aria-current="true"' : ''}>
        <span class="n">${s.n ?? (s.songId === currentId ? icon('check') : '')}</span>
        <span style="min-width:0"><span class="t">${esc(s.title)}</span><span class="s">${esc(s.artist)}</span></span>
        <span class="tag">${s.remote ? `${s.tracks?.length ?? ''} parts` : ''}</span></button>`;
    }).join('')).join('');
  };

  const m = popover(anchor, () => `
    <div class="sw-search">${icon('search')}<input type="search" placeholder="Find a song" aria-label="Find a song" autocomplete="off" enterkeyhint="go"></div>
    <div class="sw-list" role="listbox"></div>`, {
    className: 'switcher',
    onClick: (e) => {
      const b = e.target.closest('.sw-item');
      if (b) { closePopover(); onPick(Number(b.dataset.id)); }
    },
  });
  if (!m) return; // toggled closed
  const input = m.el.querySelector('input');
  const list = m.el.querySelector('.sw-list');
  const draw = () => { list.innerHTML = listHtml(); list.querySelector('.active')?.scrollIntoView({ block: 'nearest' }); };
  draw();
  input.focus();

  input.addEventListener('input', () => {
    query = input.value; active = 0; draw();
    clearTimeout(timer);
    if (query.trim().length < 2) { remote = []; return; }
    timer = setTimeout(async () => {
      const my = ++seq;
      try {
        const r = await songs.search(query.trim());
        if (my === seq) { remote = r.results || []; draw(); }
      } catch { /* offline: library results still work */ }
    }, 220);
  });
  input.addEventListener('keydown', (e) => {
    const count = list.querySelectorAll('.sw-item').length;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(count - 1, active + 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); draw(); }
    else if (e.key === 'Enter') { const b = list.querySelector('.sw-item.active'); if (b) { closePopover(); onPick(Number(b.dataset.id)); } }
    else if (e.key === 'Escape') closePopover();
  });
}
