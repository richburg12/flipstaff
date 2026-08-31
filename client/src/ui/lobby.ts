// Home + Room screens (DOM overlays). Home: name, face doodle, create/join,
// the Strike/Grab/Block triangle (the whole tutorial), a control hint. Room:
// big code + share, player list, bot controls, ready/start.

import { GAME_NAME } from '@flickfight/sim';
import { BODY_COLORS } from '../render/stickman.ts';
import type { Profile } from '../main.ts';
import type { NetGame } from '../net.ts';

export interface HomeOpts {
  profile: Profile;
  onProfile: (p: Profile) => void;
  randomFace: (seed: string) => string;
  onCreate: (p: Profile) => void;
  onJoin: (p: Profile, code: string) => void;
  onLocal: () => void;
}

export function renderHome(root: HTMLElement, o: HomeOpts): void {
  root.innerHTML = '';
  const profile = { ...o.profile };
  if (!profile.face) profile.face = o.randomFace(Math.random().toString());

  const title = el('div', 'title');
  title.innerHTML = `<span class="a">FLICK</span> <span class="b">FIGHT</span>`;
  root.appendChild(title);

  const col = el('div', 'col');
  root.appendChild(col);

  // name
  const name = document.createElement('input');
  name.className = 'f';
  name.placeholder = 'YOUR NAME';
  name.maxLength = 10;
  name.value = profile.name;
  name.oninput = () => {
    profile.name = name.value.toUpperCase();
    o.onProfile(profile);
  };
  col.appendChild(name);

  // face doodle
  col.appendChild(faceDoodle(profile, o));

  // create / join
  const createBtn = btn('Create Room', 'btn');
  createBtn.onclick = () => {
    profile.name = name.value.toUpperCase();
    o.onProfile(profile);
    o.onCreate(profile);
  };
  const codeInput = document.createElement('input');
  codeInput.className = 'f code';
  codeInput.placeholder = 'CODE';
  codeInput.maxLength = 4;
  codeInput.oninput = () => (codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, ''));
  const joinBtn = btn('Join', 'btn alt');
  joinBtn.onclick = () => {
    if (codeInput.value.length === 4) {
      profile.name = name.value.toUpperCase();
      o.onProfile(profile);
      o.onJoin(profile, codeInput.value);
    }
  };
  col.appendChild(createBtn);
  const joinRow = el('div', 'row');
  joinRow.append(codeInput, joinBtn);
  col.appendChild(joinRow);

  const localBtn = btn('Practice vs Bots (local)', 'btn alt');
  localBtn.onclick = () => o.onLocal();
  col.appendChild(localBtn);

  // triangle tutorial
  const tri = el('div', 'triangle');
  tri.innerHTML = `<span class="pill">👊 Strike</span> beats <span class="pill">🤝 Grab</span> beats <span class="pill">🛡 Block</span> beats 👊`;
  root.appendChild(tri);

  const hint = el('div', 'sub');
  hint.textContent = 'Left thumb moves. Right thumb: tap = jab, flick = kick, hold = block, hold-then-flick = special. Flick fast, hit harder.';
  root.appendChild(hint);

  void GAME_NAME;
}

