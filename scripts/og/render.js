// Renders the link-preview cards and the home-screen icon into public/ with headless Chrome:
//   node scripts/og/render.js   (needs Chrome or Edge installed)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(DIR, '../../public');
const logo = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').match(/<svg class="logo"[\s\S]*?<\/svg>/)[0];
const page = path.join(DIR, '.card.tmp.html');
fs.writeFileSync(page, fs.readFileSync(path.join(DIR, 'card.html'), 'utf8').replace('LOGO_SVG', logo.replace(/`/g, '')));

const chrome = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && fs.existsSync(p));
const shots = [['site', 'og.png', '1200,630'], ['session', 'og-session.png', '1200,630'], ['icon', 'apple-touch-icon.png', '180,180']];
for (const [kind, file, size] of shots) {
  execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${size}`,
    '--virtual-time-budget=6000', `--screenshot=${path.join(PUBLIC, file)}`, `${pathToFileURL(page).href}?kind=${kind}`], { stdio: 'ignore' });
  console.log(`public/${file}`);
}
fs.rmSync(page);
