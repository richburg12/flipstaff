// FLIPSTAFF headless sim tests. Run: node test/sim.test.js
// Pure logic — no DOM needed at all; sim.js has no browser dependencies.
'use strict';
const SIM = require('../sim.js');
const C = SIM.C;

let failed = 0;
function ok(cond, msg) {
  console.log((cond ? 'ok   - ' : 'FAIL - ') + msg);
  if (!cond) failed = 1;
}
function approx(a, b, eps, msg) {
  ok(Math.abs(a - b) <= eps, msg + ` (got ${a}, want ${b}±${eps})`);
}

const I = () => SIM.emptyInput();

// Fast-forward through the round intro so fights can start immediately.
function fightReady() {
  const g = SIM.createGame();
  while (g.screen === 'intro') SIM.step(g, [I(), I()]);
  return g;
}
// Place both fighters on the floor, adjacent, f0 left of f1.
function faceOff(g, dist) {
  const [f0, f1] = g.fighters;
  f0.x = 6; f0.y = C.FH / 2; f0.g = 1; f0.vx = f0.vy = 0; f0.facing = 1; f0.grounded = true;
  f1.x = 6 + dist; f1.y = C.FH / 2; f1.g = 1; f1.vx = f1.vy = 0; f1.facing = -1; f1.grounded = true;
}
function run(g, n, i0, i1) {
  let evs = [];
  for (let k = 0; k < n; k++) evs = evs.concat(SIM.step(g, [i0 ? i0(k) : I(), i1 ? i1(k) : I()]));
  return evs;
}

// ---------------- damage values ----------------
{
  const g = fightReady();
  faceOff(g, 1.6);
  const q = I(); q.quick = true;
  run(g, 1, () => q, null);
  run(g, 30);
  ok(g.fighters[1].hp === 100 - C.QUICK.dmg, `quick slash deals exactly ${C.QUICK.dmg} (hp=${g.fighters[1].hp})`);
  ok(g.fighters[0].hp === 100, 'attacker untouched');
}
{
  const g = fightReady();
  faceOff(g, 2.6);
  const h = I(); h.heavy = true;
  run(g, 1, () => h, null);
  run(g, 60);
  ok(g.fighters[1].hp === 100 - C.HEAVY.dmg, `heavy strike deals exactly ${C.HEAVY.dmg} (hp=${g.fighters[1].hp})`);
}
{
  // one move instance hits at most once
  const g = fightReady();
  faceOff(g, 1.2);
  const q = I(); q.quick = true;
  run(g, 1, () => q, null);
  run(g, 6); // through all active frames
  ok(g.fighters[1].hp === 100 - C.QUICK.dmg, 'multi-frame active window still hits only once');
}
{
  // quick is short range: far apart it whiffs
  const g = fightReady();
  faceOff(g, 3.2);
  const q = I(); q.quick = true;
  run(g, 1, () => q, null);
  run(g, 30);
  ok(g.fighters[1].hp === 100, 'quick whiffs outside its short frontal arc');
}