function faceDoodle(profile: Profile, o: HomeOpts): HTMLElement {
  const wrap = el('div', 'facewrap');
  const cv = document.createElement('canvas');
  cv.width = 96;
  cv.height = 96;
  cv.className = 'doodle';
  cv.style.width = '96px';
  cv.style.height = '96px';
  const ctx = cv.getContext('2d')!;
  const paint = (src: string) => {
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, 96, 96);
      ctx.drawImage(img, 0, 0, 96, 96);
    };
    img.src = src;
  };
  paint(profile.face);

  let drawing = false;
  let color = '#111';
  const pt = (e: PointerEvent) => {
    const r = cv.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 96, y: ((e.clientY - r.top) / r.height) * 96 };
  };
  cv.addEventListener('pointerdown', (e) => {
    drawing = true;
    const p = pt(e);
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    e.preventDefault();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = pt(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    e.preventDefault();
  });
  const end = () => {
    if (!drawing) return;
    drawing = false;
    profile.face = cv.toDataURL('image/png');
    o.onProfile(profile);
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointerleave', end);

  wrap.appendChild(cv);

  // colours + random + body colour
  const colors = ['#111', '#e11d48', '#2563eb'];
  const swatchRow = el('div', 'row');
  for (const c of colors) {
    const sw = document.createElement('div');
    sw.className = 'swatch' + (c === color ? ' sel' : '');
    sw.style.background = c;
    sw.onclick = () => {
      color = c;
      [...swatchRow.children].forEach((ch) => ch.classList.remove('sel'));
      sw.classList.add('sel');
    };
    swatchRow.appendChild(sw);
  }
  const rnd = btn('🎲', 'btn alt');
  rnd.style.padding = '6px 12px';
  rnd.onclick = () => {
    profile.face = o.randomFace(Math.random().toString());
    o.onProfile(profile);
    paint(profile.face);
  };
  swatchRow.appendChild(rnd);
  wrap.appendChild(swatchRow);

  // body colour picker
  const bodyRow = el('div', 'row');
  const label = el('div', 'small');
  label.textContent = 'Colour:';
  bodyRow.appendChild(label);
  BODY_COLORS.forEach((bc, i) => {
    const sw = document.createElement('div');
    sw.className = 'swatch' + (i === profile.color ? ' sel' : '');
    sw.style.background = bc;
    sw.style.width = '24px';
    sw.style.height = '24px';
    sw.onclick = () => {
      profile.color = i;
      o.onProfile(profile);
      [...bodyRow.querySelectorAll('.swatch')].forEach((ch) => ch.classList.remove('sel'));
      sw.classList.add('sel');
    };
    bodyRow.appendChild(sw);
  });
  wrap.appendChild(bodyRow);

  return wrap;
}

export interface RoomOpts {
  onStartFight: () => void;
  onLeave: () => void;
}

export function renderRoom(root: HTMLElement, net: NetGame, o: RoomOpts): void {
  root.innerHTML = '';
  const code = el('div', 'code-big');
  code.textContent = net.roomCode;
  root.appendChild(code);

  const shareRow = el('div', 'row');
  const share = btn('Share link', 'btn');
  share.onclick = () => {
    const url = `${location.origin}/?room=${net.roomCode}`;
    const nav = navigator as Navigator & { share?: (d: { title: string; url: string }) => Promise<void> };
    if (nav.share) nav.share({ title: 'FLICK FIGHT', url }).catch(() => {});
    else {
      navigator.clipboard?.writeText(url);
      share.textContent = 'Copied!';
      setTimeout(() => (share.textContent = 'Share link'), 1200);
    }
  };
  shareRow.appendChild(share);
  root.appendChild(shareRow);

  const card = el('div', 'card');
  const list = el('div', 'players');
  for (const p of net.players) {
    const row = el('div', 'prow');
    const dot = document.createElement('div');
    dot.className = 'dot';
    dot.style.background = BODY_COLORS[p.color % BODY_COLORS.length];
    row.appendChild(dot);
    const nm = el('div', '');
    nm.style.flex = '1';
    nm.textContent = p.name + (p.id === net.hostId ? ' 👑' : '') + (p.isBot ? ` (${p.botLevel})` : '');
    row.appendChild(nm);
    const st = el('div', 'small');
    st.textContent = p.isBot ? 'BOT' : p.ready ? '✓ Ready' : '…';
    row.appendChild(st);
    list.appendChild(row);
  }
  card.appendChild(list);
  root.appendChild(card);

  // controls
  const controls = el('div', 'col');
  if (net.isHost) {
    const botRow = el('div', 'row');
    for (const lvl of ['easy', 'medium', 'hard'] as const) {
      const b = btn('+ ' + lvl, 'btn alt');
      b.style.padding = '10px 14px';
      b.onclick = () => net.addBot(lvl);
      botRow.appendChild(b);
    }
    const rm = btn('- bot', 'btn alt');
    rm.style.padding = '10px 14px';
    rm.onclick = () => net.removeBot();
    botRow.appendChild(rm);
    controls.appendChild(botRow);
    const start = btn('START FIGHT', 'btn pink');
    start.onclick = () => net.startMatch();
    controls.appendChild(start);
  } else {
    const me = net.players.find((p) => p.id === net.yourId);
    const ready = btn(me?.ready ? 'Not ready' : 'Ready', 'btn');
    ready.onclick = () => net.setReady(!me?.ready);
    controls.appendChild(ready);
    const wait = el('div', 'small');
    wait.textContent = 'Waiting for host to start…';
    controls.appendChild(wait);
  }
  const leave = btn('Leave', 'btn alt');
  leave.onclick = o.onLeave;
  controls.appendChild(leave);
  root.appendChild(controls);
}

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
function btn(text: string, cls: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = text;
  return b;
}
