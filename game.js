/* FLIPSTAFF — browser shell. Two players, one flat phone, face to face.
   All game logic lives in sim.js (headless); this file is layout, touch,
   ink-and-shoji rendering, staff choreography, HUD, audio, and the AI hookup.

   Visual identity: a backlit shoji paper panel set in dark lacquered wood.
   Fighters are ink-silhouette stick figures with team-colored sashes and
   staff wraps — CRIMSON (bottom edge) vs JADE (top edge). Impacts are ink. */
(() => {
'use strict';

const SIM = (typeof window !== 'undefined' && window.SIM) || (typeof require !== 'undefined' && require('./sim.js'));
const C = SIM.C;
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

const AI_ON = new URLSearchParams(location.search).get('ai') === '1';

// ---------- palette ----------
const INK = '#221c26';
const PAPER_HI = '#efe3c6';
const PAPER_LO = '#ddc9a3';
const WOOD = '#241a13';
const WOOD_HI = '#3a2c1e';
const P0COL = '#c8391f'; // CRIMSON — bottom player
const P1COL = '#20705f'; // JADE — top player
const PCOL = [P0COL, P1COL];
const PNAME = ['CRIMSON', 'JADE'];
const FONT = "'Yuji Syuku', Georgia, serif";

// ---------- shell state ----------
let W = 0, H = 0, dpr = 1;
let bg = null; // prerendered background
const ar = { x: 0, y: 0, w: 0, h: 0, s: 20, y1: 0 }; // arena screen rect + scale (px/unit)
let zoneH = 150;

const shell = {
  screen: 'title', // title | game
  t: 0,
  overT: 0, // frames since sim hit 'over' (guards accidental rematch taps)
  nudgeX: 0, nudgeY: 0, shake: 0,
  flash: 0, // full-panel white blink on KO
  flipSfxT: -99,
  particles: [],
  rings: [],
  trails: [[], []], // staff-tip trails per fighter (world coords)
  jolt: [0, 0], // blocked-hit jolt per fighter
  koBurst: false,
};

let game = SIM.createGame();
let ai = AI_ON ? SIM.createAI((Date.now() % 100000) | 1) : null;

// ---------- layout ----------
// uiM: how "iPad" the display is (0 on phones, 1 on full tablet width). All
// roomy-layout terms multiply by uiM, so phone layout is byte-identical.
let uiM = 0;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr);
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  uiM = Math.max(0, Math.min(1, (W - 430) / (1024 - 430)));
  zoneH = Math.max(108, Math.min(230 + 60 * uiM, H * 0.205));
  const sideM = 6, gapY = 34; // gapY leaves room for the HUD bars
  const availW = W - sideM * 2, availH = H - zoneH * 2 - gapY * 2;
  ar.s = Math.min(availW / C.AW, availH / C.AH);
  ar.w = C.AW * ar.s; ar.h = C.AH * ar.s;
  ar.x = (W - ar.w) / 2;
  ar.y = zoneH + gapY + (availH - ar.h) / 2;
  ar.y1 = ar.y + ar.h;
  prerenderBg();
}
const px = (x) => ar.x + x * ar.s;
const py = (y) => ar.y1 - y * ar.s;

