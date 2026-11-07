// Practice strip: what you're looping, your best clean tempo there, and the tempo trainer.
// A pass counts as clean unless you mark it missed. Honest and manual; no fake audio grading.
import * as store from './store.js';
import { $, esc, icon } from './ui.js';

export const trainer = { on: false, from: 60, to: 100, step: 5, every: 2, streak: 0, passes: 0, missed: false };
let ctx = null; // { songId, spot, getSpeed, setSpeed, onClose, onProgress, toast }

export function open(c) {
  const same = ctx?.songId === c.songId && ctx?.spot?.key === c.spot.key;
  ctx = c;
  Object.assign(trainer, store.pref('trainer', {}));
  if (!same) { trainer.streak = 0; trainer.passes = 0; trainer.missed = false; if (trainer.on) ctx.setSpeed(startSpeed() / 100); }
  $('practice').hidden = false;
  draw();
}
export function close() { ctx = null; $('practice').hidden = true; }

const best = () => store.song(ctx.songId).spots[ctx.spot.key]?.best || 0;
// Start at the trainer's floor, or where you got to last time if that's higher.
const startSpeed = () => Math.min(trainer.to, Math.max(trainer.from, best()));

export function onPass() {
  if (!ctx) return;
  const speed = Math.round(ctx.getSpeed() * 100);
  trainer.passes++;
  if (trainer.missed) {
    trainer.streak = 0;
  } else {
    trainer.streak++;
    const improved = store.recordPass(ctx.songId, ctx.spot, speed);
    ctx.onProgress?.();
    if (trainer.on && trainer.streak >= trainer.every && speed < trainer.to) {
      const next = Math.min(trainer.to, speed + trainer.step);
      ctx.setSpeed(next / 100);
      trainer.streak = 0;
      ctx.toast(`Tempo up to ${next}%`);
    } else if (improved && trainer.passes > 1) {
      ctx.toast(`New best: ${speed}%`);
    }
  }
  trainer.missed = false;
  draw();
}

export function missed() {
  if (!ctx) return;
  trainer.missed = !trainer.missed;
  draw();
}

const opts = (vals, cur, fmt) => vals.map((v) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${fmt(v)}</option>`).join('');
const pct = (v) => `${v}%`;

function draw() {
  if (!ctx) return;
  const b = best();
  const { spot } = ctx;
  const range = spot.start === spot.end ? `bar ${spot.start + 1}` : `bars ${spot.start + 1}–${spot.end + 1}`;
  const pips = Array.from({ length: trainer.every }, (_, i) => `<i class="${i < trainer.streak ? 'on' : ''}"></i>`).join('');
  $('practice').innerHTML = `
    <div class="pr-what"><b>${esc(spot.label)}</b>${spot.label.startsWith('Bar') ? '' : `<span class="meta">${range}</span>`}</div>
    <div class="pr-sep"></div>
    <div class="pr-group">Best <b>${b ? pct(b) : '—'}</b></div>
    <div class="pr-sep"></div>
    <div class="pr-group">
      <label><input type="checkbox" class="switch" id="tr-on" ${trainer.on ? 'checked' : ''}>Tempo trainer</label>
      ${trainer.on ? `
        <select class="mini-select" id="tr-from" aria-label="Start tempo">${opts([40, 50, 60, 70, 80, 90], trainer.from, pct)}</select>
        to <select class="mini-select" id="tr-to" aria-label="Target tempo">${opts([80, 90, 100, 110, 120], trainer.to, pct)}</select>
        by <select class="mini-select" id="tr-step" aria-label="Step">${opts([2, 5, 10], trainer.step, pct)}</select>
        every <select class="mini-select" id="tr-every" aria-label="Clean passes per step">${opts([1, 2, 3, 4], trainer.every, (v) => `${v} clean`)}</select>` : ''}
    </div>
    <div class="pr-end">
      <span class="pr-group">Pass <b>${trainer.passes + 1}</b>${trainer.on ? `<span class="pips" title="Clean passes toward the next step">${pips}</span>` : ''}</span>
      <button class="btn toggle" id="pr-missed" aria-pressed="${trainer.missed}" title="Don't count this pass (A)">Missed it</button>
      <button class="btn icon ghost" id="pr-close" title="Stop looping (Esc)" aria-label="Stop looping">${icon('x')}</button>
    </div>`;
  $('pr-close').onclick = () => ctx.onClose();
  $('pr-missed').onclick = missed;
  $('tr-on').onchange = (e) => { trainer.on = e.target.checked; trainer.streak = 0; if (trainer.on) ctx.setSpeed(startSpeed() / 100); save(); draw(); };
  for (const k of ['from', 'to', 'step', 'every']) {
    const el = $(`tr-${k}`);
    if (el) el.onchange = () => { trainer[k] = Number(el.value); if (k === 'from') ctx.setSpeed(startSpeed() / 100); save(); draw(); };
  }
}

function save() {
  const { on, from, to, step, every } = trainer;
  store.setPref('trainer', { on, from, to, step, every });
}
export const refresh = draw;
