// Practice panel: the loop you're working on, your best clean speed, and the speed trainer.
// A pass counts as clean unless you hit "Missed it" during it: honest, manual, no fake audio grading.
import * as store from './store.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const trainer = { on: false, from: 60, to: 100, step: 5, every: 2, streak: 0, passes: 0, missed: false };
let ctx = null; // { songId, spot, getSpeed, setSpeed, onClose, onProgress, toast }

export function open(c) {
  const sameSpot = ctx?.spot?.key === c.spot.key && ctx?.songId === c.songId;
  ctx = c;
  if (!sameSpot) { trainer.streak = 0; trainer.passes = 0; trainer.missed = false; }
  Object.assign(trainer, store.pref('trainer', {}), { streak: trainer.streak, passes: trainer.passes, missed: trainer.missed });
  if (trainer.on && !sameSpot) ctx.setSpeed(startSpeed() / 100);
  $('practice').hidden = false;
  draw();
}

export function close() { ctx = null; $('practice').hidden = true; }
export const isOpen = () => !!ctx;

// Resume from your best speed on this spot if you've already passed the start speed.
function startSpeed() {
  const best = store.song(ctx.songId).spots[ctx.spot.key]?.best || 0;
  return Math.min(trainer.to, Math.max(trainer.from, best));
}

/** Called once per completed loop pass. */
export function onPass() {
  if (!ctx) return;
  const speed = Math.round(ctx.getSpeed() * 100);
  trainer.passes++;
  if (trainer.missed) {
    trainer.streak = 0;
  } else {
    trainer.streak++;
    if (store.recordPass(ctx.songId, ctx.spot, speed) && trainer.passes > 1) ctx.toast(`New best on ${ctx.spot.label}: ${speed}%`);
    ctx.onProgress?.();
    if (trainer.on && trainer.streak >= trainer.every && speed < trainer.to) {
      const next = Math.min(trainer.to, speed + trainer.step);
      ctx.setSpeed(next / 100);
      trainer.streak = 0;
      ctx.toast(`Nice. Up to ${next}%`);
    } else if (trainer.on && speed >= trainer.to && trainer.streak === trainer.every) {
      ctx.toast(`${ctx.spot.label} at ${speed}%. Nailed it 🎉`);
    }
  }
  trainer.missed = false;
  draw();
}

export function missed() {
  if (!ctx) return;
  trainer.missed = true;
  draw();
  const b = $('pr-missed');
  b?.classList.add('flash');
}

const opts = (vals, cur, fmt = (v) => v) => vals.map((v) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${fmt(v)}</option>`).join('');

function draw() {
  if (!ctx) return;
  const s = store.song(ctx.songId).spots[ctx.spot.key];
  const best = s?.best || 0;
  const pct = (v) => `${v}%`;
  const dots = Array.from({ length: trainer.every }, (_, i) => `<i class="${i < trainer.streak ? 'ok' : ''}"></i>`).join('');
  $('practice').innerHTML = `
    <div class="pr-head">
      <div style="flex:1;min-width:0"><div class="lbl">Practicing</div><h3 title="${esc(ctx.spot.label)}">${esc(ctx.spot.label)}</h3></div>
      <button class="icon-btn" id="pr-close" title="Stop looping (Esc)" aria-label="Stop looping">✕</button>
    </div>
    <div class="pr-best"><span>Best clean</span><div class="meter"><i style="width:${Math.min(100, best)}%"></i></div><b>${best ? pct(best) : '—'}</b></div>
    <div class="trainer">
      <label class="switch"><input type="checkbox" id="tr-on" ${trainer.on ? 'checked' : ''}> Speed trainer</label>
      <div class="trainer-cfg" ${trainer.on ? '' : 'hidden'}>
        <span>From</span><select id="tr-from" aria-label="Start speed">${opts([40, 50, 60, 70, 80, 90], trainer.from, pct)}</select>
        <span>to</span><select id="tr-to" aria-label="Target speed">${opts([80, 90, 100, 110, 120], trainer.to, pct)}</select>
        <span>Step</span><select id="tr-step" aria-label="Step">${opts([2, 5, 10], trainer.step, (v) => `+${v}%`)}</select>
        <span>after</span><select id="tr-every" aria-label="Clean passes per step">${opts([1, 2, 3, 4], trainer.every, (v) => `${v} clean`)}</select>
      </div>
    </div>
    <div class="pr-status">
      <span class="pass">Pass <b>${trainer.passes + 1}</b>${trainer.on ? `<span class="dots" title="Clean passes toward the next step">${dots}</span>` : ''}</span>
      <button class="btn missed ${trainer.missed ? 'flash' : ''}" id="pr-missed" title="Don't count this pass (A)">✗ Missed it</button>
    </div>`;
  $('pr-close').onclick = () => ctx.onClose();
  $('pr-missed').onclick = missed;
  $('tr-on').onchange = (e) => { trainer.on = e.target.checked; trainer.streak = 0; if (trainer.on) ctx.setSpeed(startSpeed() / 100); saveCfg(); draw(); };
  for (const k of ['from', 'to', 'step', 'every']) {
    const el = $(`tr-${k}`);
    if (el) el.onchange = () => { trainer[k] = Number(el.value); if (k === 'from') ctx.setSpeed(startSpeed() / 100); saveCfg(); draw(); };
  }
}

function saveCfg() {
  const { on, from, to, step, every } = trainer;
  store.setPref('trainer', { on, from, to, step, every });
}

export function refresh() { draw(); }
