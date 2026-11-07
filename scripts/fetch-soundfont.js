// Downloads GeneralUser GS (SF2, ~32 MB, free to use and redistribute) used for playback. Run once: npm run soundfont
// SF2 on purpose: alphaTab 1.8.4's Vorbis decoder produces NaN on some SF3 samples, which silences playback.
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const URL = 'https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/GeneralUser-GS.sf2';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'soundfonts');
const out = path.join(dir, 'GeneralUser-GS.sf2');

if (fs.existsSync(out)) { console.log(`Already present: ${out}`); process.exit(0); }
fs.mkdirSync(dir, { recursive: true });
console.log(`Downloading ${URL} …`);
const res = await fetch(URL);
if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(out + '.part'));
fs.renameSync(out + '.part', out);
console.log(`Saved ${(fs.statSync(out).size / 1e6).toFixed(1)} MB to ${out}`);
