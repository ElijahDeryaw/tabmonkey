// Downloads MuseScore_General.sf3 (MIT licensed, ~38 MB) used for playback. Run once: npm run soundfont
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const URL = 'https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf3';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'soundfonts');
const out = path.join(dir, 'MuseScore_General.sf3');

if (fs.existsSync(out)) { console.log(`Already present: ${out}`); process.exit(0); }
fs.mkdirSync(dir, { recursive: true });
console.log(`Downloading ${URL} …`);
const res = await fetch(URL);
if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(out + '.part'));
fs.renameSync(out + '.part', out);
console.log(`Saved ${(fs.statSync(out).size / 1e6).toFixed(1)} MB to ${out}`);
