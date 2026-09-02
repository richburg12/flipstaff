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
      // pit sense: stop at the crack; flip out if falling toward it
      if (me.g === 1) {
        if (me.grounded && i0.mx > 0 && me.x > C.PIT.x0 - 1.2 && me.x < C.PIT.x1) i0.mx = 0;
        if (me.grounded && i0.mx < 0 && me.x > C.PIT.x0 && me.x < C.PIT.x1 + 1.2) i0.mx = 0;
        if (!me.grounded && me.x > C.PIT.x0 && me.x < C.PIT.x1 && me.vy <= 0) { i0.flip = true; lastFlip = ticks; }
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
  ok(!died, 'AI baited across the pit: refuses to walk into the crack');
  ok(f1.x < C.PIT.x0 + 0.1 || f1.g === -1, 'AI held the edge (or took the ceiling route)');
}
{
  // AI directly above the fire on the ceiling: it does not flip down into it
  const g = SIM.createGame();
  while (g.screen === 'intro') SIM.step(g, [SIM.emptyInput(), SIM.emptyInput()]);
  const ai = SIM.createAI(11);
  ai.rng = () => 0.5;
  const [f0, f1] = g.fighters;
  f1.g = -1; f1.y = C.AH - C.FH / 2; f1.x = 12.5; f1.grounded = true; // parked over the crack
  f0.g = 1; f0.y = C.FH / 2; f0.x = 10.0; f0.grounded = true;
  let died = false;
  for (let k = 0; k < 900 && g.screen === 'fight'; k++) {
    SIM.step(g, [SIM.emptyInput(), SIM.aiInput(g, ai)]);
    if (g.events.some(e => e.type === 'pitdeath' && e.victim === 1)) died = true;
  }
  ok(!died, 'AI over the pit on the ceiling: never flips down into the fire');
}

process.exit(failed);
