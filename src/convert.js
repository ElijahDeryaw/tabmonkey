// Converts Songsterr per-track revision JSON into an alphaTab Score, then to Guitar Pro 7 bytes.
import * as alphaTab from '@coderline/alphatab';
import { isDrumTrack, roleOf, partNames, isLowToHigh } from './tracks.js';

const M = alphaTab.model;

/** Bump when conversion output changes, so cached .gp files on disk are rebuilt. */
export const CONVERTER_VERSION = 7;

const SLIDE_OUT = {
  shift: M.SlideOutType.Shift,
  legato: M.SlideOutType.Legato,
  downwards: M.SlideOutType.OutDown,
  upwards: M.SlideOutType.OutUp,
};
const SLIDE_IN = { below: M.SlideInType.IntoFromBelow, above: M.SlideInType.IntoFromAbove };
const HARMONIC = {
  natural: M.HarmonicType.Natural, artificial: M.HarmonicType.Artificial, pinch: M.HarmonicType.Pinch,
  tap: M.HarmonicType.Tap, semi: M.HarmonicType.Semi, feedback: M.HarmonicType.Feedback,
};
const VIBRATO = { slight: M.VibratoType.Slight, wide: M.VibratoType.Wide };
const GRACE = { onBeat: M.GraceType.OnBeat, beforeBeat: M.GraceType.BeforeBeat };
const WAH = { open: M.WahPedal.Open, closed: M.WahPedal.Closed };
const CRESC = { crescendo: M.CrescendoType.Crescendo, decrescendo: M.CrescendoType.Decrescendo };
const DYN = {
  ppp: M.DynamicValue.PPP, pp: M.DynamicValue.PP, p: M.DynamicValue.P, mp: M.DynamicValue.MP,
  mf: M.DynamicValue.MF, f: M.DynamicValue.F, ff: M.DynamicValue.FF, fff: M.DynamicValue.FFF,
};
const TUPLET_DEN = { 3: 2, 5: 4, 6: 4, 7: 4, 9: 8, 10: 8, 11: 8, 12: 8, 13: 8 };
const DURATIONS = new Set([1, 2, 4, 8, 16, 32, 64, 128, 256]);

// Songsterr bend/whammy "tone": 100 = one whole tone. alphaTab BendPoint value: quarter tones (4 = whole tone).
// Songsterr position runs 0..60, the same scale as alphaTab's BendPoint offset.
// alphaTab doesn't export its GP7 percussion table; resolve an articulation id by parsing a one-note alphaTex drum track.
const ARTICULATIONS = new Map();
function lookupArticulation(id) {
  if (!ARTICULATIONS.has(id)) {
    let art = null;
    try {
      const imp = new alphaTab.importer.AlphaTexImporter();
      imp.initFromString(String.raw`\track "D" \instrument percussion` + '\n:4 ' + id, new alphaTab.Settings());
      art = imp.readScore().tracks[0].percussionArticulations[0] ?? null;
    } catch { /* unknown id */ }
    ARTICULATIONS.set(id, art);
  }
  return ARTICULATIONS.get(id);
}

// Exact duplicate points (common in Songsterr whammy curves) are dropped so GP7 export keeps the shape.
const toBendPoints = (points) => {
  const out = [];
  for (const p of points) {
    const offset = Math.max(0, Math.min(60, Math.round(p.position)));
    const value = Math.round(p.tone / 25);
    const last = out[out.length - 1];
    if (last && last.offset === offset && last.value === value) continue;
    out.push(new M.BendPoint(offset, value));
  }
  return out;
};

/**
 * @param {object} meta   Songsterr /api/meta/{id} response
 * @param {object[]} parts Decoded revision JSON, one per track (null entries are skipped)
 */