// ---------- background: lacquer surround + backlit shoji panel ----------
function prerenderBg() {
  bg = document.createElement('canvas');
  bg.width = Math.floor(W * dpr); bg.height = Math.floor(H * dpr);
  const b = bg.getContext('2d');
  b.setTransform(dpr, 0, 0, dpr, 0, 0);

  // dark room
  const rg = b.createLinearGradient(0, 0, 0, H);
  rg.addColorStop(0, '#1b1520'); rg.addColorStop(0.5, '#151019'); rg.addColorStop(1, '#1b1520');
  b.fillStyle = rg; b.fillRect(0, 0, W, H);

  // the lacquer TABLE the panel rests on: fine wood grain across the whole
  // surround, so surplus screen on tablets reads as tabletop, not dead margin
  let gseed = 4241;
  const grnd = () => (gseed = (gseed * 16807) % 2147483647) / 2147483647;
  for (let y = -8; y < H + 8; y += 20) {
    const wob = grnd() * 9;
    b.strokeStyle = 'rgba(120,90,110,0.05)';
    b.lineWidth = 1 + grnd() * 5;
    b.globalAlpha = 0.35 + grnd() * 0.4;
    b.beginPath();
    b.moveTo(-10, y + wob);
    b.bezierCurveTo(W * 0.33, y + wob + (grnd() - 0.5) * 12, W * 0.66, y + wob + (grnd() - 0.5) * 12, W + 10, y + wob);
    b.stroke();
  }
  b.globalAlpha = 1;
  b.strokeStyle = 'rgba(0,0,0,0.16)';
  for (let i = 0; i < 14; i++) {
    const y = grnd() * H;
    b.lineWidth = 0.8 + grnd() * 1.4;
    b.beginPath();
    b.moveTo(-10, y);
    b.bezierCurveTo(W * 0.3, y + (grnd() - 0.5) * 16, W * 0.7, y + (grnd() - 0.5) * 16, W + 10, y);
    b.stroke();
  }

  // lacquered plank strips mark each player's control zone
  const planks = (y0, y1) => {
    b.save(); b.beginPath(); b.rect(0, y0, W, y1 - y0); b.clip();
    b.fillStyle = 'rgba(32,22,32,0.75)'; b.fillRect(0, y0, W, y1 - y0);
    for (let y = y0; y < y1; y += 26) {
      b.strokeStyle = 'rgba(0,0,0,0.35)'; b.lineWidth = 1.5;
      b.beginPath(); b.moveTo(0, y); b.lineTo(W, y); b.stroke();
      b.strokeStyle = 'rgba(120,90,110,0.05)'; b.lineWidth = 6;
      b.beginPath(); b.moveTo(0, y + 9 + (y * 7) % 5); b.lineTo(W, y + 11); b.stroke();
    }
    b.restore();
  };
  planks(0, zoneH); planks(H - zoneH, H);

  // soft shadow under the panel — it sits ON the table
  const ft = Math.max(7, ar.s * 0.35);
  for (let i = 3; i >= 1; i--) {
    b.fillStyle = 'rgba(0,0,0,0.10)';
    b.fillRect(ar.x - ft - i * 3, ar.y - ft - i * 3 + 4, ar.w + (ft + i * 3) * 2, ar.h + (ft + i * 3) * 2);
  }

  // wooden frame around the panel, with a thin outer pinstripe
  b.fillStyle = WOOD;
  b.fillRect(ar.x - ft, ar.y - ft, ar.w + ft * 2, ar.h + ft * 2);
  b.strokeStyle = WOOD_HI; b.lineWidth = 2;
  b.strokeRect(ar.x - ft + 1.5, ar.y - ft + 1.5, ar.w + ft * 2 - 3, ar.h + ft * 2 - 3);
  b.strokeStyle = 'rgba(220,200,160,0.09)'; b.lineWidth = 1;
  b.strokeRect(ar.x - ft - 5.5, ar.y - ft - 5.5, ar.w + ft * 2 + 11, ar.h + ft * 2 + 11);

  // the paper: warm, backlit from the centre
  const pg = b.createRadialGradient(ar.x + ar.w / 2, ar.y + ar.h / 2, ar.h * 0.1, ar.x + ar.w / 2, ar.y + ar.h / 2, ar.h * 0.75);
  pg.addColorStop(0, PAPER_HI); pg.addColorStop(1, PAPER_LO);
  b.fillStyle = pg; b.fillRect(ar.x, ar.y, ar.w, ar.h);

  // paper fibre flecks (deterministic scatter)
  let seed = 977;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  b.strokeStyle = 'rgba(120,92,52,0.07)'; b.lineWidth = 1;
  for (let i = 0; i < 240; i++) {
    const fx = ar.x + rnd() * ar.w, fy = ar.y + rnd() * ar.h, a = rnd() * Math.PI, l = 2 + rnd() * 7;
    b.beginPath(); b.moveTo(fx, fy); b.lineTo(fx + Math.cos(a) * l, fy + Math.sin(a) * l); b.stroke();
  }
  // faint enso brush circle behind centre
  b.strokeStyle = 'rgba(60,40,30,0.055)'; b.lineWidth = ar.s * 0.9; b.lineCap = 'round';
  b.beginPath(); b.arc(ar.x + ar.w / 2, ar.y + ar.h / 2, ar.h * 0.3, 0.6, 5.9); b.stroke();

  // bold ink ground strokes: floor top and ceiling underside are walkable.
  // The floor stroke breaks at the fire pit — the paper is burnt through.
  const strokeSeg = (yy, wx0, wx1, edgeFade) => {
    b.strokeStyle = 'rgba(34,28,38,0.9)'; b.lineCap = 'round';
    b.lineWidth = Math.max(3, ar.s * 0.16);
    b.beginPath(); b.moveTo(px(wx0) + (edgeFade ? 0 : 3), yy); b.lineTo(px(wx1) - (edgeFade ? 0 : 3), yy); b.stroke();
    b.strokeStyle = 'rgba(34,28,38,0.25)'; b.lineWidth = Math.max(6, ar.s * 0.34);
    b.beginPath(); b.moveTo(px(wx0 + (wx1 - wx0) * 0.06), yy); b.lineTo(px(wx1 - (wx1 - wx0) * 0.06), yy); b.stroke();
  };
  // each surface's stroke breaks at ITS fire crack — the paper is burnt through
  const floorPit = C.PITS.find(q => !q.ceiling), ceilPit = C.PITS.find(q => q.ceiling);
  strokeSeg(py(0), 0, floorPit.x0, true);
  strokeSeg(py(0), floorPit.x1, C.AW, true);
  strokeSeg(py(C.AH), 0, ceilPit.x0, true);
  strokeSeg(py(C.AH), ceilPit.x1, C.AW, true);

  // the fire cracks: charred, curling paper edges around gaps of darkness
  // (the animated lava glow + embers are drawn per-frame in render()).
  // `s` flips the char inward from whichever surface the crack burns through.
  for (const pit of C.PITS) {
    const gx0 = px(pit.x0), gx1 = px(pit.x1), gy = py(pit.ceiling ? C.AH : 0);
    const s = pit.ceiling ? 1 : -1; // pixel-y direction pointing INTO the arena
    const ch = b.createLinearGradient(0, gy, 0, gy + s * ar.s * 1.1);
    ch.addColorStop(0, 'rgba(30,14,8,0.85)');
    ch.addColorStop(0.45, 'rgba(70,32,14,0.35)');
    ch.addColorStop(1, 'rgba(70,32,14,0)');
    b.fillStyle = ch;
    b.fillRect(gx0 - ar.s * 0.35, Math.min(gy, gy + s * ar.s * 1.1), (gx1 - gx0) + ar.s * 0.7, ar.s * 1.1);
    // jagged burnt rim, curling inward at both lips
    b.strokeStyle = '#1c0e07'; b.lineWidth = Math.max(2.5, ar.s * 0.13); b.lineCap = 'round';
    b.beginPath();
    b.moveTo(gx0 - ar.s * 0.35, gy);
    b.quadraticCurveTo(gx0 - ar.s * 0.05, gy + s * ar.s * 0.05, gx0 + ar.s * 0.06, gy + s * ar.s * 0.3);
    b.stroke();
    b.beginPath();
    b.moveTo(gx1 + ar.s * 0.35, gy);
    b.quadraticCurveTo(gx1 + ar.s * 0.05, gy + s * ar.s * 0.05, gx1 - ar.s * 0.06, gy + s * ar.s * 0.3);
    b.stroke();
  }

  // two double-sided platforms: floating lacquer beams, staggered like steps
  for (const p of C.PLATS) {
    b.fillStyle = WOOD;
    b.fillRect(px(p.x0), py(p.y1), (p.x1 - p.x0) * ar.s, (p.y1 - p.y0) * ar.s);
    b.strokeStyle = 'rgba(34,28,38,0.9)'; b.lineWidth = Math.max(2.5, ar.s * 0.12); b.lineCap = 'round';
    b.beginPath(); b.moveTo(px(p.x0) + 2, py(p.y1)); b.lineTo(px(p.x1) - 2, py(p.y1)); b.stroke();
    b.beginPath(); b.moveTo(px(p.x0) + 2, py(p.y0)); b.lineTo(px(p.x1) - 2, py(p.y0)); b.stroke();
  }

  // hanko seal stamps, one per player corner (each near its owner's edge)
  const seal = (sx, sy, col, rot) => {
    b.save(); b.translate(sx, sy); b.rotate(rot);
    b.globalAlpha = 0.6; b.fillStyle = col;
    b.fillRect(-9, -9, 18, 18);
    b.globalAlpha = 0.85; b.strokeStyle = PAPER_HI; b.lineWidth = 1.6;
    b.strokeRect(-5.5, -5.5, 11, 11);
    b.beginPath(); b.moveTo(-5.5, 0); b.lineTo(5.5, 0); b.stroke();
    b.restore();
  };
  seal(ar.x + 20, ar.y1 - 20, P0COL, -0.06);
  seal(ar.x + ar.w - 20, ar.y + 20, P1COL, Math.PI - 0.06);

  // wide-margin flourishes (tablets): faint ink washes and table seals in
  // the surround — point-symmetric pairs, of course. Phones (thin margins)
  // never reach this.
  const marginW = ar.x - ft;
  if (marginW > 48) {
    const mcx = marginW / 2 + 2;
    // faint enso ink-wash rings on the tabletop, one per side
    const enso = (ex, ey, a0) => {
      b.strokeStyle = 'rgba(150,115,80,0.07)';
      b.lineWidth = Math.min(14, marginW * 0.16);
      b.lineCap = 'round';
      b.beginPath(); b.arc(ex, ey, Math.min(marginW * 0.34, 58), a0, a0 + 5.1); b.stroke();
    };
    enso(mcx, H * 0.5, 0.7);
    enso(W - mcx, H * 0.5, 0.7 + Math.PI);
    // brushed table seals near each player's resting corners
    seal(mcx, H - zoneH - 34, P0COL, 0.1);
    seal(W - mcx, zoneH + 34, P1COL, Math.PI + 0.1);
    // a light ink stroke framing each margin edge
    b.strokeStyle = 'rgba(220,200,160,0.05)'; b.lineWidth = 2;
    b.beginPath(); b.moveTo(mcx, zoneH + 12); b.lineTo(mcx, H - zoneH - 12); b.stroke();
    b.beginPath(); b.moveTo(W - mcx, zoneH + 12); b.lineTo(W - mcx, H - zoneH - 12); b.stroke();
  }
}

