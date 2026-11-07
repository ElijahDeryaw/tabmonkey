// Library: the band's songs and setlists, plus search to add new songs.
import * as store from './store.js';
import * as bandApi from './bandapi.js';
import { $, esc, icon, ago, toast, popover, closePopover } from './ui.js';

let view = { kind: 'songs' }; // or { kind: 'set', id }
let sort = { key: 'recent', dir: 1 };
let go = () => {};

export function init({ navigate }) {
  go = navigate;
  bandApi.onChange(() => { if (document.body.dataset.screen === 'library') render(view); });
  initSearch();
  $('new-set').onclick = async () => {
    const id = await bandApi.createSetlist('Untitled setlist');
    go(`set=${id}`, { rename: true });
  };
  $('lib-main').addEventListener('click', onMainClick);
  $('lib-main').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('.row[data-href]')) go(e.target.dataset.href); });
}

// ---------- rendering
export function render(v = view, { rename = false } = {}) {
  view = v;
  const b = bandApi.band();
  $('count-songs').textContent = b.songs.length || '';
  $('side-sets').innerHTML = b.setlists.map((l) =>
    `<a class="side-item" href="#set=${l.id}" ${view.kind === 'set' && view.id === l.id ? 'aria-current="true"' : ''}><span>${esc(l.name)}</span><span class="count">${l.songIds.length || ''}</span></a>`).join('');
  document.querySelector('[data-nav="songs"]').toggleAttribute('aria-current', view.kind === 'songs');
  if (view.kind === 'songs') document.querySelector('[data-nav="songs"]').setAttribute('aria-current', 'true');

  if (view.kind === 'set') {
    const l = bandApi.setlist(view.id);
    if (!l) { view = { kind: 'songs' }; return render(view); }
    renderSet(l, rename);
  } else renderSongs(b.songs);
}

function songRowData(s) {
  const st = store.song(s.songId);
  return { ...s, opened: st.opened || 0, part: st.partName || null, tuning: st.tuningName || null, tuningOdd: !!st.tuningOdd, mastery: store.mastery(s.songId), practiced: !!Object.keys(st.spots || {}).length };
}

const progressCell = (r) => r.practiced
  ? `<div class="progress"><span class="track"><i style="width:${Math.round(r.mastery * 100)}%"></i></span>${Math.round(r.mastery * 100)}%</div>`
  : `<span class="faint">Not started</span>`;
const partCell = (r) => r.part
  ? `<span class="t" style="font-size:13px;font-weight:400">${esc(r.part)}</span>${r.tuning ? `<span class="s ${r.tuningOdd ? 'warn' : ''}">${esc(r.tuning)}</span>` : ''}`
  : `<span class="faint">—</span>`;

function renderSongs(songs) {
  const rows = songs.map(songRowData);
  const k = sort.key;
  rows.sort((a, b) => {
    if (k === 'recent') return (b.opened - a.opened) || (b.addedAt - a.addedAt);
    return sort.dir * String(a[k]).localeCompare(String(b[k]));
  });
  const sortBtn = (key, label) => `<button data-sort="${key}" ${sort.key === key ? 'aria-sort="ascending"' : ''}>${label}</button>`;
  $('lib-main').innerHTML = `<div class="page">
    <div class="page-head"><div class="title"><h1>Songs</h1><span class="meta">${songs.length ? `${songs.length} song${songs.length === 1 ? '' : 's'}` : ''}</span></div></div>
    ${songs.length ? `<div class="table songs" role="table">
      <div class="row head" role="row"><span>${sortBtn('title', 'Song')} · ${sortBtn('artist', 'Artist')}</span><span class="hide-sm">Your part</span><span>Progress</span><span class="hide-sm">${sortBtn('recent', 'Last practiced')}</span><span></span></div>
      ${rows.map((r) => `<div class="row" role="row" tabindex="0" data-href="song=${r.songId}">
        <span class="cell"><span class="t">${esc(r.title)}</span><span class="s">${esc(r.artist)}</span></span>
        <span class="cell hide-sm">${partCell(r)}</span>
        <span class="cell">${progressCell(r)}</span>
        <span class="cell faint hide-sm">${r.opened ? ago(r.opened) : 'Never'}</span>
        <button class="btn icon ghost" data-song-menu="${r.songId}" aria-label="More for ${esc(r.title)}" aria-haspopup="menu">${icon('more')}</button>
      </div>`).join('')}
    </div>` : `<div class="empty"><h2>No songs yet</h2><p>Search for the songs your band plays and add them here. Then group them into setlists for rehearsal or a gig.</p>
      <button class="btn" data-focus-search>${icon('search')}Find a song</button></div>`}
  </div>`;
}

