// FLIPSTAFF AI tests. Run: node test/ai.test.js
// The AI must drive fighter 1 through the exact same InputFrame pathway a
// human uses — no state pokes — and full AI-vs-AI matches must resolve.
'use strict';
const SIM = require('../sim.js');
const C = SIM.C;

let failed = 0;
function ok(cond, msg) {
  console.log((cond ? 'ok   - ' : 'FAIL - ') + msg);
  if (!cond) failed = 1;
}

// ---- the AI only emits legal InputFrame fields ----
{
  const g = SIM.createGame();
  const ai = SIM.createAI(7);
  const allowed = new Set(['mx', 'jump', 'block', 'quick', 'heavy', 'flip']);
  let clean = true, acted = false;
  for (let k = 0; k < 4000; k++) {
    const inp = SIM.aiInput(g, ai);
    for (const key of Object.keys(inp)) if (!allowed.has(key)) clean = false;
    if (typeof inp.mx !== 'number' || Math.abs(inp.mx) > 1) clean = false;
    if (inp.quick || inp.heavy || inp.flip || inp.jump || inp.block || inp.mx !== 0) acted = true;
    SIM.step(g, [SIM.emptyInput(), inp]);
    if (g.screen === 'over') break;
  }
  ok(clean, 'AI output is a plain InputFrame — same pathway as a thumb, no cheating');
  ok(acted, 'AI actually does things');
}

// ---- AI-vs-AI: full matches resolve without crashing, several seeds ----
{
  const seeds = [11, 222, 3333, 44444, 987654];
  let resolved = 0, sane = true;
  let totalRounds = 0, pitDeaths = 0, unforcedPitDeaths = 0;
  for (const seed of seeds) {
    const g = SIM.createGame();
    // fighter 0 needs a mirrored driver: reuse the AI by mirroring the world
    // is overkill — instead drive f0 with a second AI instance watching f1 by
    // temporarily swapping the fighters array view.
    const ai1 = SIM.createAI(seed);
    const ai0 = SIM.createAI(seed * 31 + 7);
    const swapped = { get fighters() { return [g.fighters[1], g.fighters[0]]; }, get screen() { return g.screen; }, get tick() { return g.tick; } };
    let ticks = 0;
    const CAP = 60 * 60 * 12; // 12 minutes of sim, way beyond a real match
    while (g.screen !== 'over' && ticks < CAP) {
      const i1 = SIM.aiInput(g, ai1);
      const i0raw = SIM.aiInput(swapped, ai0);
      const i0 = Object.assign(SIM.emptyInput(), i0raw);
      SIM.step(g, [i0, i1]);
      ticks++;
      for (const e of g.events) {
        if (e.type !== 'pitdeath') continue;
        pitDeaths++;
        // unforced = the victim had not been struck for ~3/4s before dying:
        // it walked or flipped in on its own
        if (g.tick - g.fighters[e.victim].lastHitT > 45) unforcedPitDeaths++;
      }
      for (const f of g.fighters) {
        if (!Number.isFinite(f.x) || !Number.isFinite(f.y) || !Number.isFinite(f.hp)) sane = false;
      }
      if (!sane) break;
    }
    totalRounds += g.wins[0] + g.wins[1];
    if (g.screen === 'over' && (g.wins[0] === C.ROUNDS_TO_WIN || g.wins[1] === C.ROUNDS_TO_WIN)) resolved++;
    console.log(`     seed ${seed}: ${g.screen === 'over' ? `winner F${g.winner} ${g.wins[0]}-${g.wins[1]} in ${(ticks / 60).toFixed(0)}s` : 'DID NOT RESOLVE'}`);
  }
  console.log(`     rounds ${totalRounds}, pit deaths ${pitDeaths} (${unforcedPitDeaths} unforced)`);
  ok(sane, 'AI-vs-AI: no NaNs across all seeds');
  ok(resolved === seeds.length, `all ${seeds.length} AI-vs-AI matches resolve to a best-of-5 winner`);
  ok(unforcedPitDeaths <= Math.max(1, totalRounds * 0.15),
    `AI pit suicides are rare (${unforcedPitDeaths}/${totalRounds} rounds unforced)`);
}

// ---- AI is beatable: it loses rounds to a competent scripted attacker ----
{
  // Script: walk into quick range and mash quick with pauses; block nothing.
  // It also knows not to walk into the fire — a competent human would.
  const g = SIM.createGame();
  const ai = SIM.createAI(1234);
  let ticks = 0, cd = 0, lastFlip = -99;
  while (g.screen !== 'over' && ticks < 60 * 60 * 12) {
    const me = g.fighters[0], foe = g.fighters[1];
    const i0 = SIM.emptyInput();
    if (g.screen === 'fight' && me.state !== 'ko') {
      const dx = foe.x - me.x;
      const vd = Math.abs(foe.y - me.y);
      if (vd > 2.5) { if (Math.abs(dx) < 2 && ticks - lastFlip > 40) { i0.flip = true; lastFlip = ticks; } else i0.mx = Math.sign(dx); }
      else if (Math.abs(dx) > 1.7) i0.mx = Math.sign(dx);
      else if (cd <= 0 && me.move === null) { i0.quick = true; cd = 16; }
      cd--;
      // pit sense (both cracks): stop at the crack in MY surface; flip out
      // if drifting into it
      const myPit = me.g === 1 ? C.PITS[0] : C.PITS[1];
      if (me.grounded) {
        if (i0.mx > 0 && me.x > myPit.x0 - 1.2 && me.x < myPit.x1) i0.mx = 0;
        if (i0.mx < 0 && me.x > myPit.x0 && me.x < myPit.x1 + 1.2) i0.mx = 0;
      } else if (me.x > myPit.x0 && me.x < myPit.x1 && (me.g === 1 ? me.vy <= 0 : me.vy >= 0)) {
        i0.flip = true; lastFlip = ticks;
      }
    }
    SIM.step(g, [i0, SIM.aiInput(g, ai)]);
    ticks++;
  }
  console.log(`     scripted rusher vs AI: F0 ${g.wins[0]} — F1 ${g.wins[1]}`);
  ok(g.screen === 'over', 'scripted-vs-AI match resolves');
  ok(g.wins[0] >= 1, 'AI is beatable — a simple rusher takes rounds off it');
}

