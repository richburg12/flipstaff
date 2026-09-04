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
  f0.x = 15; // the clear column right of both shelves and both cracks
  const fl = I(); fl.flip = true;
  run(g, 1, () => fl, null);
  ok(f0.g === -1, 'flip inverts gravity for that fighter only');
  ok(f1.g === -1 && f1.grounded, 'opponent gravity untouched');
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
  // NO cooldown: consecutive-tick flips are all honored
  const g = fightReady();
  const f0 = g.fighters[0];
  f0.x = 4;
  const fl = I(); fl.flip = true;
  run(g, 1, () => fl, null);
  ok(f0.g === -1, 'first flip taken');
  run(g, 1, () => fl, null);
  ok(f0.g === 1, 'flip on the very next tick also taken — no cooldown');
  run(g, 1, () => fl, null);
  ok(f0.g === -1, 'third consecutive flip too');
}
{
  // flip-spam stability: alternate every tick for 10s — hovering is allowed,
  // and the sim must stay sane (no NaNs, no tunneling out of the box)
  const g = fightReady();
  const f0 = g.fighters[0];
  f0.x = 4;
  const fl = I(); fl.flip = true;
  let sane = true, minY = 99, maxY = -99;
  for (let k = 0; k < 600; k++) {
    SIM.step(g, [fl, I()]);
    if (!Number.isFinite(f0.x) || !Number.isFinite(f0.y) || !Number.isFinite(f0.vy)) sane = false;
    minY = Math.min(minY, f0.y); maxY = Math.max(maxY, f0.y);
  }
  ok(sane, 'flip spam every tick for 600 ticks: no NaNs');
  ok(minY >= C.FH / 2 - 1e-6 && maxY <= C.AH - C.FH / 2 + 1e-6,
    `flip spam never tunnels through a surface (y ${minY.toFixed(2)}..${maxY.toFixed(2)})`);
  ok(maxY - minY < 4, `every-tick flips oscillate in place — the hover tech (span ${(maxY - minY).toFixed(2)}u)`);
}
{
  // hovering over the fire on chained flips is legal — and survives
  const g = fightReady();
  const f0 = g.fighters[0];
  f0.x = 12.5; f0.y = 6; f0.vy = 0; f0.grounded = false; // dropped over the crack
  const fl = I(); fl.flip = true;
  for (let k = 0; k < 300; k++) SIM.step(g, [fl, I()]);
  ok(g.fighters[0].state !== 'ko' && g.screen === 'fight',
    'chained flips hover a fighter safely above the pit');
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
  // the platforms are double-sided: a flipping fighter aligned with one is
  // caught by its underside
  const g = fightReady();
  const f0 = g.fighters[0];
  f0.x = 8; // under the wide low step
  const fl = I(); fl.flip = true;
  run(g, 1, () => fl, null);
  let frames = 0;
  while (!f0.grounded && frames < 300) { SIM.step(g, [I(), I()]); frames++; }
  approx(f0.y, C.PLATS[0].y0 - C.FH / 2, 1e-6, 'caught by the low shelf\'s underside mid-flip');
  ok(f0.g === -1 && f0.grounded, 'standing (inverted) on the platform');
}
{
  // BOTH platforms collide on BOTH faces
  const clearX = [3.0, 12.0]; // columns where ONLY that platform is in the way
  for (let pi = 0; pi < C.PLATS.length; pi++) {
    const p = C.PLATS[pi];
    const cx = clearX[pi];
    // top face: gravity-down fighter dropped above rests on top
    let g = fightReady();
    let f = g.fighters[0];
    f.x = cx; f.y = p.y1 + 3; f.vy = 0; f.g = 1; f.grounded = false;
    for (let k = 0; k < 120 && !f.grounded; k++) SIM.step(g, [I(), I()]);
    approx(f.y, p.y1 + C.FH / 2, 1e-6, `platform ${pi}: grav-down fighter rests on the top face`);
    // bottom face: gravity-up fighter released below rests on the underside
    g = fightReady();
    f = g.fighters[0];
    f.x = cx; f.y = Math.max(C.FH / 2, p.y0 - 3); f.vy = 0; f.g = -1; f.grounded = false;
    for (let k = 0; k < 120 && !f.grounded; k++) SIM.step(g, [I(), I()]);
    approx(f.y, p.y0 - C.FH / 2, 1e-6, `platform ${pi}: grav-up fighter rests on the underside`);
  }
  // staggered overlap preserved: descending from the high shelf's top lands
  // on the low shelf's top in the overlap band, and the two shelves overlap
  ok(C.PLATS[1].y0 - C.PLATS[0].y1 > C.FH + 1, 'clear air between the shelves to fight in');
  ok(C.PLATS[0].x1 > C.PLATS[1].x0, 'the two shelves overlap mid-field');
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

// ---------------- the fire pit ----------------
{
  // walking in = instant loss of the round
  const g = fightReady();
  const f0 = g.fighters[0];
  f0.x = 10.6; f0.y = C.FH / 2; f0.g = 1; f0.grounded = true;
  const mv = I(); mv.mx = 1;
  let evs = [];
  for (let k = 0; k < 300 && g.screen === 'fight'; k++) evs = evs.concat(SIM.step(g, [mv, I()]));
  ok(evs.some(e => e.type === 'pitdeath' && e.victim === 0), 'walking into the crack: pitdeath fires');
  ok(g.screen === 'roundend' && g.roundWinner === 1 && g.wins[1] === 1, 'round awarded to the survivor');
  ok(g.roundEndCause === 'pit', 'round end cause recorded as pit');
  ok(f0.state === 'ko' && f0.pitDead, 'victim marked pit-dead');
  run(g, C.ROUNDEND_F + 2);
  ok(g.screen === 'intro' && g.roundNum === 1, 'next round follows a pit death normally');
}
{
  // the ceiling crack: a gravity-up fighter walking over it falls UP in and dies
  const g = fightReady();
  const f1 = g.fighters[1]; // ceiling fighter, g = -1
  f1.x = 5.4; // just right of the ceiling crack (2.5-4.5)
  const mv = I(); mv.mx = -1;
  let evs = [];
  for (let k = 0; k < 300 && g.screen === 'fight'; k++) evs = evs.concat(SIM.step(g, [I(), mv]));
  ok(evs.some(e => e.type === 'pitdeath' && e.victim === 1 && e.ceiling === true),
    'walking across the ceiling crack: pitdeath fires (ceiling-flagged)');
  ok(g.screen === 'roundend' && g.roundWinner === 0 && g.roundEndCause === 'pit',
    'ceiling pit death awards the round to the floor fighter');
}
{
  // and the mirror span of each crack on the OTHER surface is safe ground
  const g = fightReady();
  const [f0, f1] = g.fighters;
  f0.x = 3.5; // floor fighter standing under the ceiling crack
  f1.x = 12.5; // ceiling fighter standing over the floor crack
  run(g, 120);
  ok(f0.grounded && f1.grounded && g.screen === 'fight',
    'each crack burns only its own surface — the far surface there is solid');
}
{
  // knocked in: a heavy on a grounded victim near the edge carries them in
  const g = fightReady();
  const [f0, f1] = g.fighters;
  f0.x = 7.8; f0.g = 1; f0.y = C.FH / 2; f0.facing = 1; f0.grounded = true;
  f1.x = 10.0; f1.g = 1; f1.y = C.FH / 2; f1.facing = -1; f1.grounded = true;
  const h = I(); h.heavy = true;
  let first = true, evs = [];
  for (let k = 0; k < 240 && g.screen === 'fight'; k++) {
    evs = evs.concat(SIM.step(g, [first ? h : I(), I()]));
    first = false;
  }
  ok(evs.some(e => e.type === 'hit'), 'the edge heavy connects');
  ok(evs.some(e => e.type === 'pitdeath' && e.victim === 1), 'knockback carries the victim into the fire');
  ok(g.roundEndCause === 'pit' && g.roundWinner === 0, 'knockback pit kill credits the attacker');
}
{
  // MIRROR: same knockback shove on the ceiling, into the ceiling crack.
  // Exact point-reflection of the test above — symmetry verified, not assumed.
  const g = fightReady();
  const [f0, f1] = g.fighters;
  f0.x = 16 - 7.8; f0.g = -1; f0.y = C.AH - C.FH / 2; f0.facing = -1; f0.grounded = true;
  f1.x = 16 - 10.0; f1.g = -1; f1.y = C.AH - C.FH / 2; f1.facing = 1; f1.grounded = true;
  const h = I(); h.heavy = true;
  let first = true, evs = [];
  for (let k = 0; k < 240 && g.screen === 'fight'; k++) {
    evs = evs.concat(SIM.step(g, [first ? h : I(), I()]));
    first = false;
  }
  ok(evs.some(e => e.type === 'hit'), 'mirrored edge heavy connects on the ceiling');
  ok(evs.some(e => e.type === 'pitdeath' && e.victim === 1 && e.ceiling === true),
    'mirrored knockback carries the victim up into the ceiling fire');
  ok(g.roundEndCause === 'pit' && g.roundWinner === 0, 'mirrored pit kill credits the attacker');
}

// ---------------- airborne knockback ----------------
{
  // raw multiplier: identical heavy, grounded vs airborne victim
  const hitVx = (airborne) => {
    const g = fightReady();
    const [f0, f1] = g.fighters;
    f0.x = 4.0; f0.facing = 1; f0.g = 1; f0.y = C.FH / 2; f0.grounded = true;
    f1.g = 1;
    let vx = null;
    const h = I(); h.heavy = true;
    let first = true;
    for (let k = 0; k < 60 && vx === null; k++) {
      f1.x = 6.2; f1.facing = -1;
      if (airborne) { f1.y = C.FH / 2 + 1.2; f1.vy = 0; f1.grounded = false; }
      else { f1.y = C.FH / 2; f1.vy = 0; f1.grounded = true; }
      SIM.step(g, [first ? h : I(), I()]);
      first = false;
      if (g.events.some(e => e.type === 'hit')) vx = g.fighters[1].vx;
    }
    return vx;
  };
  const vg = hitVx(false), va = hitVx(true);
  approx(vg, C.KB_HEAVY.vx, 1e-9, 'grounded victim: knockback velocity unchanged');
  approx(va, C.KB_HEAVY.vx * C.KB_AIR, 1e-9, `airborne victim: ${C.KB_AIR}x horizontal knockback`);
  ok(C.KB_HEAVY.vx * C.KB_AIR > C.KB_QUICK.vx * C.KB_AIR, 'heavy still out-launches quick in the air');
}
{
  // tuned danger zones: a midair heavy is deadly NEAR the pit, but from
  // mid-arena (x=8) the victim lands just short — dangerous, not guaranteed
  const launch = (vx0) => {
    const g = fightReady();
    const [f0, f1] = g.fighters;
    f0.x = vx0 - 2.2; f0.facing = 1; f0.g = 1; f0.y = C.FH / 2; f0.grounded = true;
    f1.g = 1;
    let hit = false, died = false;
    const h = I(); h.heavy = true;
    let first = true;
    for (let k = 0; k < 240 && g.screen === 'fight'; k++) {
      if (!hit) { f1.x = vx0; f1.y = C.FH / 2 + 1.2; f1.vx = 0; f1.vy = 0; f1.grounded = false; f1.facing = -1; }
      SIM.step(g, [first ? h : I(), I()]);
      first = false;
      if (g.events.some(e => e.type === 'hit')) hit = true;
      if (g.events.some(e => e.type === 'pitdeath' && e.victim === 1)) died = true;
    }
    return { hit, died };
  };
  const mid = launch(8.0), near = launch(9.5);
  ok(mid.hit && !mid.died, 'midair heavy from mid-arena (x=8.0): lands short of the fire');
  ok(near.hit && near.died, 'midair heavy near the pit (x=9.5): straight in');

  // MIRROR of the danger map on the ceiling (point-reflected coordinates):
  // don't assume the symmetry holds — measure it
  const launchUp = (vx0) => {
    const g = fightReady();
    const [f0, f1] = g.fighters;
    f0.x = vx0 + 2.2; f0.facing = -1; f0.g = -1; f0.y = C.AH - C.FH / 2; f0.grounded = true;
    f1.g = -1;
    let hit = false, died = false;
    const h = I(); h.heavy = true;
    let first = true;
    for (let k = 0; k < 240 && g.screen === 'fight'; k++) {
      if (!hit) { f1.x = vx0; f1.y = C.AH - C.FH / 2 - 1.2; f1.vx = 0; f1.vy = 0; f1.grounded = false; f1.facing = 1; }
      SIM.step(g, [first ? h : I(), I()]);
      first = false;
      if (g.events.some(e => e.type === 'hit')) hit = true;
      if (g.events.some(e => e.type === 'pitdeath' && e.victim === 1)) died = true;
    }
    return { hit, died };
  };
  const midUp = launchUp(16 - 8.0), nearUp = launchUp(16 - 9.5);
  ok(midUp.hit && !midUp.died, 'ceiling mirror: midair heavy from mid-arena lands short of the ceiling fire');
  ok(nearUp.hit && nearUp.died, 'ceiling mirror: midair heavy near the ceiling crack sends them up into it');
}

// ---------------- the fairness law: exact 180° rotational symmetry ----------------
{
  // Rotate the arena definition half a turn about (AW/2, AH/2): platforms,
  // pits, and spawns must map exactly onto themselves. Future arena edits
  // that break fairness fail here.
  const rx = (x) => C.AW - x, ry = (y) => C.AH - y;
  const eq = (a, b) => Math.abs(a - b) < 1e-9;
  for (const p of C.PLATS) {
    const found = C.PLATS.some(q =>
      eq(q.x0, rx(p.x1)) && eq(q.x1, rx(p.x0)) && eq(q.y0, ry(p.y1)) && eq(q.y1, ry(p.y0)));
    ok(found, `platform (${p.x0}..${p.x1} @ ${p.y0}..${p.y1}) has its exact point-reflection`);
  }
  for (const p of C.PITS) {
    const found = C.PITS.some(q =>
      q.ceiling === !p.ceiling && eq(q.x0, rx(p.x1)) && eq(q.x1, rx(p.x0)));
    ok(found, `pit (${p.x0}..${p.x1}, ${p.ceiling ? 'ceiling' : 'floor'}) reflects onto the opposite surface`);
  }
  ok(C.PITS.length === 2 && C.PITS.filter(p => p.ceiling).length === 1, 'exactly one crack per surface');
  for (const round of [0, 1]) {
    const g = SIM.createGame();
    SIM.spawn(g.fighters[0], round);
    SIM.spawn(g.fighters[1], round);
    const [a, b] = g.fighters;
    ok(eq(b.x, rx(a.x)) && eq(b.y, ry(a.y)) && b.g === -a.g && b.facing === -a.facing,
      `round ${round + 1} spawns are exact point-reflections (position, gravity, facing)`);
    for (const p of C.PITS) {
      const mid = (p.x0 + p.x1) / 2, half = (p.x1 - p.x0) / 2;
      ok(Math.abs(a.x - mid) > half + 0.9 && Math.abs(b.x - mid) > half + 0.9,
        `round ${round + 1} spawns clear the ${p.ceiling ? 'ceiling' : 'floor'} crack comfortably`);
    }
  }
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
      if (f.x < -1 || f.x > C.AW + 1 || f.y < -C.SINK - 0.1 || f.y > C.AH + C.SINK + 0.1) sane = false;
      if (!Number.isFinite(f.hp) || f.hp < 0 || f.hp > C.HP) sane = false;
    }
    if (!sane) { console.log('  broke at tick ' + k); break; }
  }
  ok(sane, '20k random-input ticks: no NaNs, nobody leaves the closed box, hp stays 0..100');
}

process.exit(failed);
