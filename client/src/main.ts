import './styles.ts';
import { injectStyles } from './styles.ts';
import { GAME_NAME } from '@flickfight/sim';
import { Renderer, type PlayerMeta } from './render/renderer.ts';
import { applyFx } from './render/fx.ts';
import { LocalGame, type Game, type FighterSpec } from './game.ts';
import { NetGame } from './net.ts';
import { KeyboardSource, P1_KEYS, P2_KEYS } from './input/keyboard.ts';
import { TouchSource } from './input/touch.ts';
import type { InputSource } from './input/types.ts';
import { unlockAudio, setMuted, isMuted } from './audio.ts';
import { randomFace } from './render/faces.ts';
import { renderHome, renderRoom } from './ui/lobby.ts';
import { renderResults } from './ui/results.ts';

injectStyles();

const app = document.getElementById('app')!;
const canvas = document.createElement('canvas');
app.appendChild(canvas);
const overlay = document.createElement('div');
overlay.className = 'overlay';
app.appendChild(overlay);
const rotate = document.createElement('div');
rotate.className = 'rotate';
rotate.textContent = '↺ Rotate your phone to landscape';
app.appendChild(rotate);
const menuBtn = document.createElement('button');
menuBtn.className = 'menu-btn';
menuBtn.textContent = '⏸';
menuBtn.style.display = 'none';
app.appendChild(menuBtn);

const renderer = new Renderer(canvas);

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

export interface Profile {
  name: string;
  face: string;
  color: number;
}
function loadProfile(): Profile {
  const name = localStorage.getItem('ff_name') || '';
  const face = localStorage.getItem('ff_face') || '';
  const color = Number(localStorage.getItem('ff_color') || '0');
  return { name, face, color };
}
export function saveProfile(p: Profile): void {
  localStorage.setItem('ff_name', p.name);
  localStorage.setItem('ff_face', p.face);
  localStorage.setItem('ff_color', String(p.color));
}

let game: Game | null = null;
let touchSource: TouchSource | null = null;
let screen: 'home' | 'room' | 'fight' | 'results' = 'home';
let net: NetGame | null = null;

// ---------- screen control ----------
function showOverlay(v: boolean) {
  overlay.classList.toggle('hidden', !v);
  menuBtn.style.display = v ? 'none' : 'block';
}

function goHome() {
  screen = 'home';
  showOverlay(true);
  game = null;
  net = null;
  renderHome(overlay, {
    profile: loadProfile(),
    onProfile: saveProfile,
    randomFace,
    onCreate: (p) => createOnline(p),
    onJoin: (p, code) => joinOnline(p, code),
    // On a phone, local practice must use the TOUCH single-player mode (the
    // two-keyboard mode is desktop-only and gives no controls on a phone).
    onLocal: () => (isTouch ? startLocalSolo() : startLocalTwoPlayer()),
  });
}

function goRoom() {
  screen = 'room';
  showOverlay(true);
  if (!net) return;
  renderRoom(overlay, net, {
    onStartFight: () => startFight(),
    onLeave: () => {
      net?.leave();
      goHome();
    },
  });
  net.onRoomUpdate = () => {
    if (screen === 'room') renderRoom(overlay, net!, { onStartFight: () => startFight(), onLeave: () => { net?.leave(); goHome(); } });
  };
  net.onStart = () => startFight();
}

let fightStart = 0;
function startFight() {
  screen = 'fight';
  showOverlay(false);
  fightStart = performance.now();
  if (isTouch) requestLandscape();
}

// ---------- online ----------
function createOnline(p: Profile) {
  unlockAudio();
  net = new NetGame(p);
  net.connect(() => net!.create());
  net.onEnterRoom = () => goRoom();
  net.onError = (m) => alert(m);
  game = net;
}
function joinOnline(p: Profile, code: string) {
  unlockAudio();
  net = new NetGame(p);
  net.connect(() => net!.join(code));
  net.onEnterRoom = () => goRoom();
  net.onError = (m) => alert(m);
  game = net;
}

