// FLIPSTAFF render/shell smoke test. Run: node test/render.test.js
// Boots game.js against a stub DOM and drives it across every screen —
// title, intro, fight, roundend, over, rematch — plus the ?ai=1 solo mode,
// exercising the real touch input pathway. Rendering runs against a
// self-returning canvas proxy: any crash fails the test.
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');

let failed = 0;
function ok(cond, msg) {
  console.log((cond ? 'ok   - ' : 'FAIL - ') + msg);
  if (!cond) failed = 1;
}

// universal self-returning proxy: absorbs every canvas 2D call
function anyProxy() {
  const fn = function () { return p; };
  const p = new Proxy(fn, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === Symbol.iterator) return function* () {};
      return p;
    },
    set() { return true; },
    apply() { return p; },
    construct() { return p; },
  });
  return p;
}

function boot(search, w, h) {
  const noop = () => {};
  const ctx = anyProxy();
  const mkCanvas = () => ({ style: {}, width: 0, height: 0, getContext: () => ctx, addEventListener: noop });
  const canvas = mkCanvas();
  globalThis.window = {
    innerWidth: w || 390, innerHeight: h || 780, devicePixelRatio: 2,
    addEventListener: noop,
    SIM: require('../sim.js'),
  };
  globalThis.document = { getElementById: () => canvas, createElement: mkCanvas, addEventListener: noop };
  globalThis.requestAnimationFrame = noop;
  globalThis.location = { search };
  delete globalThis.window.__g;
  new Function(src)();
  return globalThis.window.__g;
}

// ---------------- plain two-player boot ----------------
{
  const g = boot('');
  ok(!!g, 'game boots against stub DOM');
  ok(g.AI_ON === false, 'no ?ai=1: AI off');
  ok(g.shell.screen === 'title', 'boots to the explainer screen');
  g.render(); // title render

  const { W, H, zoneH } = { W: g.layout.W, H: g.layout.H, zoneH: g.layout.zoneH };
  // tap anywhere on the title starts the match
  g.touchDown(1, W / 2, H / 2); g.touchUp(1);
  ok(g.shell.screen === 'game' && g.game.screen === 'intro', 'title tap starts the match (round intro)');
  for (let i = 0; i < 10; i++) { g.step(); g.render(); }

  // run out the intro
  const C = g.SIM.C;
  g.step(C.INTRO_F);
  ok(g.game.screen === 'fight', 'intro flows into the fight');

  // no AI param: fighter 1 never acts on its own
  const x1 = g.game.fighters[1].x;
  g.step(240);
  ok(g.game.fighters[1].x === x1, 'without ?ai=1 the far fighter only moves when its human does — identical 2P behavior');

  // real touch pathway: bottom player's QUICK button fires a quick slash
  const bq = { x: W * 0.635, y: H - zoneH * 0.36 };
  g.touchDown(2, bq.x, bq.y); g.touchUp(2);
  g.step();
  ok(g.game.fighters[0].move === 'quick', 'bottom-edge QUICK button starts a quick slash via the touch pathway');
  g.step(30);

  // top player's controls are rotated 180: their QUICK button is at (W-x, H-y)
  g.touchDown(3, W - bq.x, H - bq.y); g.touchUp(3);
  g.step();
  ok(g.game.fighters[1].move === 'quick', 'top-edge QUICK button (rotated frame) works');
  g.step(30);

  // top player drag toward THEIR right maps to world -x
  const pad1 = { x: W - W * 0.25, y: zoneH * 0.5 };
  g.touchDown(4, pad1.x, pad1.y);
  g.touchMove(4, pad1.x - 60, pad1.y); // their local +x drag
  const inp1 = g.pollInput(1);
  ok(inp1.mx < -0.5, 'top player local-right drag maps to world -x (mirrored frame)');
  g.touchUp(4);

  // bottom player block gesture: pull down and hold
  const pad0 = { x: W * 0.25, y: H - zoneH * 0.5 };
  g.touchDown(5, pad0.x, pad0.y);
  g.touchMove(5, pad0.x, pad0.y + 40);
  g.step(C.BLOCK_STARTUP + 3);
  ok(g.game.fighters[0].blockF >= C.BLOCK_STARTUP, 'down-drag-and-hold raises the block');
  g.touchUp(5);
  g.step(2);
  ok(g.game.fighters[0].blockF === 0, 'lifting the finger drops the block');

  // force three KOs to sweep roundend -> intro -> over screens, rendering all
  for (let round = 0; round < 3; round++) {
    while (g.game.screen === 'intro') { g.step(); }
    const [f0, f1] = g.game.fighters;
    f0.x = 6; f0.y = C.FH / 2; f0.g = 1; f0.facing = 1; f0.move = null; f0.hitstop = 0;
    f1.x = 7.4; f1.y = C.FH / 2; f1.g = 1; f1.hp = 1; f1.move = null; f1.blockF = 0; f1.hitstop = 0;
    g.touchDown(9, bq.x, bq.y); g.touchUp(9);
    for (let i = 0; i < 40 && g.game.screen === 'fight'; i++) { g.step(); g.render(); }
    ok(g.game.screen === 'roundend', `round ${round + 1}: KO reaches roundend screen`);
    for (let i = 0; i < C.ROUNDEND_F + 2; i++) { g.step(); g.render(); }
  }
  ok(g.game.screen === 'over' && g.game.winner === 0, 'match over screen reached (CRIMSON 3-0)');
  g.render();

  // rematch tap (after the accidental-tap guard)
  g.step(45);
  g.touchDown(10, W / 2, H / 2); g.touchUp(10);
  ok(g.game.screen === 'intro' && g.game.wins[0] === 0, 'tap after match over starts a rematch');
  g.render();
}