// ---------- audio: tiny ink-dojo synth ----------
let ac = null;
function audioInit() {
  if (ac || typeof AudioContext === 'undefined') return;
  try { ac = new AudioContext(); } catch (e) { ac = null; }
}
function blip(freq0, freq1, dur, vol, type) {
  if (!ac) return;
  const t = ac.currentTime;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type || 'triangle';
  o.frequency.setValueAtTime(freq0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(30, freq1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(ac.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
function noiseBurst(dur, vol, hp) {
  if (!ac) return;
  const n = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ac.createBufferSource(); src.buffer = buf;
  const f = ac.createBiquadFilter(); f.type = hp ? 'highpass' : 'lowpass'; f.frequency.value = hp || 900;
  const g = ac.createGain(); g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(ac.destination); src.start();
}
const sfx = {
  quick() { blip(300, 120, 0.08, 0.25, 'square'); noiseBurst(0.05, 0.15, 2200); },
  heavy() { blip(150, 55, 0.22, 0.5, 'sawtooth'); noiseBurst(0.14, 0.3, 500); },
  block() { blip(1500, 900, 0.04, 0.22, 'square'); blip(2100, 1400, 0.05, 0.12, 'triangle'); },
  shove() { noiseBurst(0.2, 0.3, 300); blip(200, 70, 0.25, 0.3, 'sawtooth'); },
  flip() { blip(220, 660, 0.18, 0.14, 'sine'); noiseBurst(0.16, 0.1, 1400); },
  jump() { blip(180, 320, 0.09, 0.1, 'sine'); },
  swingQ() { noiseBurst(0.06, 0.08, 1800); },
  swingH() { noiseBurst(0.16, 0.16, 700); },
  ko() { blip(110, 38, 1.1, 0.6, 'sine'); blip(220, 76, 0.9, 0.2, 'sine'); noiseBurst(0.4, 0.35, 200); },
  pit() { noiseBurst(0.55, 0.4, 380); blip(95, 28, 1.0, 0.55, 'sawtooth'); blip(1900, 700, 0.35, 0.1, 'triangle'); noiseBurst(0.3, 0.2, 2600); },
  fight() { blip(90, 60, 0.25, 0.5, 'sine'); noiseBurst(0.12, 0.3, 250); },
  tap() { blip(700, 500, 0.05, 0.12, 'triangle'); },
};

// ---------- input ----------
// Each player owns the strip at their edge. In that player's OWN frame the
// left half is the move pad, the right half is the three buttons. The top
// player's frame is the screen rotated 180 deg, so we map every touch into
// "local" coords (as if it were the bottom strip) and share all the logic.
const FLICK_DIST = 42, FLICK_TIME = 150, BLOCK_DIST = 30, RUN_DIV = 44;

function makeTouchState() {
  return {
    move: null, // {id, sx, sy, x, y, t0, moved, jumped}
    blockHeld: false,
    mxLocal: 0,
    edges: { jump: false, quick: false, heavy: false, flip: false },
    btnFlash: { quick: 0, heavy: 0, flip: 0 },
  };
}
const touch = [makeTouchState(), makeTouchState()];

// Button positions in the OWNER's local frame (bottom-strip coords).
// On wide displays (uiM > 0) the cluster grows and slides toward the corner,
// where tablet thumbs naturally rest; at uiM = 0 this is the phone layout.
function buttonsLocal() {
  const bz = zoneH;
  // grow tap targets with the display, but never past what the cluster
  // geometry can fit (the bz cap only ever binds when uiM > 0)
  const r1 = Math.min(Math.min(bz * 0.235, W * 0.085) * (1 + 0.15 * uiM), bz * 0.24);
  const r2 = r1 * 0.92;
  return {
    quick: { x: W * (0.635 + 0.035 * uiM), y: H - bz * 0.36, r: r1 },
    heavy: { x: W * (0.875 + 0.02 * uiM), y: H - bz * 0.42, r: r1 },
    flip: { x: W * (0.745 + 0.03 * uiM), y: H - bz * 0.75, r: r2 },
  };
}
// screen coords -> player local frame (0: identity, 1: rotate 180)
function toLocal(p, x, y) { return p === 0 ? { x, y } : { x: W - x, y: H - y }; }

function ownerOf(y) {
  if (y > H - zoneH) return 0;
  if (y < zoneH) return 1;
  return -1;
}

let sawTouch = false;
function pDown(id, x, y) {
  audioInit();
  if (shell.screen === 'title') { startGame(); return; }
  if (game.screen === 'over' && shell.overT > 40) { rematch(); return; }
  const p = ownerOf(y);
  if (p < 0) return;
  if (AI_ON && p === 1) return; // the AI owns the top edge in solo mode
  const ts = touch[p];
  const l = toLocal(p, x, y);
  if (l.x < W / 2) {
    if (!ts.move) ts.move = { id, sx: l.x, sy: l.y, x: l.x, y: l.y, t0: now(), moved: 0, jumped: false };
  } else {
    const B = buttonsLocal();
    for (const k of ['quick', 'heavy', 'flip']) {
      const btn = B[k];
      if (Math.hypot(l.x - btn.x, l.y - btn.y) <= btn.r * 1.3) {
        ts.edges[k] = true;
        ts.btnFlash[k] = 8;
        sfx.tap();
        break;
      }
    }
  }
}
function pMove(id, x, y) {
  for (let p = 0; p < 2; p++) {
    const ts = touch[p];
    if (!ts.move || ts.move.id !== id) continue;
    const l = toLocal(p, x, y);
    ts.move.x = l.x; ts.move.y = l.y;
    const dx = l.x - ts.move.sx, dy = l.y - ts.move.sy;
    if (!ts.move.moved && Math.hypot(dx, dy) > 5) ts.move.moved = now();
    // upward flick = jump (in the player's own frame, up = away from their edge)
    if (!ts.move.jumped && -dy > FLICK_DIST && Math.abs(dy) > Math.abs(dx) &&
        ts.move.moved && now() - ts.move.moved < FLICK_TIME) {
      ts.move.jumped = true;
      ts.edges.jump = true;
    }
  }
}
function pUp(id) {
  for (let p = 0; p < 2; p++) {
    const ts = touch[p];
    if (ts.move && ts.move.id === id) { ts.move = null; ts.blockHeld = false; ts.mxLocal = 0; }
  }
}
function now() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); }

function bindInput() {
  const opt = { passive: false };
  canvas.addEventListener('touchstart', (e) => { sawTouch = true; e.preventDefault(); for (const t of e.changedTouches) pDown(t.identifier, t.clientX, t.clientY); }, opt);
  canvas.addEventListener('touchmove', (e) => { e.preventDefault(); for (const t of e.changedTouches) pMove(t.identifier, t.clientX, t.clientY); }, opt);
  canvas.addEventListener('touchend', (e) => { e.preventDefault(); for (const t of e.changedTouches) pUp(t.identifier); }, opt);
  canvas.addEventListener('touchcancel', (e) => { for (const t of e.changedTouches) pUp(t.identifier); }, opt);
  canvas.addEventListener('pointerdown', (e) => { if (!sawTouch) { e.preventDefault(); pDown(e.pointerId, e.clientX, e.clientY); } }, opt);
  canvas.addEventListener('pointermove', (e) => { if (!sawTouch) pMove(e.pointerId, e.clientX, e.clientY); }, opt);
  canvas.addEventListener('pointerup', (e) => { if (!sawTouch) pUp(e.pointerId); }, opt);
  canvas.addEventListener('pointercancel', (e) => { if (!sawTouch) pUp(e.pointerId); }, opt);
}

// Build this sim-step's InputFrame for player p (consumes edges).
function pollInput(p) {
  const ts = touch[p];
  const inp = SIM.emptyInput();
  if (ts.move) {
    const dx = ts.move.x - ts.move.sx, dy = ts.move.y - ts.move.sy;
    // pronounced downward drag-and-hold = block (held while it stays down)
    ts.blockHeld = dy > BLOCK_DIST && Math.abs(dy) >= Math.abs(dx) * 0.8;
    ts.mxLocal = ts.blockHeld ? 0 : Math.max(-1, Math.min(1, dx / RUN_DIV));
  } else {
    ts.blockHeld = false; ts.mxLocal = 0;
  }
  inp.block = ts.blockHeld;
  // the top player's local +x is the world's -x
  inp.mx = p === 0 ? ts.mxLocal : -ts.mxLocal;
  inp.jump = ts.edges.jump;
  inp.quick = ts.edges.quick;
  inp.heavy = ts.edges.heavy;
  inp.flip = ts.edges.flip;
  ts.edges.jump = ts.edges.quick = ts.edges.heavy = ts.edges.flip = false;
  return inp;
}

// ---------- flow ----------
function startGame() {
  shell.screen = 'game';
  SIM.resetMatch(game);
  if (AI_ON) ai = SIM.createAI((Date.now() % 100000) | 1);
  shell.overT = 0;
  shell.trails = [[], []];
  sfx.fight();
}
function rematch() { startGame(); }

// ---------- sim step + event reactions ----------
let prevScreen = 'intro';
let prevMove = [null, null];
let prevG = [1, -1];

function stepSim() {
  const i0 = pollInput(0);
  const i1 = AI_ON ? SIM.aiInput(game, ai) : pollInput(1);
  const evs = SIM.step(game, [i0, i1]);

  // audio/fx reactions to sim happenings
  for (let i = 0; i < 2; i++) {
    const f = game.fighters[i];
    if (f.move && f.move !== prevMove[i]) {
      if (f.move === 'quick') sfx.swingQ();
    }
    if (f.move === 'heavy' && f.mf === C.HEAVY.startup + 1 && f.hitstop === 0) sfx.swingH();
    prevMove[i] = f.move;
    if (f.g !== prevG[i]) {
      // flips are unlimited now — soft-throttle only the SOUND so spam
      // doesn't clip the mix (the sim itself has no rate limit)
      if (shell.t - shell.flipSfxT > 5) { sfx.flip(); shell.flipSfxT = shell.t; }
      prevG[i] = f.g;
    }
  }
  for (const e of evs) {
    if (e.type === 'hit') {
      inkBurst(e.x, e.y, e.heavy ? 26 : 12, PCOL[e.victim], e.heavy ? 0.28 : 0.16);
      shell.rings.push({ x: e.x, y: e.y, r: 0.2, life: 12, max: 12 });
      shell.nudgeX = (Math.random() - 0.5) * (e.heavy ? 14 : 7);
      shell.nudgeY = (Math.random() - 0.5) * (e.heavy ? 14 : 7);
      if (e.heavy) sfx.heavy(); else sfx.quick();
    } else if (e.type === 'block') {
      inkBurst(e.x, e.y, e.heavy ? 14 : 7, '#efe6cf', 0.14);
      shell.jolt[e.victim] = 9;
      if (e.heavy) sfx.shove(); else sfx.block();
    } else if (e.type === 'ko') {
      inkBurst(e.x, e.y, 44, INK, 0.4);
      inkBurst(e.x, e.y, 20, PCOL[e.victim], 0.3);
      shell.rings.push({ x: e.x, y: e.y, r: 0.3, life: 26, max: 26 });
      shell.shake = 14;
      shell.flash = 8;
      sfx.ko();
    } else if (e.type === 'pitdeath') {
      // swallowed by a crack: a column of embers, a flash, a sizzle-gong
      const dir = e.ceiling ? -1 : 1;
      fireBurst(e.x, e.y - dir * 0.1, 46, dir);
      inkBurst(e.x, e.y + dir * 0.2, 14, INK, 0.22);
      shell.rings.push({ x: e.x, y: e.y, r: 0.3, life: 24, max: 24 });
      shell.shake = 14;
      shell.flash = 8;
      sfx.pit();
    }
  }
  if (game.screen === 'fight' && prevScreen === 'intro') sfx.fight();
  if (game.screen === 'over') shell.overT++;
  prevScreen = game.screen;

  // staff-tip trails while swings are active-ish
  for (let i = 0; i < 2; i++) {
    const f = game.fighters[i];
    if (f.move !== null) {
      const m = f.move === 'quick' ? C.QUICK : C.HEAVY;
      if (f.mf > m.startup - 2 && f.mf <= m.startup + m.active + 1 && f.hitstop === 0) {
        const tip = staffTipWorld(f);
        shell.trails[i].push({ x: tip.x, y: tip.y, life: 13, max: 13 });
      }
    }
    // flip afterimage streak
    if (f.flipAnimT < C.FLIP_ANIM) {
      shell.trails[i].push({ x: f.x, y: f.y, life: 10, max: 10, blob: true });
    }
  }
  for (const tr of shell.trails) for (const q of tr) q.life--;
  shell.trails[0] = shell.trails[0].filter(q => q.life > 0);
  shell.trails[1] = shell.trails[1].filter(q => q.life > 0);
  if (shell.jolt[0] > 0) shell.jolt[0]--;
  if (shell.jolt[1] > 0) shell.jolt[1]--;
}

function inkBurst(x, y, n, col, speed) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random());
    shell.particles.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      life: 18 + Math.random() * 22 | 0, size: 0.05 + Math.random() * 0.12,
      col: Math.random() < 0.7 ? col : INK,
    });
  }
}
const EMBER_COLS = ['#ffb02e', '#ff7a2e', '#e04a1c', '#ffd77a'];
// dir: +1 = embers rise (floor crack), -1 = embers sink (ceiling crack)
function fireBurst(x, y, n, dir) {
  const d = dir || 1;
  for (let i = 0; i < n; i++) {
    shell.particles.push({
      x: x + (Math.random() - 0.5) * 0.8, y: y + d * Math.random() * 0.3,
      vx: (Math.random() - 0.5) * 0.14, vy: d * (0.08 + Math.random() * 0.22),
      life: 24 + Math.random() * 30 | 0, size: 0.04 + Math.random() * 0.1,
      col: EMBER_COLS[(Math.random() * EMBER_COLS.length) | 0], ember: true,
    });
  }
}
// ambient embers drifting out of both cracks, every frame the panel is live —
// rising from the floor crack, sinking from the ceiling one (so each reads as
// fire licking "up" from its owner's point of view)
function pitAmbient() {
  for (const p of C.PITS) {
    if (Math.random() >= 0.35) continue;
    shell.particles.push({
      x: p.x0 + 0.15 + Math.random() * (p.x1 - p.x0 - 0.3),
      y: p.ceiling ? C.AH - 0.05 : 0.05,
      vx: (Math.random() - 0.5) * 0.02,
      vy: (p.ceiling ? -1 : 1) * (0.02 + Math.random() * 0.05),
      life: 36 + Math.random() * 44 | 0, size: 0.03 + Math.random() * 0.07,
      col: EMBER_COLS[(Math.random() * EMBER_COLS.length) | 0], ember: true,
    });
  }
}