// ---------- local ----------
function startLocalTwoPlayer() {
  unlockAudio();
  const sources = new Map<number, InputSource>();
  sources.set(0, new KeyboardSource(P1_KEYS));
  sources.set(1, new KeyboardSource(P2_KEYS));
  const specs: FighterSpec[] = [
    { id: 0, name: 'P1', face: '', color: 0, isBot: false },
    { id: 1, name: 'P2', face: '', color: 1, isBot: false },
    { id: 2, name: 'BOT-ZAP', face: '', color: 2, isBot: true, botLevel: 'medium' },
    { id: 3, name: 'BOT-KRUNCH', face: '', color: 3, isBot: true, botLevel: 'medium' },
  ];
  game = new LocalGame(1337, specs, sources);
  screen = 'fight';
  fightStart = performance.now();
  showOverlay(false);
}

function startLocalSolo() {
  unlockAudio();
  const p = loadProfile();
  const sources = new Map<number, InputSource>();
  if (isTouch) {
    touchSource = new TouchSource(canvas);
    sources.set(0, touchSource);
    requestLandscape();
  } else {
    sources.set(0, new KeyboardSource(P1_KEYS));
  }
  const specs: FighterSpec[] = [
    { id: 0, name: p.name || 'YOU', face: p.face, color: p.color, isBot: false },
    { id: 1, name: 'BOT-ZAP', face: '', color: 1, isBot: true, botLevel: 'easy' },
    { id: 2, name: 'BOT-KRUNCH', face: '', color: 2, isBot: true, botLevel: 'medium' },
    { id: 3, name: 'BOT-VOLT', face: '', color: 3, isBot: true, botLevel: 'hard' },
  ];
  game = new LocalGame(2024, specs, sources);
  screen = 'fight';
  fightStart = performance.now();
  showOverlay(false);
}

// ---------- pause / menu ----------
menuBtn.onclick = () => {
  const paused = confirmMenu();
  void paused;
};
function confirmMenu() {
  const muteState = isMuted() ? 'Unmute' : 'Mute';
  const choice = prompt(`Paused (match keeps running).\n1 = ${muteState}\n2 = Leave to menu\n(cancel = resume)`, '');
  if (choice === '1') setMuted(!isMuted());
  else if (choice === '2') goHome();
}

// ---------- landscape / fullscreen ----------
function requestLandscape() {
  const el = document.documentElement as HTMLElement & { requestFullscreen?: () => Promise<void> };
  el.requestFullscreen?.().catch(() => {});
  const so = screen as unknown as { orientation?: { lock?: (o: string) => Promise<void> } };
  void so;
  const scr = window.screen as unknown as { orientation?: { lock?: (o: string) => Promise<void> } };
  scr.orientation?.lock?.('landscape').catch(() => {});
}
function checkOrientation() {
  const portrait = window.innerHeight > window.innerWidth;
  rotate.classList.toggle('show', screen === 'fight' && portrait && isTouch);
}
window.addEventListener('resize', checkOrientation);

// ---------- loop ----------
let simAcc = 0;
let last = performance.now();
const STEP = 1000 / 60;

function frame(now: number) {
  const dt = Math.min(100, now - last);
  last = now;
  checkOrientation();

  if (game && screen === 'fight') {
    const slow = renderer.effects.slowmo > 0;
    simAcc += dt * (slow ? 0.28 : 1);
    let steps = 0;
    while (simAcc >= STEP && steps < 6) {
      game.step();
      simAcc -= STEP;
      steps++;
    }
    const snap = game.snapshot();
    applyFx(snap, renderer);
    renderer.ping = net?.ping ?? 0;
    renderer.render(snap, game.meta);
    drawTouchSticks();
    drawControlHints(now);

    if (snap.status === 'ended' && snap.results) {
      showResults(snap.results, game.meta);
    }
  } else if (screen === 'home' || screen === 'room') {
    // idle: keep a faint animated backdrop by rendering nothing heavy
  }

  requestAnimationFrame(frame);
}

function activeTouch(): TouchSource | null {
  return touchSource ?? net?.touch ?? null;
}

