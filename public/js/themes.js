// Sheet themes. Comfort is tuned for reading at a glance from a music stand; Classic is the familiar
// Guitar Pro look. Each has a light and a dark sheet, drawn natively (no color inversion).
//
// Comfort's readability choices:
// - Tab numbers in Atkinson Hyperlegible Next at semibold (600; see styles.css): heavy enough to read at a glance,
//   light enough that the counters of 0, 6, 8 and 9 stay open. Designed for low-vision legibility.
// - Ink is high contrast against the paper; staff lines are deliberately lighter so the numbers carry the eye.
// - Off-white "paper" and off-black dark sheet, so neither glares.
// - More room between systems and a slightly larger scale, so the eye finds the next line quickly.
const HYPER = ['Atkinson Hyperlegible Next', 'Verdana', 'sans-serif'];
const font = (families, size, weight = 'Regular', style = 'Plain') => ({ families, size, weight, style });

const PALETTES = {
  comfort: {
    light: { paper: '#fbf8f1', ink: '#1f1c17', soft: '#5f594f', lines: '#b9b2a5', bars: '#8a8478', numbers: '#8f897d' },
    dark: { paper: '#1b1a17', ink: '#f1ebdf', soft: '#b5ad9f', lines: '#5b564d', bars: '#7c766b', numbers: '#8a8478' },
  },
  classic: {
    light: { paper: '#ffffff', ink: '#000000', soft: '#444444', lines: '#a5a5a5', bars: '#222222', numbers: '#8c8c86' },
    dark: { paper: '#141414', ink: '#e8e8e8', soft: '#b0b0b0', lines: '#5c5c5c', bars: '#cfcfcf', numbers: '#8c8c86' },
  },
};

export const THEMES = [['comfort', 'Comfort'], ['classic', 'Classic']];

/** Everything the player needs to apply a theme: alphaTab settings JSON, a scale factor, and the paper color. */
export function sheetTheme(name, dark) {
  const p = PALETTES[name]?.[dark ? 'dark' : 'light'] ?? PALETTES.comfort.light;
  const colors = {
    mainGlyphColor: p.ink, secondaryGlyphColor: p.soft, scoreInfoColor: p.ink,
    staffLineColor: p.lines, barSeparatorColor: p.bars, barNumberColor: p.numbers,
  };
  if (name === 'classic') {
    return {
      paper: p.paper, scaleFactor: 1,
      settings: {
        display: {
          systemPaddingTop: 25, systemPaddingBottom: 15,
          // alphaTab's own defaults, restated so switching back from Comfort fully resets them.
          resources: {
            ...colors,
            tablatureFont: font(['Arial', 'sans-serif'], 14),
            graceFont: font(['Arial', 'sans-serif'], 12),
            effectFont: font(['Georgia', 'serif'], 12, 'Regular', 'Italic'),
            fingeringFont: font(['Georgia', 'serif'], 12, 'Regular', 'Italic'),
            inlineFingeringFont: font(['Georgia', 'serif'], 12, 'Regular', 'Italic'),
            engravingSettings: { staffLineThickness: 1.17, stemThickness: 1.08, beamThickness: 4.5, thinBarlineThickness: 1.44, tieMidpointThickness: 1.98, slurMidpointThickness: 1.98 },
          },
        },
      },
    };
  }
  return {
    paper: p.paper, scaleFactor: 1.1,
    settings: {
      display: {
        systemPaddingTop: 40, systemPaddingBottom: 28,
        resources: {
          ...colors,
          tablatureFont: font(HYPER, 15, 'Bold'),
          graceFont: font(HYPER, 11, 'Bold'),
          effectFont: font(HYPER, 12, 'Regular', 'Italic'),
          fingeringFont: font(HYPER, 13),
          inlineFingeringFont: font(HYPER, 12),
          engravingSettings: { staffLineThickness: 1, stemThickness: 1.35, beamThickness: 5, thinBarlineThickness: 1.6, tieMidpointThickness: 2.3, slurMidpointThickness: 2.3 },
        },
      },
    },
  };
}

/** Make sure the theme's web font is ready before alphaTab measures text with it. */
export async function loadThemeFonts(name) {
  if (name !== 'comfort' || !document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load(`600 15px "${HYPER[0]}"`),
      document.fonts.load(`400 12px "${HYPER[0]}"`),
      document.fonts.load(`italic 400 12px "${HYPER[0]}"`),
    ]);
  } catch { /* offline: falls back to Verdana */ }
}
