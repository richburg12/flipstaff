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
      for (const f of g.fighters) {
        if (!Number.isFinite(f.x) || !Number.isFinite(f.y) || !Number.isFinite(f.hp)) sane = false;
      }
      if (!sane) break;
    }
    if (g.screen === 'over' && (g.wins[0] === C.ROUNDS_TO_WIN || g.wins[1] === C.ROUNDS_TO_WIN)) resolved++;
    console.log(`     seed ${seed}: ${g.screen === 'over' ? `winner F${g.winner} ${g.wins[0]}-${g.wins[1]} in ${(ticks / 60).toFixed(0)}s` : 'DID NOT RESOLVE'}`);
  }
  ok(sane, 'AI-vs-AI: no NaNs across all seeds');
  ok(resolved === seeds.length, `all ${seeds.length} AI-vs-AI matches resolve to a best-of-5 winner`);
}

// ---- AI is beatable: it loses rounds to a competent scripted attacker ----
{
  // Script: walk into quick range and mash quick with pauses; block nothing.
  // A fair, imperfect AI should drop at least one round to this across a match.
  const g = SIM.createGame();
  const ai = SIM.createAI(1234);
  let ticks = 0, cd = 0;
  while (g.screen !== 'over' && ticks < 60 * 60 * 12) {
    const me = g.fighters[0], foe = g.fighters[1];
    const i0 = SIM.emptyInput();
    if (g.screen === 'fight' && me.state !== 'ko') {
      const dx = foe.x - me.x;
      const vd = Math.abs(foe.y - me.y);
      if (vd > 2.5) { if (me.flipCd === 0 && Math.abs(dx) < 2) i0.flip = true; else i0.mx = Math.sign(dx); }
      else if (Math.abs(dx) > 1.7) i0.mx = Math.sign(dx);
      else if (cd <= 0 && me.move === null) { i0.quick = true; cd = 16; }
      cd--;
    }
    SIM.step(g, [i0, SIM.aiInput(g, ai)]);
    ticks++;
  }
  console.log(`     scripted rusher vs AI: F0 ${g.wins[0]} — F1 ${g.wins[1]}`);
  ok(g.screen === 'over', 'scripted-vs-AI match resolves');
  ok(g.wins[0] >= 1, 'AI is beatable — a simple rusher takes rounds off it');
}

// ---- AI respects the flip cooldown via the sim (input pathway can't cheat) ----
{
  const g = SIM.createGame();
  const ai = SIM.createAI(5);
  let flips = 0, lastFlipTick = -999, minGap = 1e9;
  for (let k = 0; k < 60 * 120; k++) {
    const before = g.fighters[1].g;
    SIM.step(g, [SIM.emptyInput(), SIM.aiInput(g, ai)]);
    if (g.fighters[1].g !== before) {
      flips++;
      if (lastFlipTick > 0) minGap = Math.min(minGap, g.tick - lastFlipTick);
      lastFlipTick = g.tick;
    }
    if (g.screen === 'over') break;
  }
  ok(flips === 0 || minGap >= C.FLIP_CD, `AI flips obey the sim cooldown (${flips} flips, min gap ${minGap === 1e9 ? 'n/a' : minGap})`);
}

process.exit(failed);
