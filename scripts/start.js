// `npm start`: run the app and share it through a temporary Cloudflare tunnel, printing the public URL.
//   TUNNEL=0 npm start   → app only (same as `npm run serve`)
// cloudflared is looked up on Windows/macOS/Linux PATH first, then inside WSL (~/bin or PATH).
// Any ~/.cloudflared/config.yml is ignored (an empty config is passed), so existing named tunnels aren't affected.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.PORT) || 3000;
process.env.PORT = String(PORT);
await import('../server.js');

if (process.env.TUNNEL === '0') process.exitCode = 0;
else startTunnel();

function lanAddress() {
  const addrs = Object.entries(os.networkInterfaces())
    .filter(([name]) => !/vEthernet|WSL|Hyper-V|VirtualBox|VMware|docker/i.test(name))
    .flatMap(([, list]) => list || [])
    .filter((a) => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'));
  return (addrs.find((a) => /^(192\.168|10\.)/.test(a.address)) ?? addrs[0])?.address;
}

function findCloudflared() {
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['cloudflared'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) return { cmd: which.stdout.trim().split(/\r?\n/)[0], prefix: [], wsl: false };
  if (process.platform === 'win32') {
    const probe = spawnSync('wsl.exe', ['-e', 'sh', '-lc', 'command -v cloudflared || ls ~/bin/cloudflared 2>/dev/null'], { encoding: 'utf8' });
    const bin = probe.status === 0 && probe.stdout.trim().split(/\r?\n/)[0];
    if (bin) return { cmd: 'wsl.exe', prefix: ['-e', bin], wsl: true };
  }
  return null;
}

function startTunnel() {
  const cf = findCloudflared();
  if (!cf) {
    console.log('\nNo cloudflared found, so the app is only on your network. Install it to share a public link:');
    console.log('  winget install Cloudflare.cloudflared   (or set TUNNEL=0 to hide this message)\n');
    return;
  }
  // From WSL, "localhost" isn't Windows, so point the tunnel at this PC's LAN address.
  const host = cf.wsl ? lanAddress() : 'localhost';
  let config = '/dev/null';
  if (!cf.wsl) { config = path.join(os.tmpdir(), 'tabmonkey-cloudflared.yml'); fs.writeFileSync(config, '# empty: ignore ~/.cloudflared/config.yml\n'); }
  const args = [...cf.prefix, 'tunnel', '--config', config, '--url', `http://${host}:${PORT}`, '--no-autoupdate'];
  const child = spawn(cf.cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  let shown = false;
  const scan = (buf) => {
    const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !shown) {
      shown = true;
      console.log(`\n  Public link (anyone with it can open the app):\n  ${m[0]}\n`);
    }
    if (/ERR .*(failed|error)/i.test(buf) && !/config.*empty/i.test(buf)) process.stderr.write(`[tunnel] ${String(buf).trim()}\n`);
  };
  child.stdout.on('data', scan);
  child.stderr.on('data', scan);
  child.on('exit', (code) => { if (!stopping) console.log(`[tunnel] cloudflared exited (${code}). The app is still running locally.`); });

  let stopping = false;
  const stop = () => { stopping = true; child.kill(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  console.log('Starting a Cloudflare tunnel…');
}