// ---------- fighter pose + choreography ----------
// Local frame: feet at y=0, up positive, +x = toward the opponent (front).
// The staff is a pivot point + angle; tips at pivot +/- dir * (tf|tb).
const STAFF_W = 0.075;
const d2r = (d) => d * Math.PI / 180;
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => 1 - Math.pow(1 - t, 3);
const clamp01 = (t) => t < 0 ? 0 : t > 1 ? 1 : t;

function basePose() {
  return {
    hip: { x: -0.02, y: 0.8 }, chest: { x: 0.02, y: 1.3 }, head: { x: 0.05, y: 1.66 },
    footF: { x: 0.3, y: 0 }, footB: { x: -0.26, y: 0 },
    kneeBend: 0.1,
    staff: { px: 0.22, py: 0.95, ang: d2r(62), tf: 1.15, tb: 1.05 },
    handSlide: 0, // 0 = guard grip, 1 = hands at the butt end (heavy regrip)
    lean: 0,
  };
}

function guardSway(p, t) {
  p.staff.ang += Math.sin(t * 0.05) * d2r(2.5); // breathing sway in the guard
  p.chest.y += Math.sin(t * 0.05 + 1) * 0.015;
  p.head.y += Math.sin(t * 0.05 + 1) * 0.02;
}

function poseFor(f, t) {
  const p = basePose();
  const s = f.state;

  if (s === 'ko') {
    const k = clamp01(f.koT / 26);
    p.hip = { x: lerp(-0.05, -0.15, k), y: lerp(0.6, 0.2, k) };
    p.chest = { x: lerp(-0.2, -0.5, k), y: lerp(1.0, 0.34, k) };
    p.head = { x: lerp(-0.3, -0.78, k), y: lerp(1.3, 0.34, k) };
    p.footF = { x: 0.55, y: 0 }; p.footB = { x: -0.35, y: 0.04 };
    // the staff drops from the hands and lies on the ground
    p.staff = { px: lerp(0.2, 0.6, k), py: lerp(0.8, 0.05, k), ang: lerp(d2r(50), d2r(2), k), tf: 1.15, tb: 1.05 };
    p.staffDropped = true;
    return p;
  }
  if (s === 'hitstun') {
    const w = Math.sin(t * 0.8);
    p.chest.x = -0.26; p.head.x = -0.38; p.head.y = 1.58;
    p.hip.x = 0.06;
    p.footF = { x: 0.42, y: 0.12 }; p.footB = { x: -0.3, y: 0.06 };
    p.staff = { px: -0.1, py: 0.9, ang: d2r(30 + w * 26), tf: 1.15, tb: 1.05 };
    return p;
  }
  if (s === 'block' || f.blockF > 0) {
    // vertical staff wall, arms extended, weight dropped into a wide brace
    p.hip = { x: -0.05, y: 0.66 };
    p.chest = { x: 0.1, y: 1.14 }; p.head = { x: 0.12, y: 1.5 };
    p.footF = { x: 0.48, y: 0 }; p.footB = { x: -0.46, y: 0 };
    p.kneeBend = 0.16;
    p.staff = { px: 0.62, py: 0.95, ang: d2r(90), tf: 1.06, tb: 1.0 };
    return p;
  }

  if (f.move === 'quick') return quickPose(p, f, t);
  if (f.move === 'heavy') return heavyPose(p, f, t);

  if (!f.grounded) {
    const tuck = f.flipAnimT < C.FLIP_ANIM ? 1 : 0.35;
    p.footF = { x: 0.28, y: 0.14 * tuck + 0.1 }; p.footB = { x: -0.16, y: 0.2 * tuck };
    p.hip.y = 0.86; p.kneeBend = 0.2;
    p.staff = { px: 0.16, py: 1.02, ang: d2r(14), tf: 1.15, tb: 1.05 };
    return p;
  }
  if (s === 'run') {
    const c = Math.sin(t * 0.42);
    p.footF = { x: 0.26 + c * 0.34, y: Math.max(0, c) * 0.16 };
    p.footB = { x: -0.22 - c * 0.34, y: Math.max(0, -c) * 0.16 };
    p.chest.x = 0.1; p.head.x = 0.14; p.hip.x = 0.03;
    p.kneeBend = 0.16;
    p.staff = { px: 0.24, py: 0.98, ang: d2r(56 + c * 4), tf: 1.15, tb: 1.05 };
    return p;
  }
  guardSway(p, t);
  return p;
}

