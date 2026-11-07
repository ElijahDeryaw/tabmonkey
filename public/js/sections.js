// Song sections (Intro, Verse, Chorus…) from the score's markers: the main way to move around and practice.

/** [{ key, label, start, end }] with 0-based inclusive bar indexes. Unmarked songs get 8-bar chunks. */
export function buildSections(score) {
  const bars = score.masterBars;
  const marks = bars.map((mb, i) => (mb.section ? { i, text: (mb.section.text || mb.section.marker || '').trim() } : null)).filter(Boolean);
  let out;
  if (marks.length) {
    out = marks.map((m, k) => ({ start: m.i, end: (marks[k + 1]?.i ?? bars.length) - 1, label: m.text || `Part ${k + 1}` }));
    if (out[0].start > 0) out.unshift({ start: 0, end: out[0].start - 1, label: 'Start' });
  } else {
    out = [];
    for (let s = 0; s < bars.length; s += 8) out.push({ start: s, end: Math.min(bars.length, s + 8) - 1, label: `Bars ${s + 1}–${Math.min(bars.length, s + 8)}` });
  }
  // Number repeated names so each chip is distinguishable: Chorus, Chorus 2, Chorus 3.
  const seen = {};
  for (const s of out) {
    const n = (seen[s.label] = (seen[s.label] || 0) + 1);
    if (n > 1) s.label = `${s.label} ${n}`;
    s.key = `s:${s.start}`;
  }
  return out;
}

export const sectionAt = (sections, bar) => sections.findIndex((s) => bar >= s.start && bar <= s.end);

/** A spot is what you practice: a section, a run of sections, or a dragged bar range. */
export function spotFor(sections, start, end) {
  const a = sections.find((s) => s.start === start), b = sections.find((s) => s.end === end);
  if (a && b) {
    if (a === b) return { key: a.key, label: a.label, start, end };
    return { key: `r:${start}-${end}`, label: `${a.label} → ${b.label}`, start, end };
  }
  return { key: `b:${start}-${end}`, label: start === end ? `Bar ${start + 1}` : `Bars ${start + 1}–${end + 1}`, start, end };
}
