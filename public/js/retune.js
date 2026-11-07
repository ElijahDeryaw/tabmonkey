// Retune: play a song in another key and/or on a guitar tuned differently from the tab, and re-finger the part.
//
// Two settings:
// - song shift k (per song): everything sounds k semitones away from the recording.
// - your tuning (per player, persists across songs because your instrument stays tuned that way):
//   null = "tuned like the tab" (your strings follow the tab's tuning, shifted with the song, so shapes don't change),
//   or an explicit tuning (E standard, D standard, Drop D, ...).
//
// When the strings you have don't match what the tab expects, the part is re-fingered with a Viterbi search
// (the "optimum path" formulation of guitar fingering; Sayegh 1989, Radisavljevic & Driessen 2004). Every note gets
// candidate (string, fret) positions; each beat's chord gets candidate voicings on distinct strings; the cheapest
// path through all beats wins. Costs keep the result close to the original tab and comfortable to play:
//   - moving a note off its original string, or up/down an octave (only when a pitch has no position at all)
//   - hand movement between beats, and chord stretch
//   - hammer-ons, pull-offs and slides must stay on one string; tied notes must stay put
//   - no bends/vibrato on open strings
/* global alphaTab */

const STANDARD = {
  guitar: { 6: [64, 59, 55, 50, 45, 40], 7: [64, 59, 55, 50, 45, 40, 35], 8: [64, 59, 55, 50, 45, 40, 35, 30] },
  bass: { 4: [43, 38, 33, 28], 5: [43, 38, 33, 28, 23], 6: [48, 43, 38, 33, 28, 23] },
};
const MAX_FRET = 24;
const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const pc = (m) => ((m % 12) + 12) % 12;

/** Tunings offered for "your guitar": standard from a whole step up to 5 down, plus drop variants. */
export function tuningOptions(role, strings) {
  const base = STANDARD[role === 'bass' ? 'bass' : 'guitar'][strings];
  if (!base) return [];
  const out = [];
  for (let g = 2; g >= -5; g--) out.push({ key: `${g}|0`, g, drop: false, label: `${NAMES[pc(base.at(-1) + g)]} standard`, tuning: base.map((p) => p + g) });
  for (let g = 0; g >= -4; g--) out.push({ key: `${g}|1`, g, drop: true, label: `Drop ${NAMES[pc(base.at(-1) + g - 2)]}`, tuning: base.map((p, i) => p + g - (i === base.length - 1 ? 2 : 0)) });
  return out;
}

export function tuningFor(choice, role, strings) {
  if (!choice) return null;
  const opt = tuningOptions(role, strings).find((o) => o.key === choice);
  return opt?.tuning ?? null;
}

/** Remember each note's original string/fret and each staff's tuning, once per loaded score. */
export function snapshot(score) {
  for (const track of score.tracks) for (const staff of track.staves) {
    if (staff.isPercussion || !staff.tuning?.length) continue;
    staff._origTuning ??= [...staff.tuning];
    staff._origCapo ??= staff.capo || 0;
    for (const bar of staff.bars) for (const v of bar.voices) for (const b of v.beats) for (const n of b.notes) n._orig ??= { string: n.string, fret: n.fret };
  }
}

export function restore(staff) {
  if (!staff._origTuning) return;
  staff.stringTuning.tunings = [...staff._origTuning];
  staff.capo = staff._origCapo;
  for (const bar of staff.bars) for (const v of bar.voices) for (const b of v.beats) {
    for (const n of b._dropped ?? []) b.addNote(n);
    b._dropped = null;
    for (const n of b.notes) if (n._orig) { n.string = n._orig.string; n.fret = n._orig.fret; }
    reindex(b);
  }
}

function reindex(beat) {
  beat.notes.sort((a, b) => a.string - b.string);
  beat.notes.forEach((n, i) => { n.index = i; });
  beat.noteStringLookup.clear();
  for (const n of beat.notes) beat.noteStringLookup.set(n.string, n);
}