// First-time discoverability: the controls are invisible floating sticks, so
// show where to put your thumbs (and a keyboard hint on desktop), fading over
// the first ~7s of a fight but never fully gone.
function drawControlHints(now: number): void {
  const ctx = renderer.ctx;
  const dpr = renderer.dpr;
  const W = renderer.cw;
  const H = renderer.ch;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const age = (now - fightStart) / 1000;
  const fade = age < 5 ? 1 : age < 8 ? 1 - (age - 5) / 3 : 0.12; // fade to a faint persistent hint
  ctx.save();
  ctx.globalAlpha = fade;

  if (isTouch) {
    const at = activeTouch();
    const leftActive = at?.sticks().left.active;
    const rightActive = at?.sticks().right.active;
    ctx.textAlign = 'center';
    ctx.font = 'bold 15px system-ui, sans-serif';
    // left zone
    if (!leftActive) {
      ctx.strokeStyle = 'rgba(90,209,255,0.35)';
      ctx.setLineDash([6, 8]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(W * 0.22, H * 0.62, 46, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(200,230,255,0.9)';
      ctx.fillText('DRAG TO MOVE', W * 0.22, H * 0.62 - 60);
      ctx.fillText('flick ↑ jump · ← → dash', W * 0.22, H * 0.62 + 74);
    }
    if (!rightActive) {
      ctx.strokeStyle = 'rgba(255,107,139,0.35)';
      ctx.setLineDash([6, 8]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(W * 0.78, H * 0.62, 46, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,210,220,0.9)';
      ctx.fillText('TAP = JAB · FLICK = KICK', W * 0.78, H * 0.62 - 60);
      ctx.fillText('hold = block · hold+flick = special', W * 0.78, H * 0.62 + 74);
    }
  } else {
    // desktop keyboard reminder
    ctx.textAlign = 'center';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(200,210,230,0.85)';
    ctx.fillText('WASD move · J jab · arrows kick · hold K block · K+arrow special', W / 2, H - 30);
  }
  ctx.restore();
}

function drawTouchSticks() {
  const src = activeTouch();
  if (!src) return;
  const ctx = renderer.ctx;
  const dpr = renderer.dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const s = src.sticks();
  for (const st of [s.left, s.right]) {
    if (!st.active) continue;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(st.bx, st.by, 60, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(st.kx, st.ky, 26, 0, Math.PI * 2);
    ctx.fill();
  }
}

function showResults(results: import('@flickfight/sim').Placement[], meta: Map<number, PlayerMeta>) {
  if (screen === 'results') return;
  screen = 'results';
  showOverlay(true);
  const isHost = net ? net.isHost : true;
  renderResults(overlay, results, meta, {
    canRematch: isHost,
    onRematch: () => {
      if (net) net.rematch();
      else game?.rematch();
      screen = 'fight';
      showOverlay(false);
    },
    onLeave: () => {
      net?.leave();
      goHome();
    },
  });
}

// ---------- keyboard shortcuts ----------
window.addEventListener('keydown', (e) => {
  if (e.code === 'F3') renderer.debug = !renderer.debug;
  if (e.code === 'KeyH') renderer.showHitboxes = !renderer.showHitboxes;
  if (e.code === 'Escape' && screen === 'fight') confirmMenu();
});
canvas.addEventListener('pointerdown', () => unlockAudio(), { once: false });

// ---------- boot: route by URL ----------
document.title = GAME_NAME;
const params = new URLSearchParams(location.search);
if (params.get('local') === '1') {
  startLocalTwoPlayer();
} else if (params.get('solo') === '1') {
  startLocalSolo();
} else {
  goHome();
  const room = params.get('room');
  if (room) {
    // pre-fill join
    const p = loadProfile();
    if (p.name) joinOnline(p, room.toUpperCase());
  }
}
requestAnimationFrame(frame);

// Debug hook for automated verification of the input pipeline.
(window as unknown as { __ff: unknown }).__ff = {
  snap: () => (game ? game.snapshot() : null),
  screen: () => screen,
  touch: () => { const t = activeTouch(); return t ? t.debugState() : null; },
};