// QUICK: wrist-lever snap — hands stay put, the top half whips a short frontal
// arc, then over-rotates a touch and settles back into guard.
function quickPose(p, f, t) {
  const su = C.QUICK.startup, ac = C.QUICK.active, rec = C.QUICK.rec;
  const st = p.staff;
  if (f.mf <= su) {
    const k = ease(clamp01(f.mf / su));
    st.ang = d2r(lerp(62, 76, k)); // small cock-back
    st.px -= 0.05 * k;
  } else if (f.mf <= su + ac) {
    const k = ease(clamp01((f.mf - su) / ac));
    st.ang = d2r(lerp(76, -16, k)); // SNAP through the frontal plane
    st.px = lerp(0.17, 0.5, k); st.py = lerp(0.95, 1.02, k);
    st.tf = lerp(1.15, 1.3, k);
    p.chest.x = 0.1 + 0.08 * k; p.lean = 0.06 * k;
    p.footF.x = 0.3 + 0.12 * k;
  } else {
    const k = clamp01((f.mf - su - ac) / rec);
    // return with a few degrees of over-rotation, then settle
    const ang = k < 0.55 ? lerp(-16, 70, ease(k / 0.55)) : lerp(70, 62, (k - 0.55) / 0.45);
    st.ang = d2r(ang);
    st.px = lerp(0.5, 0.22, k); st.py = lerp(1.02, 0.95, k);
    st.tf = lerp(1.3, 1.15, k);
  }
  return p;
}

// HEAVY: (1) the tell — hands visibly slide down the shaft to the butt end as
// the staff swings up over the head; (2) full overhead arc at max extension
// with a body lunge; (3) the held, overextended finish; (4) re-slide to guard.
function heavyPose(p, f, t) {
  const su = C.HEAVY.startup, ac = C.HEAVY.active, hold = C.HEAVY.hold;
  const st = p.staff;
  if (f.mf <= su) {
    const k = ease(clamp01(f.mf / su));
    p.handSlide = k; // the regrip tell
    st.tf = lerp(1.15, 1.95, k); st.tb = lerp(1.05, 0.25, k);
    st.ang = d2r(lerp(62, 122, k)); // up and back over the head
    st.px = lerp(0.22, -0.06, k); st.py = lerp(0.95, 1.4, k);
    p.hip.y = lerp(0.8, 0.72, k); p.chest.x = lerp(0.02, -0.14, k);
    p.head.x = lerp(0.05, -0.08, k);
  } else if (f.mf <= su + ac) {
    const k = ease(clamp01((f.mf - su) / ac));
    p.handSlide = 1;
    st.tf = 1.95; st.tb = 0.25;
    st.ang = d2r(lerp(122, -27, k)); // the dramatic full overhead arc
    st.px = lerp(-0.06, 0.4, k); st.py = lerp(1.4, 1.22, k);
    p.chest.x = lerp(-0.14, 0.3, k); p.hip.x = lerp(-0.02, 0.14, k);
    p.head.x = lerp(-0.08, 0.34, k);
    p.footF = { x: 0.3 + 0.34 * k, y: 0 }; p.kneeBend = 0.22;
  } else if (f.mf <= su + ac + hold) {
    // HELD FINISH — fully extended, tip low, leaned into the follow-through
    const quiver = Math.sin(t * 1.35) * d2r(0.9) * Math.max(0, 1 - (f.mf - su - ac) / 10);
    p.handSlide = 1;
    st.tf = 1.95; st.tb = 0.25;
    st.ang = d2r(-25) + quiver;
    st.px = 0.4; st.py = 1.2;
    p.chest.x = 0.3; p.hip.x = 0.14; p.head.x = 0.34; p.head.y = 1.6;
    p.footF = { x: 0.64, y: 0 }; p.kneeBend = 0.24;
    p.hip.y = 0.74;
  } else {
    const k = clamp01((f.mf - su - ac - hold) / C.HEAVY.rec);
    p.handSlide = 1 - k; // re-slide the grip home
    st.tf = lerp(1.95, 1.15, k); st.tb = lerp(0.25, 1.05, k);
    const ang = k < 0.6 ? lerp(-25, 70, ease(k / 0.6)) : lerp(70, 62, (k - 0.6) / 0.4);
    st.ang = d2r(ang);
    st.px = lerp(0.4, 0.22, k); st.py = lerp(1.2, 0.95, k);
    p.chest.x = lerp(0.3, 0.02, k); p.head.x = lerp(0.34, 0.05, k);
    p.footF = { x: lerp(0.64, 0.3, k), y: 0 };
  }
  return p;
}

// world position of the staff's striking tip (for trails)
function staffTipWorld(f) {
  const p = poseFor(f, shell.t);
  const st = p.staff;
  const lx = st.px + Math.cos(st.ang) * st.tf;
  const ly = st.py + Math.sin(st.ang) * st.tf;
  return localToWorld(f, lx, ly);
}
function localToWorld(f, lx, ly) {
  const rot = fighterRot(f);
  const mx = f.facing * (f.g === 1 ? 1 : -1);
  let x = mx * lx, y = ly - C.FH / 2;
  const c = Math.cos(rot), s = Math.sin(rot);
  return { x: f.x + x * c - y * s, y: f.y + x * s + y * c };
}
// somersault: ease from the old orientation to the new one, spinning forward
function fighterRot(f) {
  const target = f.g === 1 ? 0 : Math.PI;
  if (f.flipAnimT >= C.FLIP_ANIM) return target;
  const k = ease(clamp01(f.flipAnimT / C.FLIP_ANIM));
  const dir = f.flipDir >= 0 ? -1 : 1;
  return target - dir * Math.PI * (1 - k);
}

