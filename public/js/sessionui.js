// Session UI: the avatar stack in both top bars, the session panel (invite QR + link, who's here and what they have
// open, leave/end), and the little toasts when people come and go.
/* global qrcode */
import * as session from './session.js';
import * as store from './store.js';
import { INSTRUMENTS } from './instruments.js';
import { esc, icon, toast, popover, closePopover } from './ui.js';

let go = () => {};
const instLabel = (id) => INSTRUMENTS.find((i) => i.id === id)?.label ?? '';
const initials = (name) => {
  const w = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || '?').slice(0, 2)).toUpperCase();
};
const possessive = (n) => (/s$/i.test(n) ? `${n}’` : `${n}’s`);

/** A round initials badge with the person's session color as its ring. */
export function avatar(p, cls = '') {
  if (!p) return '';
  return `<span class="av ${cls} ${p.online === false ? 'away' : ''}" style="--c:${esc(p.color)}" title="${esc(p.name)}${p.peer === session.me() ? ' (you)' : ''}">${esc(initials(p.name))}</span>`;
}

export function init({ navigate }) {
  go = navigate;
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-session]');
    if (b) openPanel(b);
  });
  session.onChange(onSessionEvent);
  draw();
}

function onSessionEvent(ev) {
  draw();
  if (ev.type === 'peers') for (const p of ev.joined) toast(`${p.name} joined`);
  if (ev.type === 'ended') {
    closePopover();
    toast(ev.reason === 'missing' ? 'That session has ended' : session.isHost() ? 'Session ended' : `${ev.who ? possessive(ev.who) : 'The'} session has ended`);
  }
  if (current) current.redraw();
}


/** The button in the top bars: "Session" when off, a stack of colored avatars when on. */
let seen = new Set(); // avatars already shown; only newcomers pop in
function draw() {
  const on = session.active();
  const people = session.peers().filter((p) => p.online || p.host);
  const state = session.connection();
  for (const b of document.querySelectorAll('[data-session]')) {
    const compact = b.classList.contains('compact');
    b.classList.toggle('on', on);
    b.classList.toggle('btn', !on);
    b.classList.toggle('ghost', !on);
    b.classList.toggle('icon', !on && compact);
    if (!on) {
      b.innerHTML = `${icon('people')}${compact ? '' : '<span>Session</span>'}`;
      b.title = 'Start a session: share your songs with the room';
      b.setAttribute('aria-label', 'Session');
      continue;
    }
    const max = compact ? 3 : 4;
    const shown = people.slice(0, max);
    b.innerHTML = `<span class="av-stack">${shown.map((p) => avatar(p, seen.has(p.peer) ? '' : 'pop')).join('')}${people.length > max ? `<span class="av more">+${people.length - max}</span>` : ''}</span>
      <span class="live ${state === 'live' ? '' : 'wait'}" aria-hidden="true"></span>`;
    const names = people.map((p) => (p.peer === session.me() ? 'you' : p.name)).join(', ');
    b.title = state === 'live' ? `In a session with ${names}` : 'Reconnecting…';
    b.setAttribute('aria-label', `Session: ${people.length} ${people.length === 1 ? 'person' : 'people'}`);
  }
  seen = new Set(people.map((p) => p.peer));
}

// ---------- the panel
let current = null;
function openPanel(anchor) {
  current = popover(anchor, () => (session.active() ? livePanel() : startPanel()), {
    align: 'end',
    className: 'session-menu',
    onClick: async (e, m) => {
      if (e.type !== 'click') return;
      const act = e.target.closest('[data-act]')?.dataset.act;
      const open = e.target.closest('[data-open-song]');
      if (open) { m.close(); go(`song=${open.dataset.openSong}`); return; }
      const lib = e.target.closest('[data-open-peer]');
      if (lib) { m.close(); go(`peer=${lib.dataset.openPeer}`); return; }
      if (act === 'start') { if (!store.profile()) { toast('Pick your name first'); return; } session.start(); m.redraw(); }
      if (act === 'copy') copyLink(e.target.closest('button'));
      if (act === 'share') shareLink();
      if (act === 'leave') { m.close(); session.leave(); toast('You left the session'); }
      if (act === 'end') { m.close(); session.end(); toast('Session ended. Your library stays on your device.'); }
    },
  });
  if (!current) return;
  // popover() returns { el, anchor, draw }; keep a redraw that also re-places it
  const c = current;
  current = { redraw: () => { if (document.body.contains(c.el)) c.draw(); else current = null; } };
}