export function songsterrToScore(meta, parts) {
  const settings = new alphaTab.Settings();
  const valid = parts.filter(Boolean);
  if (!valid.length) throw new Error('No track data');
  // Resolve drum articulations up front: alphaTab's importer resets the global model id counters,
  // so it must not run while we are creating Bars/Voices/Beats (that yields duplicate ids in GP7 export).
  for (const part of valid)
    if (isDrumTrack(part))
      for (const m of part.measures) for (const v of m.voices || []) for (const b of v.beats || [])
        for (const n of b.notes || []) if (!n.rest) lookupArticulation(n.fret);
  const score = new M.Score();
  score.title = meta.title || 'Untitled';
  score.artist = meta.artist || '';
  score.tab = meta.author?.name ? `Songsterr rev ${meta.revisionId} by ${meta.author.name}` : '';
  const barCount = Math.max(...valid.map((p) => p.measures.length));
  const ref = valid.reduce((a, b) => (b.measures.length > a.measures.length ? b : a));

  // --- Master bars (shared across tracks): time sig, key, markers, repeats, tempo
  let num = 4, den = 4, key = 0, minor = false;
  const keys = [];
  for (let i = 0; i < barCount; i++) {
    const m = ref.measures[i] || {};
    const mb = new M.MasterBar();
    if (m.signature) [num, den] = m.signature;
    mb.timeSignatureNumerator = num;
    mb.timeSignatureDenominator = den;
    if (m.keySignature) {
      key = m.keySignature.accidentalCount ?? key;
      if (m.keySignature.transposeAs === 'b' && key > 0) key = -key;
      minor = m.keySignature.mode === 'minor';
    }
    keys.push([key, minor ? M.KeySignatureType.Minor : M.KeySignatureType.Major]);
    if (m.marker?.text) {
      mb.section = new M.Section();
      mb.section.text = m.marker.text;
    }
    // Repeats / voltas (field names as used by Songsterr's editor; absent in many songs)
    if (m.repeatStart) mb.isRepeatStart = true;
    if (m.repeatClose || m.repeatEnd) mb.repeatCount = Number(m.repeatClose ?? m.repeatEnd) > 1 ? Number(m.repeatClose ?? m.repeatEnd) : 2;
    if (Array.isArray(m.alternateEnding)) mb.alternateEndings = m.alternateEnding.reduce((acc, n) => acc | (1 << (n - 1)), 0);
    if (m.doubleBar) mb.isDoubleBar = true;
    if (i === 0 && ref.anacrusis) mb.isAnacrusis = true;
    score.addMasterBar(mb);
  }
  const tempos = ref.automations?.tempo?.length ? ref.automations.tempo : [{ measure: 0, position: 0, bpm: 120 }];
  for (const t of tempos) {
    const mb = score.masterBars[t.measure];
    if (!mb) continue;
    const ratio = t.position ? t.position / (mb.timeSignatureNumerator * (4 / mb.timeSignatureDenominator)) : 0;
    mb.tempoAutomations.push(M.Automation.buildTempoAutomation(false, Math.min(1, ratio), t.bpm, 2));
  }

  // --- Tracks
  const pendingLyrics = [];
  let channel = 0;
  const nextChannel = () => { if (channel === 9) channel++; return channel++; };
  const metaTracks = parts.map((p, i) => ({ ...p, ...meta.tracks?.[i] }));
  const names = partNames(metaTracks);
  const mix = defaultMix(metaTracks, names);
  for (const [pi, part] of parts.entries()) {
    if (!part) continue;
    const track = new M.Track();
    track.name = names[pi];
    track.shortName = names[pi].slice(0, 10);
    track.ensureStaveCount(1);
    const staff = track.staves[0];
    const isDrums = isDrumTrack(part);
    const flip = !isDrums && isLowToHigh(part.tuning);

    if (isDrums) {
      staff.isPercussion = true;
      staff.showTablature = false;
      track.playbackInfo.primaryChannel = 9;
      track.playbackInfo.secondaryChannel = 9;
      track.playbackInfo.program = 0;
    } else {
      const tuning = part.tuning || [64, 59, 55, 50, 45, 40];
      staff.stringTuning = new M.Tuning('', flip ? [...tuning].reverse() : tuning, false);
      if (part.capo) staff.capo = part.capo;
      const program = mix[pi].program ?? part.instrumentId ?? 25;
      // GM 97 (FX Soundtrack) makes alphaTab's synth emit NaN with GeneralUser GS, which silences every track;
      // 101 (FX Goblins) is silent. Both are rare; play them as a warm pad instead.
      track.playbackInfo.program = program === 97 || program === 101 ? 89 : program;
      track.playbackInfo.primaryChannel = nextChannel();
      track.playbackInfo.secondaryChannel = nextChannel();
    }
    track.playbackInfo.volume = Math.round(Math.min(1, part.volume ?? 1) * mix[pi].volume);
    track.playbackInfo.balance = part.balance ? Math.round(8 + part.balance * 8) : mix[pi].balance;
    score.addTrack(track);

    // Drums: Songsterr "fret" = Guitar Pro articulation id. Register each used id on the track.
    const artIndex = new Map();
    const articulationFor = (id) => {
      if (!artIndex.has(id)) {
        const a = lookupArticulation(id);
        if (!a) return -1;
        artIndex.set(id, track.percussionArticulations.length);
        track.percussionArticulations.push(a);
      }
      return artIndex.get(id);
    };

    const stringCount = part.strings || staff.tuning.length || 6;
    const lastFret = new Map(); // voice:string -> fret, for tied notes lacking a fret
    const maxVoices = Math.max(1, ...part.measures.map((m) => m.voices?.length || 0));
    for (let i = 0; i < barCount; i++) {
      const bar = new M.Bar();
      staff.addBar(bar);
      [bar.keySignature, bar.keySignatureType] = keys[i];
      if (isDrums) { bar.clef = M.Clef.Neutral; bar.keySignature = 0; }
      else if (part.instrumentId >= 32 && part.instrumentId <= 39) bar.clef = M.Clef.F4; // bass
      // Every bar of a staff needs the same voice count, so pad with empty (rest) voices.
      const voices = Array.from({ length: maxVoices }, (_, vi) => part.measures[i]?.voices?.[vi] ?? { rest: true, beats: [] });
      voices.forEach((v, vi) => {
        const voice = new M.Voice();
        bar.addVoice(voice);
        for (const b of v.beats || []) {
          const beat = new M.Beat();
          voice.addBeat(beat);
          beat.duration = DURATIONS.has(b.type) ? b.type : M.Duration.Quarter;
          beat.dots = b.dots || 0;
          if (b.tuplet) {
            beat.tupletNumerator = b.tuplet;
            beat.tupletDenominator = TUPLET_DEN[b.tuplet] ?? 2 ** Math.floor(Math.log2(b.tuplet));
          }
          if (b.graceNote) beat.graceType = GRACE[b.graceNote] ?? M.GraceType.BeforeBeat;
          if (b.text?.text) beat.text = b.text.text;
          if (b.wahwah) beat.wahPedal = WAH[b.wahwah] ?? M.WahPedal.None;
          if (b.gradualVelocity) beat.crescendo = CRESC[b.gradualVelocity] ?? M.CrescendoType.None;
          if (b.velocity && DYN[b.velocity] !== undefined) beat.dynamics = DYN[b.velocity];
          if (b.vibratoWithTremoloBar) beat.vibrato = VIBRATO[b.vibratoWithTremoloBar] ?? M.VibratoType.Slight;
          if (b.tremoloBar?.points?.length) {
            beat.whammyBarType = M.WhammyType.Custom;
            for (const p of toBendPoints(b.tremoloBar.points)) beat.addWhammyBarPoint(p);
          }
          if (b.upStroke) beat.pickStroke = M.PickStroke.Up;
          if (b.downStroke) beat.pickStroke = M.PickStroke.Down;
          if (b.tap) beat.tap = true;
          if (b.slap) beat.slap = true;
          if (b.pop) beat.pop = true;
          if (b.rest) continue;

          for (const n of b.notes || []) {
            if (n.rest) continue;
            const note = new M.Note();
            if (isDrums) {
              const idx = articulationFor(n.fret);
              if (idx < 0) continue;
              note.percussionArticulation = idx;
            } else {
              const s = flip ? stringCount - 1 - Math.round(n.string) : Math.round(n.string);
              note.string = stringCount - s; // Songsterr 0 = highest string; alphaTab 1 = lowest
              const k = `${vi}:${s}`;
              note.fret = n.fret ?? (n.tie ? lastFret.get(k) ?? 0 : 0);
              lastFret.set(k, note.fret);
            }
            if (n.tie) note.isTieDestination = true;
            if (n.dead) note.isDead = true;
            if (n.ghost) note.isGhost = true;
            if (n.staccato) note.isStaccato = true;
            if (n.accentuated) note.accentuated = n.accentuated === 2 ? M.AccentuationType.Heavy : M.AccentuationType.Normal;
            if (n.hp) note.isHammerPullOrigin = true;
            if (n.tapping || n.leftHandTapping) note.isLeftHandTapped = true;
            if (n.leftHandVibrato) note.vibrato = VIBRATO[n.leftHandVibrato] ?? M.VibratoType.Slight;
            if (n.slide) {
              if (SLIDE_OUT[n.slide] !== undefined) note.slideOutType = SLIDE_OUT[n.slide];
              else if (SLIDE_IN[n.slide] !== undefined) note.slideInType = SLIDE_IN[n.slide];
            }
            if (n.harmonic) {
              note.harmonicType = HARMONIC[n.harmonic] ?? M.HarmonicType.Natural;
              note.harmonicValue = n.harmonicFret ?? 12;
            }
            if (n.bend?.points?.length) {
              note.bendType = M.BendType.Custom;
              for (const p of toBendPoints(n.bend.points)) note.addBendPoint(p);
            }
            if (b.palmMute) note.isPalmMute = true;
            if (b.letRing) note.isLetRing = true;
            beat.addNote(note);
          }
        }
        if (!voice.beats.length) {
          // Filler for voices a bar doesn't use. Mark it empty so it isn't drawn as a stray rest in the tab.
          const rest = new M.Beat();
          rest.duration = M.Duration.Whole;
          rest.isEmpty = vi > 0;
          voice.addBeat(rest);
        }
      });
    }

    // Lyrics: newLyrics = [{ line, offset (1-based start bar), text }]
    const lyrics = (part.newLyrics || [])
      .filter((l) => l.text && l.text.trim())
      .map((l) => {
        const ly = new M.Lyrics();
        ly.startBar = Math.max(0, (l.offset ?? 1) - 1);
        ly.text = l.text;
        return ly;
      });
    if (lyrics.length) pendingLyrics.push([track, lyrics]);
  }

  score.finish(settings);
  // applyLyrics walks beat.nextBeat, which only exists after finish()
  for (const [track, lyrics] of pendingLyrics) track.applyLyrics(lyrics);
  shareLyrics(score, pendingLyrics.map(([t]) => t), metaTracks);
  return score;
}