// ---------------- block: negation, pushback, behind-hits ----------------
{
  const g = fightReady();
  faceOff(g, 1.6);
  const blockIn = I(); blockIn.block = true;
  run(g, 10, null, () => blockIn); // f1 settles into block (past startup)
  ok(g.fighters[1].blockF >= C.BLOCK_STARTUP, 'block is up after startup frames');
  const x1 = g.fighters[1].x;
  const q = I(); q.quick = true;
  let first = true;
  const evs = run(g, 40, () => { const i = first ? q : I(); first = false; return i; }, () => blockIn);
  ok(g.fighters[1].hp === 100, 'blocked quick deals zero damage');
  ok(evs.some(e => e.type === 'block'), 'block event emitted');
  const slideQ = g.fighters[1].x - x1;
  ok(slideQ > 0.05, `blocked quick slides the blocker back (slide=${slideQ.toFixed(2)})`);

  // now a blocked heavy — must shove much farther
  faceOff(g, 2.4);
  run(g, 10, null, () => blockIn);
  const x2 = g.fighters[1].x;
  const h = I(); h.heavy = true;
  let f2 = true;
  run(g, 80, () => { const i = f2 ? h : I(); f2 = false; return i; }, () => blockIn);
  ok(g.fighters[1].hp === 100, 'blocked heavy deals zero damage');
  const slideH = g.fighters[1].x - x2;
  ok(slideH > slideQ * 3, `blocked HEAVY shoves far back — turtling loses ground (heavy ${slideH.toFixed(2)} vs quick ${slideQ.toFixed(2)})`);
}
{
  // block cannot be frame-perfect: hit landing during block startup still connects
  const g = fightReady();
  faceOff(g, 1.6);
  const q = I(); q.quick = true;
  const b = I(); b.block = true;
  // f0 attacks immediately; f1 starts blocking 2 frames before the hit lands
  run(g, 4, k => (k === 0 ? q : I()), null);
  run(g, 30, null, () => b);
  ok(g.fighters[1].hp === 100 - C.QUICK.dmg, 'block startup window: late block still gets hit');
}
{
  // attacks from behind ignore block (blocking locks facing)
  const g = fightReady();
  faceOff(g, 1.6);
  const b = I(); b.block = true;
  run(g, 8, null, () => b);
  // f0 slips behind the locked-facing blocker
  g.fighters[0].x = g.fighters[1].x + 1.4;
  g.fighters[0].facing = -1;
  ok(g.fighters[1].facing === -1, 'blocking locks facing (turtle cannot auto-track)');
  const q = I(); q.quick = true;
  let first = true;
  run(g, 30, () => { const i = first ? q : I(); first = false; return i; }, () => b);
  ok(g.fighters[1].hp === 100 - C.QUICK.dmg, 'hit from behind ignores block');
}
{
  // cannot attack while blocking
  const g = fightReady();
  faceOff(g, 1.6);
  const bq = I(); bq.block = true; bq.quick = true; bq.heavy = true;
  run(g, 20, null, () => bq);
  ok(g.fighters[1].move === null && g.fighters[1].state === 'block', 'attack inputs ignored while block is held');
}

// ---------------- heavy pose-hold timing ----------------
{
  const g = fightReady();
  faceOff(g, 8); // out of range: pure whiff, watch the timeline
  const h = I(); h.heavy = true;
  run(g, 1, () => h, null);
  const f0 = g.fighters[0];
  ok(f0.move === 'heavy', 'heavy starts');
  const activeEnd = C.HEAVY.startup + C.HEAVY.active;
  run(g, activeEnd + 1); // mf just past activeEnd -> into hold
  ok(f0.move === 'heavy' && f0.mf > activeEnd, 'past active frames');
  // through the whole 350ms-ish hold the fighter stays committed
  ok(C.HEAVY.hold === 21, `pose hold is ${C.HEAVY.hold} frames (~350ms at 60Hz)`);
  run(g, C.HEAVY.hold - 2);
  ok(f0.move === 'heavy', 'still locked in held finish pose near its end');
  run(g, C.HEAVY.rec + 4);
  ok(f0.move === null, 'move ends after hold + recover');
  const total = C.HEAVY.startup + C.HEAVY.active + C.HEAVY.hold + C.HEAVY.rec;
  ok(SIM.HEAVY_TOTAL === total, `heavy total commitment = ${total} frames`);
}
{
  // the punish loop: hitting someone in pose-hold works (they can't block)
  const g = fightReady();
  faceOff(g, 2.6);
  const h = I(); h.heavy = true;
  run(g, 1, null, () => h); // f1 heavies... f0 walks out of range so it whiffs
  g.fighters[0].x = 2; // dodge the lunge
  run(g, C.HEAVY.startup + C.HEAVY.active + 2);
  ok(g.fighters[1].move === 'heavy' && g.fighters[1].mf > C.HEAVY.startup + C.HEAVY.active, 'f1 in held pose');
  // walk back in and quick them
  g.fighters[0].x = g.fighters[1].x - 1.6; g.fighters[0].facing = 1;
  const q = I(); q.quick = true;
  let first = true;
  run(g, 20, () => { const i = first ? q : I(); first = false; return i; });
  ok(g.fighters[1].hp === 100 - C.QUICK.dmg, 'pose-hold is punishable — the core loop');
}