function startPanel() {
  return `<div class="ses-start">
    <div class="ses-art" aria-hidden="true">${['#f2555a', '#3d8ef7', '#2fb36d', '#f5a524'].map((c) => `<span class="av" style="--c:${c}"></span>`).join('')}</div>
    <h3>Play together</h3>
    <p>Start a session and everyone you invite sees your songs and setlists while it’s open. They can open any song on their own part and save a setlist to their library with one tap.</p>
    <button class="btn primary wide" data-act="start">${icon('people')}Start a session</button>
    <p class="fine">Nothing leaves this device until you start. End it any time.</p>
  </div>`;
}

function livePanel() {
  const url = session.inviteUrl();
  const state = session.connection();
  const people = session.peers().filter((p) => p.online || p.host);
  const meId = session.me();
  const host = session.hostPeer();
  const status = state === 'live' ? `<span class="dot live"></span>Live` : state === 'off' ? 'Not connected' : `<span class="dot wait"></span>Reconnecting…`;
  const title = session.isHost() ? 'Your session' : host ? `${possessive(host.name)} session` : 'Session';
  return `<div class="ses">
    <div class="ses-head"><h3>${esc(title)}</h3><span class="ses-state">${status}</span></div>
    <div class="ses-invite">
      <div class="qr" aria-label="QR code for the invite link">${qrSvg(url)}</div>
      <div class="ses-invite-text">
        <strong>Invite people</strong>
        <span class="meta">Scan with a camera, or send the link. Anyone with it can join.</span>
        <div class="ses-actions">
          ${navigator.share ? `<button class="btn primary" data-act="share">${icon('share')}Share link</button>` : ''}
          <button class="btn" data-act="copy">${icon('link')}Copy link</button>
        </div>
      </div>
    </div>
    <div class="menu-label">${people.length} ${people.length === 1 ? 'person' : 'people'}</div>
    <div class="ses-people">
      ${people.map((p) => {
        const you = p.peer === meId;
        const lib = session.library(p.peer);
        const shares = !you && (lib?.songs?.length || lib?.setlists?.length);
        const st = p.status;
        return `<div class="ses-person ${p.online ? '' : 'is-away'}">
          ${avatar(p, 'lg')}
          <span class="stack grow">
            <span class="name">${esc(p.name)}${you ? ' <span class="meta">(you)</span>' : ''}${p.host ? ' <span class="tag">Host</span>' : ''}</span>
            <span class="meta">${[instLabel(p.instrument), !p.online ? 'Away' : st ? `On ${esc(st.title)}` : 'Browsing'].filter(Boolean).join(' · ')}</span>
          </span>
          ${!you && st && p.online ? `<button class="btn sm-text" data-open-song="${st.songId}" title="Open ${esc(st.title)}">Open</button>` : ''}
          ${shares ? `<button class="btn ghost sm-text" data-open-peer="${esc(p.peer)}" title="Browse ${esc(possessive(p.name))} library">Library</button>` : ''}
        </div>`;
      }).join('')}
    </div>
    <div class="menu-sep"></div>
    ${session.isHost()
      ? `<button class="menu-item danger" data-act="end"><span class="check">${icon('exit')}</span>End session for everyone</button>`
      : `<button class="menu-item" data-act="leave"><span class="check">${icon('exit')}</span>Leave session</button>`}
  </div>`;
}

function qrSvg(text) {
  if (!text || typeof qrcode === 'undefined') return '';
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

async function copyLink(btn) {
  const url = session.inviteUrl();
  try {
    await navigator.clipboard.writeText(url);
    if (btn) { const html = btn.innerHTML; btn.innerHTML = `${icon('check')}Copied`; setTimeout(() => { btn.innerHTML = html; }, 1600); }
  } catch { toast(url); }
}
async function shareLink() {
  const url = session.inviteUrl();
  const p = store.profile();
  try { await navigator.share({ title: 'TabMonkey session', text: `Join ${p ? possessive(p.name) : 'my'} TabMonkey session`, url }); }
  catch (e) { if (e?.name !== 'AbortError') copyLink(); }
}