/**
 * Put the vocal line's lyrics under every other part too, so anyone can see where the words fall.
 * Each syllable keeps its exact timing: it goes on the beat (voice 1) of the other part that is sounding at that
 * moment; syllables that land on the same long note are joined.
 */
function shareLyrics(score, lyricTracks, metaTracks) {
  if (!lyricTracks.length) return;
  const roleOfTrack = (t) => roleOf(metaTracks.find((m, i) => names[i] === t.name) ?? {});
  const names = partNames(metaTracks);
  // Prefer the lead vocal line as the source.
  const source = lyricTracks.find((t) => /lead/i.test(t.name)) ?? lyricTracks[0];
  const syllables = [];
  for (const bar of source.staves[0].bars) for (const v of bar.voices) for (const b of v.beats)
    if (b.lyrics?.some((l) => l && l.trim())) syllables.push({ tick: b.absolutePlaybackStart, lines: b.lyrics });
  if (!syllables.length) return;
  syllables.sort((a, b) => a.tick - b.tick);

  for (const track of score.tracks) {
    if (lyricTracks.includes(track) || roleOfTrack(track) === 'vocals') continue;
    const beats = [];
    for (const bar of track.staves[0].bars) for (const b of bar.voices[0]?.beats ?? []) if (!b.isEmpty) beats.push(b);
    let i = 0;
    for (const syl of syllables) {
      while (i < beats.length - 1 && beats[i + 1].absolutePlaybackStart <= syl.tick) i++;
      const b = beats[i];
      if (!b || syl.tick < b.absolutePlaybackStart || syl.tick >= b.absolutePlaybackStart + b.playbackDuration) continue;
      b.lyrics ??= [];
      syl.lines.forEach((text, line) => {
        if (!text || !text.trim()) return;
        while (b.lyrics.length <= line) b.lyrics.push('');
        // Join: a syllable ending in "-" continues the word, otherwise separate words with a space.
        const prev = b.lyrics[line];
        b.lyrics[line] = !prev ? text : prev.endsWith('-') ? prev.slice(0, -1) + text : `${prev} ${text}`;
      });
    }
  }
}

/**
 * A band-like default mix (alphaTab volume 0-16, balance 0-16 with 8 = centre). Songsterr ships every part at
 * full volume, centred, and plays vocal lines on instruments like Viola or Tenor Sax, which sounds harsh.
 */
function defaultMix(tracks, names) {
  const VOLUME = { drums: 14, bass: 13, guitar: 12, keys: 11, vocals: 9, other: 11 };
  let rhythm = 0, extra = 0;
  return tracks.map((t, i) => {
    const role = roleOf(t);
    const m = { volume: VOLUME[role], balance: 8 };
    if (role === 'vocals') m.program = 53; // Voice Oohs: a soft guide melody instead of a sax or viola
    if (role === 'guitar' || role === 'keys') {
      if (/rhythm/i.test(names[i])) m.balance = rhythm++ % 2 ? 13 : 3; // double-tracked rhythm parts spread L/R
      else if (/extra|overdub|acoustic|clean/i.test(names[i])) m.balance = extra++ % 2 ? 11 : 5;
      if (/lead|solo/i.test(names[i])) m.volume += 1;
    }
    return m;
  });
}

export function scoreToGp7(score) {
  return new alphaTab.exporter.Gp7Exporter().export(score, new alphaTab.Settings());
}