/**
 * Re-finger one staff so that every note sounds `shift` semitones from the original, on strings tuned `target`
 * (high → low, alphaTab order). Returns stats { moved, octave, dropped, capo, total }.
 */
export function refret(staff, shift, target, { allowCapo = true } = {}) {
  restore(staff);
  const written = staff._origTuning;
  const S = written.length;
  const capo0 = staff._origCapo || 0;
  const stats = { moved: 0, octave: 0, dropped: 0, capo: capo0, total: 0 };
  if (target.length !== S) return stats;
  staff.stringTuning.tunings = [...target];
  // If every string is off by the same amount, a capo keeps the exact shapes: move an existing capo, or (when
  // allowed) add one for upward shifts. That's how a player would do it, and it beats any re-fingering.
  const offsets = target.map((p, i) => written[i] + shift - p);
  if (offsets.every((o) => o === offsets[0])) {
    const c = capo0 + offsets[0];
    if (offsets[0] === 0 || (c >= 0 && c <= 12 && (allowCapo || (capo0 > 0 && c < capo0)))) { staff.capo = c; stats.capo = c; return stats; }
  }
  const openOf = (tuning, s) => tuning[S - s] + capo0; // alphaTab string numbers: 1 = lowest

  for (const bar of staff.bars) for (const v of bar.voices) for (const b of v.beats) stats.total += b.notes.length;
  for (let vi = 0; ; vi++) {
    const beats = [];
    for (const bar of staff.bars) { const v = bar.voices[vi]; if (v) for (const b of v.beats) if (b.notes.length) beats.push(b); }
    if (!beats.length && vi > 0) break;
    if (beats.length) solveVoice(beats, (n) => openOf(written, n._orig.string) + n._orig.fret + shift, (s) => openOf(target, s), S, stats);
    if (vi > 8) break;
  }
  return stats;
}

function candidatesFor(note, pitch, openOf, S) {
  const out = [];
  if (note.isDead || note.isPercussion) {
    // A muted note has no pitch to keep: stay on the same string, nearest playable fret.
    const f = Math.max(0, Math.min(MAX_FRET, pitch - openOf(note._orig.string)));
    return [{ s: note._orig.string, f, oct: 0, cost: 0 }];
  }
  for (const oct of [0, 12, -12, 24, -24]) {
    for (let s = 1; s <= S; s++) {
      const f = pitch + oct - openOf(s);
      if (f < 0 || f > MAX_FRET) continue;
      let cost = 0;
      if (s !== note._orig.string) cost += 4 + Math.abs(s - note._orig.string) * 0.5;
      if (oct) cost += 10 * Math.abs(oct) / 12;
      if (f === 0 && (note.hasBend || note.vibrato || note.slideOutType || note.slideInType || note.isHammerPullOrigin || note.isHammerPullDestination)) cost += 12;
      if (note.isHarmonic && s !== note._orig.string) cost += 6;
      out.push({ s, f, oct, cost });
    }
    if (out.length) break; // only reach for an octave when the pitch has no position at all
  }
  return out.sort((a, b) => a.cost - b.cost).slice(0, 4);
}

// All voicings of a chord on distinct strings, cheapest first. Notes with no position at all are dropped.
function voicings(notes, cands, pitches) {
  const order = notes.map((_, i) => i).sort((a, b) => cands[a].length - cands[b].length);
  const results = [];
  const cur = new Array(notes.length);
  const used = new Set();
  const rec = (k, cost) => {
    if (results.length > 400) return;
    if (k === order.length) { results.push({ pos: cur.slice(), cost: cost + chordCost(cur) }); return; }
    const i = order[k];
    if (!cands[i].length) { cur[i] = null; rec(k + 1, cost); return; }
    for (const c of cands[i]) {
      if (used.has(c.s)) continue;
      used.add(c.s); cur[i] = c;
      rec(k + 1, cost + c.cost);
      used.delete(c.s);
    }
  };
  rec(0, 0);
  if (!results.length) {
    // More notes than the strings can hold: drop a note whose pitch class is already in the chord (an octave
    // double), else the highest note, and try again.
    const live = notes.map((_, i) => i).filter((i) => cands[i].length);
    const dupe = live.find((i) => live.some((j) => j !== i && pc(pitches[j]) === pc(pitches[i]) && pitches[j] < pitches[i]));
    const drop = dupe ?? live.reduce((a, i) => (pitches[i] > pitches[a] ? i : a), live[0]);
    const reduced = cands.map((c, i) => (i === drop ? [] : c));
    return voicings(notes, reduced, pitches).map((v) => ({ ...v, cost: v.cost + 15 }));
  }
  return results.sort((a, b) => a.cost - b.cost).slice(0, 48);
}

