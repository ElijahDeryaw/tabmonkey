// Builds the static site into dist/ (what GitHub Pages serves): the app, alphaTab, the soundfont and the QR library.
// Every module URL gets a content-hash ?v= stamp, so a deploy is picked up on the next load and never mixes old and
// new files. Set TM_API to point the app at a different Worker.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'dist');
const ALPHATAB = path.join(ROOT, 'node_modules/@coderline/alphatab/dist');
const FULL_FONT = path.join(ROOT, 'soundfonts/GeneralUser-GS.sf2');

export function build({ quiet = false } = {}) {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.cpSync(PUBLIC, OUT, { recursive: true });

  fs.mkdirSync(path.join(OUT, 'alphatab'), { recursive: true });
  fs.copyFileSync(path.join(ALPHATAB, 'alphaTab.min.js'), path.join(OUT, 'alphatab/alphaTab.min.js'));
  fs.cpSync(path.join(ALPHATAB, 'font'), path.join(OUT, 'alphatab/font'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'vendor'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'node_modules/qrcode-generator/qrcode.js'), path.join(OUT, 'vendor/qrcode.js'));

  // GeneralUser GS (npm run soundfont) sounds far better; alphaTab's small sonivox font is the fallback.
  const sf = fs.existsSync(FULL_FONT) ? FULL_FONT : path.join(ALPHATAB, 'soundfont/sonivox.sf2');
  fs.mkdirSync(path.join(OUT, 'soundfont'), { recursive: true });
  fs.copyFileSync(sf, path.join(OUT, 'soundfont', path.basename(sf)));

  // Version stamp from the app's own files.
  const hash = crypto.createHash('sha1');
  for (const f of walk(PUBLIC)) hash.update(f).update(fs.readFileSync(f));
  const v = hash.digest('hex').slice(0, 10);

  for (const f of walk(path.join(OUT, 'js'))) {
    const src = fs.readFileSync(f, 'utf8').replace(/(from\s+'\.\/[\w-]+\.js)'/g, `$1?v=${v}'`);
    fs.writeFileSync(f, src);
  }
  let html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8')
    .replace('href="styles.css"', `href="styles.css?v=${v}"`)
    .replace('src="js/main.js"', `src="js/main.js?v=${v}"`)
    .replace('src="vendor/qrcode.js"', `src="vendor/qrcode.js?v=${v}"`)
    .replace('<meta name="tm-api"', `<meta name="tm-soundfont" content="soundfont/${path.basename(sf)}">\n<meta name="tm-api"`);
  if (process.env.TM_API) html = html.replace(/(<meta name="tm-api" content=")[^"]*/, `$1${process.env.TM_API}`);
  fs.writeFileSync(path.join(OUT, 'index.html'), html);
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
  if (!quiet) console.log(`Built dist/ (v=${v}, soundfont: ${path.basename(sf)})`);
  return v;
}

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p); else yield p;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) build();