function drawFighter(f, i) {
  const p = poseFor(f, shell.t);
  const rot = fighterRot(f);
  const mx = f.facing * (f.g === 1 ? 1 : -1);
  const col = PCOL[i];

  ctx.save();
  ctx.translate(px(f.x), py(f.y));
  ctx.scale(ar.s, -ar.s);
  ctx.rotate(rot);
  ctx.scale(mx, 1);
  ctx.translate(0, -C.FH / 2);
  if (shell.jolt[i] > 0) ctx.translate(-(shell.jolt[i] / 9) * 0.16, 0);

  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  const st = p.staff;
  const dirx = Math.cos(st.ang), diry = Math.sin(st.ang);
  const tipF = { x: st.px + dirx * st.tf, y: st.py + diry * st.tf };
  const tipB = { x: st.px - dirx * st.tb, y: st.py - diry * st.tb };
  // hand positions along the staff (slide toward the butt for the heavy tell)
  const hf = lerp(0.34, -0.02, p.handSlide || 0);
  const hb = lerp(-0.14, -0.3, p.handSlide || 0);
  const handF = p.staffDropped ? { x: 0.15, y: 0.5 } : { x: st.px + dirx * hf, y: st.py + diry * hf };
  const handB = p.staffDropped ? { x: -0.2, y: 0.42 } : { x: st.px + dirx * hb, y: st.py + diry * hb };

  // --- staff (behind the body) ---
  ctx.strokeStyle = '#2e2117';
  ctx.lineWidth = STAFF_W;
  ctx.beginPath(); ctx.moveTo(tipB.x, tipB.y); ctx.lineTo(tipF.x, tipF.y); ctx.stroke();
  // team-color wraps at both tips
  ctx.strokeStyle = col; ctx.lineWidth = STAFF_W * 1.25;
  const wrap = (t0, t1) => {
    ctx.beginPath();
    ctx.moveTo(lerp(tipB.x, tipF.x, t0), lerp(tipB.y, tipF.y, t0));
    ctx.lineTo(lerp(tipB.x, tipF.x, t1), lerp(tipB.y, tipF.y, t1));
    ctx.stroke();
  };
  wrap(0, 0.09); wrap(0.91, 1);

  // --- body: brush-ink limbs with soft knees/elbows ---
  ctx.strokeStyle = INK;
  const limb = (a, b, w, bend, side) => {
    ctx.lineWidth = w;
    const mxp = (a.x + b.x) / 2, myp = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
    const nx = (-dy / L) * bend * side, ny = (dx / L) * bend * side;
    ctx.beginPath(); ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(mxp + nx, myp + ny, b.x, b.y); ctx.stroke();
  };
  limb(p.hip, p.footB, 0.1, p.kneeBend, 1); // back leg
  limb(p.hip, p.footF, 0.1, p.kneeBend, -1); // front leg
  limb(p.hip, p.chest, 0.13, 0.05, 1); // torso
  limb(p.chest, handB, 0.085, 0.08, 1); // back arm
  limb(p.chest, handF, 0.085, 0.08, -1); // front arm

  // sash — the team read
  ctx.strokeStyle = col; ctx.globalAlpha = 0.95;
  limb({ x: p.chest.x - 0.14, y: p.chest.y + 0.06 }, { x: p.hip.x + 0.14, y: p.hip.y - 0.02 }, 0.1, 0.06, -1);
  ctx.globalAlpha = 1;

  // head + headband with flowing tails
  ctx.fillStyle = INK;
  ctx.beginPath(); ctx.arc(p.head.x, p.head.y, 0.17, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 0.055;
  ctx.beginPath(); ctx.arc(p.head.x, p.head.y, 0.17, d2r(150), d2r(390)); ctx.stroke();
  const wavy = Math.sin(shell.t * 0.2 + i * 3) * 0.06 - f.vx * mx * 0.6;
  ctx.lineWidth = 0.045;
  ctx.beginPath();
  ctx.moveTo(p.head.x - 0.15, p.head.y + 0.05);
  ctx.quadraticCurveTo(p.head.x - 0.36, p.head.y + 0.05 + wavy, p.head.x - 0.52, p.head.y - 0.06 + wavy * 1.6);
  ctx.stroke();

  // hands as small ink dots (they sell the regrip)
  ctx.fillStyle = INK;
  ctx.beginPath(); ctx.arc(handF.x, handF.y, 0.06, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(handB.x, handB.y, 0.06, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}

// ---------- world-space fx ----------
// The molten cracks: flickering glow pouring out of each burnt gap — up from
// the floor crack, down from the ceiling one. Each is unmistakable from both
// seats (from your own seat, your crack glows up out of your floor).
function drawPitGlow() {
  for (let i = 0; i < C.PITS.length; i++) {
    const p = C.PITS[i];
    const gx0 = px(p.x0), gx1 = px(p.x1), gy = py(p.ceiling ? C.AH : 0);
    const s = p.ceiling ? 1 : -1; // pixel-y direction pointing INTO the arena
    const flick = 0.7 + 0.2 * Math.sin(shell.t * 0.11 + i * 2.1) + 0.1 * Math.sin(shell.t * 0.37 + 1.7 + i);
    const h = ar.s * 2.8;
    const grad = ctx.createLinearGradient(0, gy, 0, gy + s * h);
    grad.addColorStop(0, `rgba(255,122,40,${0.42 * flick})`);
    grad.addColorStop(0.4, `rgba(255,150,60,${0.16 * flick})`);
    grad.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(gx0 - ar.s * 0.4, Math.min(gy, gy + s * h), (gx1 - gx0) + ar.s * 0.8, h);
    // molten core lines along the gap
    const core = Math.max(2.5, ar.s * 0.12), core2 = Math.max(2, ar.s * 0.07);
    ctx.fillStyle = `rgba(255,190,80,${0.45 + 0.35 * flick})`;
    ctx.fillRect(gx0, Math.min(gy, gy + s * core), gx1 - gx0, core);
    const wob = Math.sin(shell.t * 0.23 + i * 3) * 0.3;
    ctx.fillStyle = `rgba(255,240,180,${0.35 * flick})`;
    ctx.fillRect(gx0 + ar.s * (0.4 + wob), Math.min(gy, gy + s * core2), (gx1 - gx0) - ar.s * (0.8 + wob * 2), core2);
  }
}

function drawTrails() {
  for (let i = 0; i < 2; i++) {
    const tr = shell.trails[i];
    ctx.strokeStyle = PCOL[i];
    ctx.fillStyle = PCOL[i];
    ctx.lineCap = 'round';
    for (let k = 1; k < tr.length; k++) {
      const a = tr[k - 1], b = tr[k];
      if (a.blob || b.blob) continue;
      const al = (b.life / b.max);
      ctx.globalAlpha = al * 0.5;
      ctx.lineWidth = Math.max(1.5, ar.s * 0.12 * al);
      ctx.beginPath(); ctx.moveTo(px(a.x), py(a.y)); ctx.lineTo(px(b.x), py(b.y)); ctx.stroke();
    }
    for (const q of tr) {
      if (!q.blob) continue;
      ctx.globalAlpha = (q.life / q.max) * 0.18;
      ctx.beginPath(); ctx.arc(px(q.x), py(q.y), ar.s * 0.5, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}
function drawParticles() {
  for (const pt of shell.particles) {
    pt.x += pt.vx; pt.y += pt.vy;
    if (pt.ember) { pt.vy *= 0.985; pt.vx += (Math.random() - 0.5) * 0.01; } // embers waft up
    else { pt.vy -= 0.006; pt.vx *= 0.97; pt.vy *= 0.97; }
    pt.life--;
    const flick = pt.ember ? 0.6 + 0.4 * Math.random() : 1;
    ctx.globalAlpha = Math.min(1, pt.life / 12) * 0.85 * flick;
    ctx.fillStyle = pt.col;
    ctx.beginPath(); ctx.arc(px(pt.x), py(pt.y), pt.size * ar.s, 0, Math.PI * 2); ctx.fill();
  }
  shell.particles = shell.particles.filter(pt => pt.life > 0);
  for (const r of shell.rings) {
    r.life--; r.r += 0.14;
    ctx.globalAlpha = (r.life / r.max) * 0.6;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(px(r.x), py(r.y), r.r * ar.s, 0, Math.PI * 2); ctx.stroke();
  }
  shell.rings = shell.rings.filter(r => r.life > 0);
  ctx.globalAlpha = 1;
}

// ---------- HUD (readable from both edges) ----------
function withRot180(cx, cy, fn) {
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.PI); ctx.translate(-cx, -cy); fn(); ctx.restore();
}
// Draw one player's bar/pips laid out for the BOTTOM edge at band centre cy.
function drawHudBand(i, cy) {
  const f = game.fighters[i];
  const bw = Math.min(W * 0.56, 340 + 200 * uiM), bh = 13 + 4 * uiM;
  const bx = W * 0.06, by = cy - bh / 2;
  // brush-stroke trough
  ctx.fillStyle = 'rgba(34,28,38,0.5)';
  rrect(bx - 2, by - 2, bw + 4, bh + 4, 6); ctx.fill();
  // ink fill
  const frac = Math.max(0, f.hp / C.HP);
  ctx.fillStyle = PCOL[i];
  if (frac > 0) { rrect(bx, by, bw * frac, bh, 5); ctx.fill(); }
  // low-health flicker
  if (f.hp <= 25 && f.hp > 0 && (shell.t & 16)) {
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    rrect(bx, by, Math.max(bw * frac, 1), bh, 5); ctx.fill();
  }
  // name lives inside the bar so it never collides with the arena frame
  ctx.fillStyle = 'rgba(240,230,205,0.92)';
  ctx.font = `700 ${10 + 3 * uiM}px ${FONT}`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(PNAME[i] + (AI_ON && i === 1 ? ' · AI' : ''), bx + 7, cy + 0.5);
  // round pips
  const pipR = 5.5 + 2 * uiM, pipGap = 18 + 6 * uiM;
  for (let k = 0; k < C.ROUNDS_TO_WIN; k++) {
    const cxp = bx + bw + pipGap + k * pipGap;
    ctx.beginPath(); ctx.arc(cxp, cy, pipR, 0, Math.PI * 2);
    if (k < game.wins[i]) { ctx.fillStyle = PCOL[i]; ctx.fill(); }
    else { ctx.strokeStyle = 'rgba(240,230,205,0.5)'; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
}
function rrect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function drawHUD() {
  const y0 = H - zoneH - 17; // band between arena and bottom zone
  const y1 = zoneH + 17;
  drawHudBand(0, y0);
  withRot180(W / 2, y1, () => drawHudBand(1, y1));
  if (AI_ON) {
    ctx.fillStyle = 'rgba(240,230,205,0.55)';
    ctx.font = `700 10px ${FONT}`;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText('VS AI', W - 10, y0);
  }
}

// ---------- control zones ----------
function drawZoneFor(p) {
  // draw in the owner's local frame (bottom strip), then the caller rotates
  const ts = touch[p];
  const col = PCOL[p];
  const bz = zoneH;
  const topY = H - bz;
  // separator
  ctx.strokeStyle = 'rgba(240,230,205,0.12)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, topY); ctx.lineTo(W, topY); ctx.stroke();
  ctx.strokeStyle = col; ctx.globalAlpha = 0.5; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(0, topY); ctx.lineTo(W, topY); ctx.stroke();
  ctx.globalAlpha = 1;

  const dim = AI_ON && p === 1 ? 0.3 : 1;
  ctx.globalAlpha = dim;

  // move pad (left half) — drifts toward the corner on wide displays
  const pcx = W * (0.25 - 0.06 * uiM), pcy = H - bz * 0.52;
  if (ts.move) {
    ctx.strokeStyle = ts.blockHeld ? col : 'rgba(240,230,205,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(ts.move.sx, ts.move.sy, 30, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = ts.blockHeld ? col : 'rgba(240,230,205,0.75)';
    const kx = ts.move.sx + Math.max(-44, Math.min(44, ts.move.x - ts.move.sx));
    const ky = ts.move.sy + Math.max(-44, Math.min(44, ts.move.y - ts.move.sy));
    ctx.beginPath(); ctx.arc(kx, ky, 15, 0, Math.PI * 2); ctx.fill();
    if (ts.blockHeld) {
      ctx.font = `700 12px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = col;
      ctx.fillText('BLOCK', ts.move.sx, ts.move.sy - 44);
    }
  } else {
    ctx.strokeStyle = 'rgba(240,230,205,0.22)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(pcx, pcy, 26, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(240,230,205,0.35)';
    ctx.font = `10px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('drag ↔ run', pcx, pcy - 40);
    ctx.fillText('flick ↑ jump  ·  hold ↓ block', pcx, pcy + 44);
  }

  // buttons (right half)
  const B = buttonsLocal();
  for (const k of ['quick', 'heavy', 'flip']) {
    const btn = B[k];
    const flash = ts.btnFlash[k];
    if (flash > 0) ts.btnFlash[k]--;
    ctx.beginPath(); ctx.arc(btn.x, btn.y, btn.r, 0, Math.PI * 2);
    ctx.fillStyle = flash > 0 ? 'rgba(240,230,205,0.28)' : 'rgba(240,230,205,0.07)';
    ctx.fill();
    ctx.strokeStyle = k === 'flip' ? col : 'rgba(240,230,205,0.55)';
    ctx.lineWidth = k === 'flip' ? 2.5 : 1.8;
    ctx.stroke();
    // glyphs
    ctx.strokeStyle = 'rgba(240,230,205,0.85)'; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    if (k === 'quick') { // single snap slash
      ctx.beginPath();
      ctx.moveTo(btn.x - btn.r * 0.42, btn.y + btn.r * 0.32);
      ctx.quadraticCurveTo(btn.x + btn.r * 0.1, btn.y - btn.r * 0.1, btn.x + btn.r * 0.46, btn.y - btn.r * 0.38);
      ctx.stroke();
    } else if (k === 'heavy') { // overhead arc + impact dot
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.arc(btn.x - btn.r * 0.1, btn.y + btn.r * 0.15, btn.r * 0.55, d2r(-140), d2r(-10));
      ctx.stroke();
      ctx.fillStyle = 'rgba(240,230,205,0.85)';
      ctx.beginPath(); ctx.arc(btn.x + btn.r * 0.44, btn.y + btn.r * 0.28, 3, 0, Math.PI * 2); ctx.fill();
    } else { // flip: two opposed arrows
      ctx.strokeStyle = col;
      ctx.beginPath(); ctx.moveTo(btn.x - btn.r * 0.28, btn.y + btn.r * 0.34); ctx.lineTo(btn.x - btn.r * 0.28, btn.y - btn.r * 0.3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(btn.x - btn.r * 0.44, btn.y - btn.r * 0.08); ctx.lineTo(btn.x - btn.r * 0.28, btn.y - btn.r * 0.34); ctx.lineTo(btn.x - btn.r * 0.12, btn.y - btn.r * 0.08); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(btn.x + btn.r * 0.28, btn.y - btn.r * 0.34); ctx.lineTo(btn.x + btn.r * 0.28, btn.y + btn.r * 0.3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(btn.x + btn.r * 0.12, btn.y + btn.r * 0.08); ctx.lineTo(btn.x + btn.r * 0.28, btn.y + btn.r * 0.34); ctx.lineTo(btn.x + btn.r * 0.44, btn.y + btn.r * 0.08); ctx.stroke();
      // no cooldown on FLIP — the button is always live
    }
    ctx.fillStyle = 'rgba(240,230,205,0.5)';
    ctx.font = `9px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(k.toUpperCase(), btn.x, btn.y + btn.r + 10);
  }
  ctx.globalAlpha = 1;
}
function drawZones() {
  drawZoneFor(0);
  withRot180(W / 2, H / 2, () => drawZoneFor(1));
  if (AI_ON) {
    withRot180(W / 2, H / 2, () => {
      ctx.fillStyle = 'rgba(240,230,205,0.5)';
      ctx.font = `700 14px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('AI', W / 2, H - zoneH * 0.5);
    });
  }
}

// ---------- banners (duplicated for both edges) ----------
function bothEdgesText(lines, colMain) {
  const draw = () => {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let y = H * 0.635;
    for (const [txt, size, col] of lines) {
      ctx.font = `700 ${size}px ${FONT}`;
      ctx.strokeStyle = 'rgba(34,28,38,0.25)'; ctx.lineWidth = 4;
      ctx.strokeText(txt, W / 2, y);
      ctx.fillStyle = col || colMain || INK;
      ctx.fillText(txt, W / 2, y);
      y += size * 1.3;
    }
  };
  draw();
  withRot180(W / 2, H / 2, draw);
}
function drawBanners() {
  const g = game;
  const cap = (v) => v * (1 + 0.4 * uiM); // banner type grows with the display
  if (g.screen === 'intro') {
    const last = g.wins[0] === C.ROUNDS_TO_WIN - 1 && g.wins[1] === C.ROUNDS_TO_WIN - 1;
    if (g.introT < C.INTRO_F - 26) {
      bothEdgesText([[last ? 'FINAL ROUND' : `ROUND ${g.roundNum + 1}`, Math.min(cap(40), W * 0.09)]], INK);
    } else {
      bothEdgesText([['FIGHT', Math.min(cap(54), W * 0.12)]], P0COL);
    }
  } else if (g.screen === 'roundend') {
    const w = g.roundWinner;
    const pit = g.roundEndCause === 'pit';
    bothEdgesText([
      pit ? ['INTO THE FIRE', Math.min(cap(36), W * 0.085), '#c8511f'] : ['K.O.', Math.min(cap(56), W * 0.13), INK],
      [`${PNAME[w]} takes the round`, Math.min(cap(19), W * 0.045), PCOL[w]],
    ]);
  } else if (g.screen === 'over') {
    const w = g.winner;
    bothEdgesText([
      [`${PNAME[w]} WINS`, Math.min(cap(42), W * 0.1), PCOL[w]],
      [`${g.wins[0]} — ${g.wins[1]}`, Math.min(cap(24), W * 0.06), INK],
      ['tap for a rematch', Math.min(cap(15), W * 0.038), 'rgba(34,28,38,0.75)'],
    ]);
  }
}

// ---------- explainer (single upright screen, read together, then lay flat) ----------
function drawTitle() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // room + a tall paper scroll
  ctx.fillStyle = '#151019'; ctx.fillRect(0, 0, W, H);
  const m = Math.min(W * 0.055, 26);
  const sx = m, sy = m * 0.8, sw = W - m * 2, sh = H - m * 1.6;
  ctx.fillStyle = WOOD; ctx.fillRect(sx - 6, sy - 6, sw + 12, sh + 12);
  const pg = ctx.createLinearGradient(0, sy, 0, sy + sh);
  pg.addColorStop(0, PAPER_HI); pg.addColorStop(1, PAPER_LO);
  ctx.fillStyle = pg; ctx.fillRect(sx, sy, sw, sh);

  const cx = W / 2;
  const u = Math.min(W / 390, 1.25); // type scale
  let y = sy + sh * 0.055;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

  // title + seal
  ctx.fillStyle = INK;
  ctx.font = `700 ${44 * u}px ${FONT}`;
  ctx.fillText('FLIPSTAFF', cx, y);
  ctx.save();
  ctx.translate(cx + Math.min(W * 0.335, 148), y - 8 * u); ctx.rotate(-0.08);
  ctx.fillStyle = P0COL; ctx.globalAlpha = 0.8; ctx.fillRect(-11, -11, 22, 22);
  ctx.globalAlpha = 1; ctx.strokeStyle = PAPER_HI; ctx.lineWidth = 2;
  ctx.strokeRect(-6.5, -6.5, 13, 13);
  ctx.beginPath(); ctx.moveTo(-6.5, 0); ctx.lineTo(6.5, 0); ctx.stroke();
  ctx.restore();
  y += 27 * u;
  ctx.font = `${13.5 * u}px ${FONT}`;
  ctx.fillStyle = 'rgba(34,28,38,0.8)';
  ctx.fillText(AI_ON ? 'a staff duel in a box — you vs the AI' : 'a staff duel in a box — two players, one phone', cx, y);
  if (AI_ON) {
    ctx.fillStyle = P1COL; ctx.font = `700 ${11 * u}px ${FONT}`;
    ctx.fillText('VS AI', cx, y + 16 * u);
  }
  y += 24 * u;

  // arena diagram: closed box, two fighters, steps, fire pit, flip arc
  const dw = Math.min(sw * 0.56, 200 * u), dh = dw * 0.55;
  const dx0 = cx - dw / 2, dy0 = y;
  ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.strokeRect(dx0, dy0, dw, dh);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(34,28,38,0.5)';
  // the two shelves — exact 180° rotations of each other (true to the sim)
  ctx.strokeRect(dx0 + dw * 0.094, dy0 + dh * 0.665, dw * 0.5, dh * 0.055);
  ctx.strokeRect(dx0 + dw * 0.406, dy0 + dh * 0.28, dw * 0.5, dh * 0.055);
  // the fire cracks: one in each surface, point-symmetric about the centre
  const crack = (fx0, fx1, top) => {
    const yy = top ? dy0 : dy0 + dh;
    const s = top ? 1 : -1; // flame direction into the box
    ctx.strokeStyle = PAPER_HI; ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(dx0 + dw * fx0, yy); ctx.lineTo(dx0 + dw * fx1, yy);
    ctx.stroke();
    ctx.fillStyle = '#e0621f';
    const w = fx1 - fx0;
    ctx.beginPath();
    ctx.moveTo(dx0 + dw * (fx0 + w * 0.04), yy + s);
    ctx.lineTo(dx0 + dw * (fx0 + w * 0.33), yy + s * 7 * u);
    ctx.lineTo(dx0 + dw * (fx0 + w * 0.5), yy + s * 3 * u);
    ctx.lineTo(dx0 + dw * (fx0 + w * 0.68), yy + s * 8 * u);
    ctx.lineTo(dx0 + dw * (fx0 + w * 0.96), yy + s);
    ctx.closePath(); ctx.fill();
  };
  crack(11.5 / 16, 13.5 / 16, false); // floor crack, right
  crack(2.5 / 16, 4.5 / 16, true); // ceiling crack, left — its exact mirror
  const mini = (x, yy, col, up) => {
    ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    const s = up ? -1 : 1;
    ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x, yy - 12 * s); ctx.stroke(); // body
    ctx.beginPath(); ctx.arc(x, yy - 15 * s, 3, 0, Math.PI * 2); ctx.stroke(); // head
    ctx.beginPath(); ctx.moveTo(x - 6, yy - 4 * s); ctx.lineTo(x + 7, yy - 13 * s); ctx.stroke(); // staff
  };
  mini(dx0 + dw * 0.2, dy0 + dh - 4, P0COL, false);
  mini(dx0 + dw * 0.8, dy0 + 4, P1COL, true);
  // flip arc arrow
  ctx.strokeStyle = P0COL; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(dx0 + dw * 0.26, dy0 + dh - 10);
  ctx.quadraticCurveTo(dx0 + dw * 0.5, dy0 + dh * 0.4, dx0 + dw * 0.66, dy0 + 8);
  ctx.stroke(); ctx.setLineDash([]);
  y = dy0 + dh + 16 * u;
  ctx.fillStyle = 'rgba(34,28,38,0.85)';
  ctx.font = `${12 * u}px ${FONT}`;
  ctx.fillText('A closed box: floor AND ceiling are ground, plus two shelves.', cx, y); y += 14.5 * u;
  ctx.fillText('Your fighter stands upright on YOUR floor; FLIP inverts your', cx, y); y += 14.5 * u;
  ctx.fillText('gravity — somersault across, land feet-first. The arena is', cx, y); y += 14.5 * u;
  ctx.fillText('identical for both of you: rotated half a turn, nothing changes.', cx, y); y += 14.5 * u;
  ctx.fillStyle = '#b3491c';
  ctx.fillText('A molten crack burns near the far end of EACH surface:', cx, y); y += 14.5 * u;
  ctx.fillText('INSTANT DEATH. The escape is flipping to the other surface —', cx, y); y += 14.5 * u;
  ctx.fillText('its crack is on the opposite side.', cx, y); y += 22 * u;

  // controls
  const line = (head, body, col) => {
    ctx.font = `700 ${12 * u}px ${FONT}`;
    ctx.fillStyle = col || INK;
    ctx.fillText(head, cx, y); y += 14 * u;
    ctx.font = `${11.5 * u}px ${FONT}`;
    ctx.fillStyle = 'rgba(34,28,38,0.85)';
    for (const t of body) { ctx.fillText(t, cx, y); y += 13 * u; }
    y += 5.5 * u;
  };
  line('LEFT THUMB — footwork', [
    'drag ↔ run · flick ↑ jump · pull ↓ and HOLD to block',
  ]);
  line('RIGHT THUMB — three buttons', [
    'QUICK · a wrist-snap slash from the guard. Fast, short arc. 7 dmg.',
    'HEAVY · hands slide to the staff’s end (the tell!), then a full',
    'overhead arc. 20 dmg, long reach — but the finish pose is HELD',
    'for a beat. Whiff it and you WILL be punished.',
    'FLIP · invert your gravity. NO cooldown — chain flips to hover,',
    'juke a heavy, or bail out over the fire.',
  ]);
  line('BLOCK', [
    'A vertical staff wall — stops hits from the FRONT only.',
    'Every block slides you back; a blocked HEAVY shoves you far.',
    'Backs are open: flip over a turtle and strike from behind.',
  ], INK);
  line('IN THE AIR', [
    'Airborne fighters take ~1.65x knockback — batter a floating',
    'opponent across the box, or straight into the crack.',
  ]);
  ctx.font = `700 ${12.5 * u}px ${FONT}`;
  ctx.fillStyle = INK;
  ctx.fillText('KO or the fire wins the round — first to 3 rounds wins.', cx, y);

  // closing note
  const pulse = 0.55 + 0.45 * Math.sin(shell.t * 0.07);
  ctx.font = `700 ${15 * u}px ${FONT}`;
  ctx.fillStyle = `rgba(200,57,31,${0.55 + pulse * 0.45})`;
  ctx.fillText(AI_ON ? 'Take the bottom edge — tap to fight.' : 'Now lay the phone flat between you —', cx, sy + sh - 34 * u);
  if (!AI_ON) ctx.fillText('tap to fight.', cx, sy + sh - 16 * u);
}

// ---------- main render ----------
function render() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (shell.screen === 'title') { drawTitle(); return; }

  // screen nudge/shake
  shell.nudgeX *= 0.8; shell.nudgeY *= 0.8;
  if (shell.shake > 0) shell.shake--;
  const shx = shell.nudgeX + (Math.random() - 0.5) * shell.shake;
  const shy = shell.nudgeY + (Math.random() - 0.5) * shell.shake;
  ctx.translate(shx, shy);

  if (bg) ctx.drawImage(bg, 0, 0, W, H);

  // clip world drawing to the paper panel
  ctx.save();
  ctx.beginPath(); ctx.rect(ar.x, ar.y, ar.w, ar.h); ctx.clip();
  drawPitGlow();
  pitAmbient();
  drawTrails();
  drawFighter(game.fighters[0], 0);
  drawFighter(game.fighters[1], 1);
  drawParticles();
  if (shell.flash > 0) {
    shell.flash--;
    ctx.fillStyle = `rgba(255,252,240,${shell.flash / 10})`;
    ctx.fillRect(ar.x, ar.y, ar.w, ar.h);
  }
  ctx.restore();

  drawHUD();
  drawZones();
  drawBanners();
}

// ---------- loop ----------
let acc = 0, lastT = 0;
const STEP_MS = 1000 / 60;
function frame(tms) {
  requestAnimationFrame(frame);
  if (!lastT) lastT = tms;
  let dt = tms - lastT;
  lastT = tms;
  if (dt > 200) dt = 200;
  shell.t++;
  if (shell.screen === 'game') {
    acc += dt;
    let n = 0;
    while (acc >= STEP_MS && n < 4) { stepSim(); acc -= STEP_MS; n++; }
    if (acc >= STEP_MS) acc = 0;
  }
  render();
}

// ---------- boot ----------
resize();
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));
bindInput();
requestAnimationFrame(frame);

// ---------- test hooks ----------
window.__g = {
  SIM,
  AI_ON,
  get game() { return game; },
  get shell() { return shell; },
  get layout() { return { W, H, zoneH, uiM, ar: Object.assign({}, ar), buttons: buttonsLocal() }; },
  start() { startGame(); },
  rematch() { rematch(); },
  step(n) { for (let i = 0; i < (n || 1); i++) stepSim(); },
  render() { render(); },
  pollInput,
  touchDown: pDown, touchMove: pMove, touchUp: pUp,
  resize,
};
})();