function chordCost(pos) {
  const frets = pos.filter((p) => p && p.f > 0).map((p) => p.f);
  if (!frets.length) return 0;
  const span = Math.max(...frets) - Math.min(...frets);
  return (span > 4 ? (span - 4) * 3 : 0) + (span > 6 ? 20 : 0) + (frets.reduce((a, b) => a + b, 0) / frets.length) * 0.03;
}

const handPos = (pos) => { const f = pos.filter((p) => p && p.f > 0).map((p) => p.f); return f.length ? Math.min(...f) : null; };

function solveVoice(beats, pitchOf, openOf, S, stats) {
  const layers = beats.map((b) => {
    const notes = b.notes.slice();
    const pitches = notes.map(pitchOf);
    const cands = notes.map((n, i) => candidatesFor(n, pitches[i], openOf, S));
    return { beat: b, notes, states: voicings(notes, cands, pitches) };
  });

  // Viterbi
  let prev = layers[0].states.map((st) => ({ cost: st.cost, back: -1 }));
  const backs = [prev];
  for (let t = 1; t < layers.length; t++) {
    const A = layers[t - 1], B = layers[t];
    const cur = B.states.map((st) => {
      let best = Infinity, arg = 0;
      const hb = handPos(st.pos);
      for (let j = 0; j < A.states.length; j++) {
        const pj = A.states[j];
        let c = prev[j].cost + st.cost;
        const ha = handPos(pj.pos);
        if (ha != null && hb != null) { const d = Math.abs(hb - ha); c += d * 0.5 + (d > 4 ? d - 4 : 0); }
        // Ties stay put; legato (hammer/pull/slide) stays on one string.
        B.notes.forEach((n, i) => {
          const p = st.pos[i];
          if (!p) return;
          if (n.isTieDestination && n.tieOrigin) {
            const k = A.notes.indexOf(n.tieOrigin);
            if (k >= 0 && pj.pos[k] && (pj.pos[k].s !== p.s || pj.pos[k].f !== p.f)) c += 1000;
          }
          const src = A.notes.findIndex((m) => m._orig.string === n._orig.string && (m.isHammerPullOrigin || m.slideOutType));
          if (src >= 0 && pj.pos[src] && pj.pos[src].s !== p.s) c += 15;
        });
        if (c < best) { best = c; arg = j; }
      }
      return { cost: best, back: arg };
    });
    backs.push(cur);
    prev = cur;
  }

  // Trace back and write the chosen positions.
  let k = prev.reduce((bi, s, i, arr) => (s.cost < arr[bi].cost ? i : bi), 0);
  for (let t = layers.length - 1; t >= 0; t--) {
    const { beat, notes, states } = layers[t];
    const st = states[k];
    if (st) {
      const dropped = [];
      notes.forEach((n, i) => {
        const p = st.pos[i];
        if (!p) { dropped.push(n); return; }
        if (p.s !== n._orig.string) stats.moved++;
        if (p.oct) stats.octave++;
        n.string = p.s; n.fret = p.f;
      });
      for (const n of dropped) { beat.removeNote(n); stats.dropped++; }
      beat._dropped = dropped.length ? dropped : null;
      reindex(beat);
    }
    k = backs[t][k]?.back ?? 0;
  }
}