function renderSet(l, rename) {
  const rows = l.songIds.map((id) => bandApi.songMeta(id)).filter(Boolean).map(songRowData);
  $('lib-main').innerHTML = `<div class="page">
    <div class="page-head">
      <div class="title">${rename ? `<input class="title-input" id="set-name" value="${esc(l.name)}" aria-label="Setlist name">` : `<h1>${esc(l.name)}</h1>`}
      <span class="meta">${rows.length} song${rows.length === 1 ? '' : 's'}</span></div>
      <div class="actions">
        <button class="btn" data-add-to-set aria-haspopup="menu">${icon('plus')}Add songs</button>
        <button class="btn primary" data-play-set ${rows.length ? '' : 'disabled'}>${icon('play')}Play set</button>
        <button class="btn icon ghost" data-set-menu aria-label="Setlist options" aria-haspopup="menu">${icon('more')}</button>
      </div>
    </div>
    ${rows.length ? `<div class="table set" role="table" id="set-rows">
      <div class="row head" role="row"><span></span><span class="hide-sm"></span><span>Song</span><span class="hide-sm">Your part</span><span>Progress</span><span></span></div>
      ${rows.map((r, i) => `<div class="row" role="row" tabindex="0" data-href="song=${r.songId}&set=${l.id}" data-id="${r.songId}">
        <span class="grip" title="Drag to reorder">${icon('grip')}</span>
        <span class="cell idx hide-sm">${i + 1}</span>
        <span class="cell"><span class="t">${esc(r.title)}</span><span class="s">${esc(r.artist)}</span></span>
        <span class="cell hide-sm">${partCell(r)}</span>
        <span class="cell">${progressCell(r)}</span>
        <button class="btn icon ghost" data-remove="${r.songId}" title="Remove from setlist" aria-label="Remove ${esc(r.title)} from setlist">${icon('x')}</button>
      </div>`).join('')}
    </div>` : `<div class="empty"><h2>Empty setlist</h2><p>Add songs from your library, in the order you'll play them. You can drag to reorder later.</p></div>`}
  </div>`;
  if (rename) {
    const inp = $('set-name');
    inp.focus(); inp.select();
    const done = async () => { inp.onblur = null; const name = inp.value.trim(); if (name && name !== l.name) await bandApi.renameSetlist(l.id, name); render(view); };
    inp.onblur = done;
    inp.onkeydown = (e) => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = l.name; inp.blur(); } };
  }
  enableReorder(l);
}

// ---------- actions
async function onMainClick(e) {
  const t = e.target;
  const sortBtn = t.closest('[data-sort]');
  if (sortBtn) {
    e.preventDefault();
    const key = sortBtn.dataset.sort;
    sort = { key, dir: sort.key === key ? -sort.dir : 1 };
    return render(view);
  }
  if (t.closest('[data-focus-search]')) return $('q').focus();

  const menuBtn = t.closest('[data-song-menu]');
  if (menuBtn) { e.preventDefault(); return songMenu(menuBtn, Number(menuBtn.dataset.songMenu)); }

  const rm = t.closest('[data-remove]');
  if (rm) {
    const l = bandApi.setlist(view.id);
    await bandApi.setSetlistSongs(l.id, l.songIds.filter((id) => id !== Number(rm.dataset.remove)));
    return;
  }
  if (t.closest('[data-play-set]')) {
    const l = bandApi.setlist(view.id);
    return go(`song=${l.songIds[0]}&set=${l.id}`);
  }
  const addBtn = t.closest('[data-add-to-set]');
  if (addBtn) return addToSetMenu(addBtn, bandApi.setlist(view.id));
  const row = t.closest('.row[data-href]');
  if (row && !t.closest('button, .grip')) return go(row.dataset.href);
  const setMenu = t.closest('[data-set-menu]');
  if (setMenu) {
    const l = bandApi.setlist(view.id);
    popover(setMenu, () => `
      <button class="menu-item" data-act="rename">Rename</button>
      <div class="menu-sep"></div>
      <button class="menu-item danger" data-act="delete">Delete setlist</button>`, {
      align: 'end',
      onClick: async (ev, m) => {
        const act = ev.target.closest('[data-act]')?.dataset.act;
        if (!act) return;
        m.close();
        if (act === 'rename') render(view, { rename: true });
        if (act === 'delete') { await bandApi.deleteSetlist(l.id); toast(`Deleted ${l.name}`); go(''); }
      },
    });
  }
}

/** Per-song menu, used in the library and the song screen. */
export function songMenu(anchor, songId, extra = '') {
  const meta = bandApi.songMeta(songId);
  popover(anchor, () => {
    const sets = bandApi.band().setlists;
    return `
      <div class="menu-label">Add to setlist</div>
      ${sets.map((l) => `<button class="menu-item" data-set="${l.id}"><span class="check">${l.songIds.includes(songId) ? icon('check') : ''}</span><span class="grow">${esc(l.name)}</span></button>`).join('')}
      <button class="menu-item" data-new-set><span class="check">${icon('plus')}</span>New setlist</button>
      ${extra}
      ${meta ? `<div class="menu-sep"></div><button class="menu-item danger" data-remove-song>Remove from songs</button>` : ''}`;
  }, {
    align: 'end',
    onClick: async (e, m) => {
      const song = meta || anchor._song;
      const set = e.target.closest('[data-set]');
      if (set) { await bandApi.toggleInSetlist(set.dataset.set, song); m.redraw(); return; }
      if (e.target.closest('[data-new-set]')) {
        const id = await bandApi.createSetlist('Untitled setlist');
        await bandApi.toggleInSetlist(id, song);
        m.close(); toast('Added to a new setlist'); return;
      }
      if (e.target.closest('[data-remove-song]')) { m.close(); await bandApi.removeSong(songId); toast(`Removed ${meta.title}`); }
    },
  });
}

function addToSetMenu(anchor, l) {
  const songs = bandApi.band().songs;
  popover(anchor, () => songs.length
    ? `<div class="menu-label">Your songs</div>${[...songs].sort((a, b) => a.title.localeCompare(b.title)).map((s) => `<button class="menu-item" data-id="${s.songId}">
        <span class="check">${bandApi.setlist(l.id).songIds.includes(s.songId) ? icon('check') : ''}</span>
        <span class="stack grow"><span>${esc(s.title)}</span><span class="meta">${esc(s.artist)}</span></span></button>`).join('')}`
    : `<div class="note">Your library is empty. Search for a song first.</div>`, {
    onClick: async (e, m) => {
      const b = e.target.closest('[data-id]');
      if (b) { await bandApi.toggleInSetlist(l.id, bandApi.songMeta(Number(b.dataset.id))); m.redraw(); }
    },
  });
}

// Reordering: press a row's grip and the row lifts and follows the pointer; the others slide out of the way;
// on release it settles into its slot. Works with mouse, touch and pen. Alt+↑/↓ does the same from the keyboard.
function enableReorder(l) {
  const box = $('set-rows');
  if (!box) return;
  const scroller = $('lib-main');
  const ease = 'cubic-bezier(.2,.8,.2,1)';

  box.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest('.grip');
    if (!grip || e.button > 0) return;
    e.preventDefault();
    const row = grip.closest('.row');
    const rows = [...box.querySelectorAll('.row[data-id]')];
    const from = rows.indexOf(row);
    const tops = rows.map((r) => r.offsetTop);
    const slot = rows.length > 1 ? tops[1] - tops[0] : row.offsetHeight;
    const startY = e.clientY, startScroll = scroller.scrollTop;
    let pointerY = startY, to = from, raf = 0, scrollRaf = 0, done = false;

    row.classList.add('lifted');
    box.classList.add('reordering');
    document.body.classList.add('dragging');
    navigator.vibrate?.(10);
    grip.setPointerCapture(e.pointerId);

    const frame = () => {
      raf = 0;
      const min = tops[0] - tops[from], max = tops[rows.length - 1] - tops[from];
      const dy = Math.max(min - slot * 0.4, Math.min(max + slot * 0.4, pointerY - startY + scroller.scrollTop - startScroll));
      row.style.transform = `translateY(${dy}px) scale(1.015)`;
      const next = Math.max(0, Math.min(rows.length - 1, Math.round((tops[from] + dy - tops[0]) / slot)));
      if (next !== to) {
        to = next;
        navigator.vibrate?.(4);
        rows.forEach((r, i) => {
          if (r === row) return;
          const shift = from < to && i > from && i <= to ? -slot : from > to && i < from && i >= to ? slot : 0;
          r.style.transform = shift ? `translateY(${shift}px)` : '';
        });
      }
    };
    // Scroll the list when dragging near its top or bottom edge.
    const autoScroll = () => {
      scrollRaf = 0;
      if (done) return;
      const r = scroller.getBoundingClientRect(), edge = 56;
      const v = pointerY < r.top + edge ? -(r.top + edge - pointerY) / 4 : pointerY > r.bottom - edge ? (pointerY - (r.bottom - edge)) / 4 : 0;
      if (v) { scroller.scrollTop += v; if (!raf) raf = requestAnimationFrame(frame); scrollRaf = requestAnimationFrame(autoScroll); }
    };
    const move = (ev) => {
      pointerY = ev.clientY;
      if (!raf) raf = requestAnimationFrame(frame);
      if (!scrollRaf) scrollRaf = requestAnimationFrame(autoScroll);
    };
    const up = () => {
      done = true;
      grip.removeEventListener('pointermove', move);
      cancelAnimationFrame(raf); cancelAnimationFrame(scrollRaf);
      document.body.classList.remove('dragging');
      // Settle: animate the lifted row into its slot, then commit the new order to the DOM.
      row.classList.add('settling');
      row.style.transform = `translateY(${tops[to] - tops[from]}px)`;
      const commit = () => {
        box.classList.remove('reordering');
        rows.forEach((r) => { r.style.transition = 'none'; r.style.transform = ''; });
        row.classList.remove('lifted', 'settling');
        const order = rows.filter((r) => r !== row);
        order.splice(to, 0, row);
        order.forEach((r) => box.append(r));
        order.forEach((r, i) => { const n = r.querySelector('.idx'); if (n) n.textContent = i + 1; });
        requestAnimationFrame(() => rows.forEach((r) => { r.style.transition = ''; }));
        if (to !== from) bandApi.setSetlistSongs(l.id, order.map((r) => Number(r.dataset.id)));
      };
      let committed = false;
      const once = () => { if (!committed) { committed = true; commit(); } };
      row.addEventListener('transitionend', once, { once: true });
      setTimeout(once, 260);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up, { once: true });
    grip.addEventListener('pointercancel', up, { once: true });
  });

  box.addEventListener('keydown', (e) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    const row = e.target.closest('.row[data-id]');
    if (!row) return;
    e.preventDefault();
    const ids = [...l.songIds], id = Number(row.dataset.id), i = ids.indexOf(id), j = i + (e.key === 'ArrowUp' ? -1 : 1);
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    bandApi.setSetlistSongs(l.id, ids).then(() => box.querySelector(`.row[data-id="${id}"]`)?.focus());
  });
}

// ---------- search (adds songs to the library)
let timer, seq = 0, results = [], active = -1, menu = null;
function initSearch() {
  const q = $('q');
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 220); });
  q.addEventListener('focus', () => { if (results.length && q.value.trim()) showResults(); });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(0, Math.min(results.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
      menu?.draw();
    } else if (e.key === 'Enter') {
      clearTimeout(timer);
      if (results[active]) openResult(results[active]); else search();
    } else if (e.key === 'Escape') { closePopover(); q.blur(); }
  });
}

async function search() {
  const q = $('q').value.trim();
  if (!q) { results = []; closePopover(); return; }
  const my = ++seq;
  try {
    const r = await fetch('/api/search?q=' + encodeURIComponent(q)).then((r) => r.json());
    if (my !== seq) return;
    results = r.results || [];
    results.offline = r.source === 'cache';
    active = -1;
    showResults();
  } catch (e) { results = []; toast('Search failed: ' + e.message); }
}

function showResults() {
  const set = view.kind === 'set' ? bandApi.setlist(view.id) : null;
  const render = () => `
    ${results.offline ? '<div class="note">Songsterr is unreachable. Showing songs already downloaded.</div>' : ''}
    ${results.length ? '' : '<div class="note">No songs found.</div>'}
    ${results.map((s, i) => {
      const inSet = set?.songIds.includes(s.songId), inLib = bandApi.hasSong(s.songId);
      const action = set
        ? (inSet ? `<span class="added">${icon('check')}In ${esc(set.name)}</span>` : `<button class="btn" data-add="${i}">${icon('plus')}Add to ${esc(set.name)}</button>`)
        : (inLib ? `<span class="added">${icon('check')}In songs</span>` : `<button class="btn" data-add="${i}">${icon('plus')}Add</button>`);
      return `<div class="result ${i === active ? 'active' : ''}" data-open="${i}" role="menuitem">
        <div style="min-width:0"><div class="t">${esc(s.title)}</div><div class="s">${esc(s.artist)} · ${s.tracks.length} part${s.tracks.length === 1 ? '' : 's'}</div></div>${action}</div>`;
    }).join('')}`;
  const q = $('q');
  if (menu && document.body.contains(menu.el)) { menu.draw(); return; }
  menu = null;
  menu = popover(q, render, {
    className: 'results',
    matchWidth: true,
    onClick: async (e, m) => {
      const add = e.target.closest('[data-add]');
      if (add) {
        e.stopPropagation();
        const s = results[Number(add.dataset.add)];
        if (set) await bandApi.toggleInSetlist(set.id, s); else await bandApi.addSong(s);
        m.redraw();
        return;
      }
      const row = e.target.closest('[data-open]');
      if (row) openResult(results[Number(row.dataset.open)]);
    },
  });
}

function openResult(s) {
  closePopover();
  $('q').value = ''; $('q').blur(); results = [];
  go(`song=${s.songId}`);
}
