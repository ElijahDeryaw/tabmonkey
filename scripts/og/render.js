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
// Home screen icon: the app icon (public/icon.svg), full bleed, because iOS rounds the corners itself.
const icon = path.join(DIR, '.icon.tmp.html');
const svg = fs.readFileSync(path.join(PUBLIC, 'icon.svg'), 'utf8').replace(/ rx="\d+"/, '').replace('<svg ', '<svg width="180" height="180" ');
fs.writeFileSync(icon, `<!doctype html><body style="margin:0;background:#171716">${svg}</body>`);
const shots = [['site', 'og.png', '1200,630', `${pathToFileURL(page).href}?kind=site`], ['session', 'og-session.png', '1200,630', `${pathToFileURL(page).href}?kind=session`],
  ['icon', 'apple-touch-icon.png', '180,180', pathToFileURL(icon).href]];
for (const [, file, size, url] of shots) {
  execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${size}`,
    '--virtual-time-budget=6000', `--screenshot=${path.join(PUBLIC, file)}`, url], { stdio: 'ignore' });
  console.log(`public/${file}`);
}
fs.rmSync(page); fs.rmSync(icon);