// ---------------- gravity flip physics ----------------
{
  const g = fightReady();
  const f1 = g.fighters[1]; // starts on the ceiling, g=-1
  const f0 = g.fighters[0];
  ok(f0.g === 1 && Math.abs(f0.y - C.FH / 2) < 1e-6, 'f0 spawns standing on the floor');
  ok(f1.g === -1 && Math.abs(f1.y - (C.AH - C.FH / 2)) < 1e-6, 'f1 spawns standing on the ceiling (their own floor)');

  // flip f0: must arc across and land feet-first on the ceiling
  f0.x = 3; // off-platform column so it crosses the whole box
  const fl = I(); fl.flip = true;
  run(g, 1, () => fl, null);
  ok(f0.g === -1, 'flip inverts gravity for that fighter only');
  ok(f1.g === -1 && f1.grounded, 'opponent gravity untouched');
  ok(f0.flipCd === C.FLIP_CD, 'flip cooldown armed');
  let frames = 0;
  while (!f0.grounded && frames < 300) { SIM.step(g, [I(), I()]); frames++; }
  approx(f0.y, C.AH - C.FH / 2, 1e-6, 'lands resting on the ceiling');
  ok(frames > 10 && frames < 90, `crossing takes a readable arc (${frames} frames)`);
}
{
  // momentum carries through the flip (Geometry Dash feel)
  const g = fightReady();
  const f0 = g.fighters[0];
  f0.x = 2; f0.vx = 0.13; f0.facing = 1;
  const fl = I(); fl.flip = true;
  run(g, 1, () => fl, null);
  const vxAfter = f0.vx;
  approx(vxAfter, 0.13, 1e-9, 'horizontal momentum preserved at the instant of flip');
  const x0 = f0.x;
  run(g, 10);
  ok(f0.x > x0 + 1.0, 'carries forward smoothly through the arc');
}
{
  // cooldown enforced: second flip inside 1s is ignored
  const g = fightReady();
  const f0 = g.fighters[0];
  f0.x = 3;
  const fl = I(); fl.flip = true;
  run(g, 1, () => fl, null);
  ok(f0.g === -1, 'first flip taken');
  run(g, 10, () => fl, null); // spam
  ok(f0.g === -1, 'flip spam inside cooldown ignored (no hovering)');
  run(g, C.FLIP_CD, null, null); // wait out the cooldown
  run(g, 1, () => fl, null);
  ok(f0.g === 1, 'flip available again after ~1s cooldown');
}
{
  // mid-air flip is allowed
  const g = fightReady();
  const f0 = g.fighters[0];
  f0.x = 3;
  const j = I(); j.jump = true;
  run(g, 1, () => j, null);
  run(g, 6);
  ok(!f0.grounded, 'airborne after jump');
  const fl = I(); fl.flip = true;
  run(g, 1, () => fl, null);
  ok(f0.g === -1, 'flip usable mid-air');
}
{
  // the platform is double-sided: a flipping fighter aligned with it lands on its underside
  const g = fightReady();
  const f0 = g.fighters[0];
  f0.x = 8; // dead centre, under the platform
  const fl = I(); fl.flip = true;
  run(g, 1, () => fl, null);
  let frames = 0;
  while (!f0.grounded && frames < 300) { SIM.step(g, [I(), I()]); frames++; }
  approx(f0.y, C.PLAT.y0 - C.FH / 2, 1e-6, 'caught by the platform underside mid-flip');
  ok(f0.g === -1 && f0.grounded, 'standing (inverted) on the platform');
}

