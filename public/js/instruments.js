// What you play → which track is yours, and human tuning names ("Drop D", "½ step down").
export const INSTRUMENTS = [
  { id: 'guitar', label: 'Guitar' },
  { id: 'bass', label: 'Bass' },
  { id: 'drums', label: 'Drums' },
  { id: 'vocals', label: 'Vocals' },
  { id: 'keys', label: 'Keys' },
];

/**
 * Pick the track to show for this person: last choice for this song, else the most viewed track for their
 * instrument, else Songsterr's default.
 */
export function pickTrack(info, instrument, remembered) {
  const loaded = info.tracks.filter((t) => t.loaded);
  if (remembered != null && loaded.some((t) => t.index === remembered)) return remembered;
  const mine = loaded.filter((t) => t.role === instrument).sort((a, b) => (b.views || 0) - (a.views || 0));
  if (mine.length) return mine.find((t) => t.index === info.defaultTrack)?.index ?? mine[0].index;
  return loaded.find((t) => t.index === info.defaultTrack)?.index ?? loaded[0]?.index ?? 0;
}

const NOTES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const STANDARD = {
  guitar: { 6: [64, 59, 55, 50, 45, 40], 7: [64, 59, 55, 50, 45, 40, 35], 8: [64, 59, 55, 50, 45, 40, 35, 30] },
  bass: { 4: [43, 38, 33, 28], 5: [43, 38, 33, 28, 23], 6: [48, 43, 38, 33, 28, 23] },
};
const note = (m) => NOTES[((m % 12) + 12) % 12];

/** { name, notes, standard } for a high→low MIDI tuning, or null for drums/vocals. */
export function describeTuning(tuning, role) {
  if (!tuning?.length || role === 'drums' || role === 'vocals') return null;
  const notes = [...tuning].reverse().map(note).join(' ');
  const std = STANDARD[role === 'bass' ? 'bass' : 'guitar'][tuning.length];
  if (!std) return { name: notes, notes, standard: false };
  const d = tuning.map((m, i) => m - std[i]);
  const pc = d.map((x) => ((x % 12) + 12) % 12);
  const n = d.length - 1;
  if (pc.every((x) => x === 0)) return { name: 'Standard', notes, standard: true };
  const allSame = d.every((x) => x === d[0]);
  const dropped = d.slice(0, n).every((x) => x === d[0]) && d[n] === d[0] - 2;
  const shift = { '-1': '½ step down', '-2': '1 step down', 1: '½ step up' }[d[0]];
  if (allSame) return { name: shift ?? `${note(tuning[n])} standard`, notes, standard: false };
  if (dropped) return { name: `Drop ${note(tuning[n])}${d[0] ? ` (${shift ?? `${note(tuning[0])} std`})` : ''}`, notes, standard: false };
  return { name: notes, notes, standard: false };
}
