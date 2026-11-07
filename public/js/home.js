// Home screen (continue, your songs, songs on this Pi) and the search box.
import * as store from './store.js';
import { INSTRUMENTS } from './instruments.js';

const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let openSong = () => {};
export function init(onOpen) {
  openSong = onOpen;
  initSearch();
  document.addEventListener('click', (e) => {
    const card = e.target.closest('[data-song]');
    if (card && !e.target.closest('#results')) openSong(Number(card.dataset.song));
  });
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Late session' : h < 12 ? 'Morning' : h < 18 ? 'Hey' : 'Evening';
};

export async function render() {
  const p = store.profile();
  const inst = INSTRUMENTS.find((i) => i.id === p?.instrument);
  $('hello').textContent = p ? `${greeting()}, ${p.name}` : 'Hey there';
  const recent = store.recentSongs();
  $('hello-sub').textContent = recent.length
    ? `Pick up where you left off, or find something new.`
    : `Search for a song. Your ${inst?.label.toLowerCase() ?? ''} part opens automatically.`;

  const last = recent[0];
  if (last) {
    const spot = last.lastSpot?.key ? last.lastSpot : null;
    const best = spot && last.spots?.[spot.key]?.best;
    const where = spot ? `${esc(spot.label)}${best ? ` · best ${best}%` : ''}` : 'From the top';
    $('continue').innerHTML = `<button class="continue" data-song="${last.songId}">
      <div><div class="k">Continue</div><div class="t">${esc(last.title)}</div><div class="s">${esc(last.artist)} · ${where}</div></div>
      <div class="go">▶</div></button>`;
  } else {
    $('continue').innerHTML = `<div class="empty-hint">Nothing practiced yet. Try searching for a song your band plays ↑</div>`;
  }

  $('mine-wrap').hidden = recent.length < 2;
  $('mine').innerHTML = recent.slice(1, 13).map((s) => card(s, store.mastery(s.songId))).join('');

  try {
    const lib = await fetch('/api/library').then((r) => r.json());
    const mine = new Set(recent.map((s) => s.songId));
    const others = lib.filter((s) => !mine.has(s.songId)).slice(0, 12);
    $('lib-wrap').hidden = !others.length;
    $('lib').innerHTML = others.map((s) => card(s)).join('');
  } catch { $('lib-wrap').hidden = true; }
}

function card(s, m) {
  const pct = m == null ? '' : `<div class="meter"><i style="width:${Math.round(m * 100)}%"></i></div><div class="pct">${m ? `${Math.round(m * 100)}% mastered` : 'Not practiced yet'}</div>`;
  return `<button class="song-card" data-song="${s.songId}"><span class="t">${esc(s.title)}</span><span class="a">${esc(s.artist)}</span>${pct}</button>`;
}

// ---------- search
let timer, seq = 0, active = -1;
function initSearch() {
  const q = $('q'), results = $('results');
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 250); });
  q.addEventListener('focus', () => { if (results.innerHTML && q.value.trim()) results.classList.add('open'); });
  q.addEventListener('keydown', (e) => {
    const items = [...results.querySelectorAll('button[data-id]')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(0, Math.min(items.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
      items.forEach((b, i) => b.classList.toggle('active', i === active));
      items[active]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      clearTimeout(timer);
      if (items[active]) items[active].click(); else if (items.length && results.classList.contains('open')) items[0].click(); else search();
    } else if (e.key === 'Escape') { results.classList.remove('open'); q.blur(); }
  });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.search')) results.classList.remove('open'); });
  results.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (!b) return;
    results.classList.remove('open');
    q.value = ''; q.blur();
    document.body.classList.remove('searching');
    openSong(Number(b.dataset.id));
  });
}

async function search() {
  const q = $('q').value.trim(), results = $('results');
  if (!q) return results.classList.remove('open');
  const my = ++seq;
  results.innerHTML = '<div class="note">Searching…</div>';
  results.classList.add('open');
  try {
    const r = await fetch('/api/search?q=' + encodeURIComponent(q)).then((r) => r.json());
    if (my !== seq) return;
    active = -1;
    let html = r.source === 'cache' ? `<div class="note">Songsterr is unreachable. Showing songs already on this Pi.</div>` : '';
    if (!r.results?.length) html += '<div class="note">No songs found.</div>';
    for (const s of r.results || []) {
      const roles = s.tracks.length;
      html += `<button data-id="${s.songId}"><span>${esc(s.title)}</span><span class="meta">${esc(s.artist)} · ${roles} track${roles === 1 ? '' : 's'}</span></button>`;
    }
    results.innerHTML = html;
  } catch (e) { results.innerHTML = `<div class="note">Search failed: ${esc(e.message)}</div>`; }
}