// ---------------- ?ai=1 solo mode ----------------
{
  const g = boot('?ai=1');
  ok(g.AI_ON === true, '?ai=1 enables solo mode');
  g.render();
  const { W, H } = g.layout;
  g.touchDown(1, W / 2, H / 2); g.touchUp(1);
  g.step(g.SIM.C.INTRO_F + 2);
  ok(g.game.screen === 'fight', 'ai mode: fight starts');
  const x1 = g.game.fighters[1].x;
  let moved = false, hpDropped = false;
  for (let i = 0; i < 60 * 30 && !(moved && g.game.screen !== 'fight'); i++) {
    g.step();
    if (i % 20 === 0) g.render();
    if (g.game.fighters[1].x !== x1 || g.game.fighters[1].g !== -1) moved = true;
    if (g.game.fighters[0].hp < 100) hpDropped = true;
    if (g.game.screen === 'over') break;
  }
  ok(moved, 'ai mode: AI drives the far fighter through the input pathway');
  ok(hpDropped, 'ai mode: AI lands hits on an idle player');
  ok(Number.isFinite(g.game.fighters[1].x), 'ai mode: sim stays healthy');

  // top-edge touches are inert in AI mode
  const zoneH = g.layout.zoneH;
  g.touchDown(2, W - W * 0.635, zoneH * 0.36); g.touchUp(2);
  const inpBlocked = g.pollInput(1); // pDown ignores the AI's edge, so no edge is queued
  ok(inpBlocked.quick === false, 'ai mode: top-edge button taps never reach the sim');
}

// ---------------- odd screen sizes render without crashing ----------------
{
  for (const [w, h] of [[320, 568], [430, 932], [768, 1024], [1280, 720]]) {
    const g = boot('', w, h);
    g.render();
    const { W, H } = g.layout;
    g.touchDown(1, W / 2, H / 2); g.touchUp(1);
    for (let i = 0; i < 140; i++) { g.step(); if (i % 10 === 0) g.render(); }
    g.resize();
    g.render();
  }
  ok(true, 'render smoke across 320x568 / 430x932 / 768x1024 / 1280x720');
}

process.exit(failed);
