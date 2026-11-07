// Track classification and naming shared by the converter and the API.
// Songsterr track names look like "Player | Gear | Part"; band members only care about the part.

// A segment counts as a part name only if every word is part vocabulary, so gear like "Fender Precision Bass" doesn't.
const PART_VOCAB = new Set(('lead rhythm backing main vocal vocals voice voices choir harmony harmonies guitar guitars bass drums drum kit ' +
  'percussion loop loops claps hand keys keyboard keyboards piano synth synths organ pad pads solo string strings horn horns brass sax ' +
  'trumpet violin cello banjo mandolin ukulele harmonica acoustic electric clean distorted extra extras overdub overdubs fx effects ' +
  'left right double doubled 12-string high low part').split(' '));
const isPartName = (seg) => seg.toLowerCase().replace(/[()]/g, ' ').split(/\s+/).filter(Boolean).every((w) => PART_VOCAB.has(w) || /^\d+$/.test(w));
const ROLE_LABEL = { drums: 'Drums', vocals: 'Vocals', bass: 'Bass', guitar: 'Guitar', keys: 'Keys' };

export const isDrumTrack = (t) => t.instrumentId === 1024 || /drum|percussion/i.test(t.instrument || '');

/** One of: drums, vocals, bass, guitar, keys, other */
export function roleOf(t) {
  const id = t.instrumentId ?? -1;
  if (isDrumTrack(t)) return 'drums';
  if (t.isVocalTrack || /vocal|voice/i.test(t.name || '')) return 'vocals';
  if (id >= 32 && id <= 39) return 'bass';
  if (id >= 24 && id <= 31) return 'guitar';
  if ((id >= 0 && id <= 7) || (id >= 16 && id <= 23) || (id >= 80 && id <= 95)) return 'keys';
  return 'other';
}

/** Clean part names for every track of a song, numbering duplicates ("Lead Guitar 1", "Lead Guitar 2"). */
export function partNames(tracks) {
  const names = tracks.map((t) => {
    const seg = String(t.name || '').split('|').map((s) => s.trim()).filter(Boolean);
    let n = seg.at(-1);
    // With fewer than 3 segments the last one may be a player or gear ("Randy Meisner | Rickenbacker 4001s Bass").
    if (seg.length < 3 && n && !isPartName(n)) n = null;
    return n || ROLE_LABEL[roleOf(t)] || t.instrument || 'Track';
  });
  const total = {}, seen = {};
  for (const n of names) total[n] = (total[n] || 0) + 1;
  return names.map((n) => (total[n] > 1 ? `${n} ${(seen[n] = (seen[n] || 0) + 1)}` : n));
}

/**
 * Songsterr tunings are normally high→low (string 0 = tuning[0] = highest). A few tracks store them low→high;
 * note string indices still point into the stored array, so callers that flip the tuning must flip strings too.
 */
export const isLowToHigh = (tuning) => Array.isArray(tuning) && tuning.length > 1 && tuning[0] < tuning.at(-1);
export const displayTuning = (tuning) => (isLowToHigh(tuning) ? [...tuning].reverse() : tuning);