// ---- AI arena sense: it does not stroll into the fire ----
{
  // Deterministic setup (rng pinned to 0.5 -> no "authentic mistakes"):
  // the foe is across the pit, so the AI *wants* to walk right through it.
  const g = SIM.createGame();
  while (g.screen === 'intro') SIM.step(g, [SIM.emptyInput(), SIM.emptyInput()]);
  const ai = SIM.createAI(9);
  ai.rng = () => 0.5;
  const [f0, f1] = g.fighters;
  f1.g = 1; f1.y = C.FH / 2; f1.x = 10.4; f1.grounded = true; // AI on the floor, left of the crack
  f0.g = -1; f0.y = C.AH - C.FH / 2; f0.x = 14.6; f0.grounded = true; // bait on the far side, up top
  let died = false;
  for (let k = 0; k < 900 && g.screen === 'fight'; k++) {
    SIM.step(g, [SIM.emptyInput(), SIM.aiInput(g, ai)]);
    if (g.events.some(e => e.type === 'pitdeath' && e.victim === 1)) died = true;
  }
  ok(!died, 'AI baited across the floor crack: refuses to walk in');
  ok(f1.x < C.PITS[0].x0 + 0.1 || f1.g === -1, 'AI held the edge (or took the ceiling route)');
}
{
  // MIRROR: AI on ceiling gravity, baited leftward across the CEILING crack
  const g = SIM.createGame();
  while (g.screen === 'intro') SIM.step(g, [SIM.emptyInput(), SIM.emptyInput()]);
  const ai = SIM.createAI(13);
  ai.rng = () => 0.5;
  const [f0, f1] = g.fighters;
  f1.g = -1; f1.y = C.AH - C.FH / 2; f1.x = 5.6; f1.grounded = true; // on the ceiling, right of its crack
  f0.g = 1; f0.y = C.FH / 2; f0.x = 1.4; f0.grounded = true; // bait beyond it, down on the floor
  let died = false;
  for (let k = 0; k < 900 && g.screen === 'fight'; k++) {
    SIM.step(g, [SIM.emptyInput(), SIM.aiInput(g, ai)]);
    if (g.events.some(e => e.type === 'pitdeath' && e.victim === 1)) died = true;
  }
  ok(!died, 'AI baited across the ceiling crack: refuses to walk in');
}
{
  // AI standing where a flip would sail into the far surface's crack — the
  // low shelf's top sits directly under the ceiling crack — must not flip up
  const g = SIM.createGame();
  while (g.screen === 'intro') SIM.step(g, [SIM.emptyInput(), SIM.emptyInput()]);
  const ai = SIM.createAI(11);
  ai.rng = () => 0.5;
  const [f0, f1] = g.fighters;
  f1.g = 1; f1.x = 3.5; f1.y = C.PLATS[0].y1 + C.FH / 2; f1.grounded = true; // on the low shelf, under the ceiling crack
  f0.g = 1; f0.y = C.FH / 2; f0.x = 14.0; f0.grounded = true;
  let died = false;
  for (let k = 0; k < 900 && g.screen === 'fight'; k++) {
    SIM.step(g, [SIM.emptyInput(), SIM.aiInput(g, ai)]);
    if (g.events.some(e => e.type === 'pitdeath' && e.victim === 1)) died = true;
  }
  ok(!died, 'AI never flips UP into the ceiling crack from the shelf beneath it');
}
{
  // AI drifting airborne over its own crack flips to the other surface —
  // both gravities
  for (const [gsign, x, y, name] of [[1, 12.5, 6, 'floor'], [-1, 3.5, C.AH - 6, 'ceiling']]) {
    const g = SIM.createGame();
    while (g.screen === 'intro') SIM.step(g, [SIM.emptyInput(), SIM.emptyInput()]);
    const ai = SIM.createAI(17);
    ai.rng = () => 0.5;
    const f1 = g.fighters[1];
    f1.g = gsign; f1.x = x; f1.y = y; f1.vy = 0; f1.grounded = false; // dropped over the crack
    let died = false, escaped = false;
    for (let k = 0; k < 240 && g.screen === 'fight'; k++) {
      SIM.step(g, [SIM.emptyInput(), SIM.aiInput(g, ai)]);
      if (g.events.some(e => e.type === 'pitdeath' && e.victim === 1)) died = true;
      if (f1.g === -gsign) escaped = true;
    }
    ok(!died && escaped, `AI dropped over the ${name} crack: flips to the other surface to escape`);
  }
}

process.exit(failed);