// ---------------- KO / round / match flow ----------------
{
  const g = fightReady();
  faceOff(g, 1.6);
  g.fighters[1].hp = 5;
  const q = I(); q.quick = true;
  let first = true;
  const evs = run(g, 20, () => { const i = first ? q : I(); first = false; return i; });
  ok(evs.some(e => e.type === 'ko'), 'KO event fires');
  ok(g.fighters[1].state === 'ko', 'victim crumples');
  ok(g.screen === 'roundend' && g.wins[0] === 1, 'round ends, winner credited');
  // flow into next round
  run(g, C.ROUNDEND_F + 2);
  ok(g.screen === 'intro' && g.roundNum === 1, 'next round intro starts');
  run(g, C.INTRO_F + 1);
  ok(g.screen === 'fight', 'round 2 fight begins');
  ok(g.fighters[1].hp === C.HP && g.fighters[0].hp === C.HP, 'health resets between rounds');
  ok(g.fighters[0].g === 1 && g.fighters[1].g === -1, 'each fighter respawns on their own surface');
}
{
  // first to 3 wins the match
  const g = fightReady();
  for (let round = 0; round < 3; round++) {
    while (g.screen === 'intro') SIM.step(g, [I(), I()]);
    faceOff(g, 1.6);
    g.fighters[1].hp = 1;
    const q = I(); q.quick = true;
    let first = true;
    run(g, 20, () => { const i = first ? q : I(); first = false; return i; });
    ok(g.screen === 'roundend', `round ${round + 1} KO lands`);
    run(g, C.ROUNDEND_F + 2);
  }
  ok(g.screen === 'over' && g.winner === 0 && g.wins[0] === 3, 'first to 3 rounds takes the match');
  SIM.resetMatch(g);
  ok(g.screen === 'intro' && g.wins[0] === 0 && g.wins[1] === 0, 'rematch resets cleanly');
}

// ---------------- hitstop / impact feel ----------------
{
  const g = fightReady();
  faceOff(g, 1.6);
  const q = I(); q.quick = true;
  let first = true;
  for (let k = 0; k < 40; k++) {
    SIM.step(g, [first ? q : I(), I()]);
    first = false;
    if (g.events.some(e => e.type === 'hit')) break;
  }
  ok(g.fighters[0].hitstop === C.HITSTOP_QUICK && g.fighters[1].hitstop === C.HITSTOP_QUICK,
    'both fighters freeze in hitstop on impact');
  const mfBefore = g.fighters[0].mf;
  SIM.step(g, [I(), I()]);
  ok(g.fighters[0].mf === mfBefore, 'attacker move frames frozen during hitstop');
}

// ---------------- long soak: no NaN, nobody escapes the box ----------------
{
  const g = fightReady();
  const rng = (s => () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)(42);
  const rin = () => {
    const i = I();
    i.mx = rng() * 2 - 1;
    i.jump = rng() < 0.06;
    i.block = rng() < 0.1;
    i.quick = rng() < 0.1;
    i.heavy = rng() < 0.05;
    i.flip = rng() < 0.04;
    return i;
  };
  let sane = true;
  for (let k = 0; k < 20000; k++) {
    SIM.step(g, [rin(), rin()]);
    if (g.screen === 'over') SIM.resetMatch(g);
    for (const f of g.fighters) {
      if (!Number.isFinite(f.x) || !Number.isFinite(f.y) || !Number.isFinite(f.vx) || !Number.isFinite(f.vy)) sane = false;
      if (f.x < -1 || f.x > C.AW + 1 || f.y < -1 || f.y > C.AH + 1) sane = false;
      if (!Number.isFinite(f.hp) || f.hp < 0 || f.hp > C.HP) sane = false;
    }
    if (!sane) { console.log('  broke at tick ' + k); break; }
  }
  ok(sane, '20k random-input ticks: no NaNs, nobody leaves the closed box, hp stays 0..100');
}

process.exit(failed);
