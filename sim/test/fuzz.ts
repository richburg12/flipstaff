// Headless soak test: run many ticks of full matches with random inputs and
// assert the sim never produces NaNs, never traps a fighter inside geometry,
// and never throws. Run before every commit: `npm test`.

import { createWorld } from '../src/index.ts';
import { emptyInput, type InputFrame } from '../src/input.ts';
import { WORLD_W, WORLD_H } from '../src/stage.ts';

function randInput(rng: () => number): InputFrame {
  const i = emptyInput();
  i.mx = rng() * 2 - 1;
  i.my = rng() * 2 - 1;
  i.jump = rng() < 0.05;
  i.dash = rng() < 0.03;
  i.dashDir = rng() < 0.5 ? -1 : 1;
  i.fastFall = rng() < 0.05;
  i.crouch = rng() < 0.05;
  i.jab = rng() < 0.1;
  i.heavy = rng() < 0.08;
  const dirs = ['fwd', 'back', 'up', 'down'] as const;
  i.heavyDir = dirs[Math.floor(rng() * 4)];
  i.block = rng() < 0.06;
  i.special = rng() < 0.03;
  i.specialDir = dirs[Math.floor(rng() * 4)];
  i.grab = rng() < 0.02;
  return i;
}

function mulberry(seed: number) {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let failures = 0;
const TOTAL_TICKS = 10000;

function run(seed: number, humans: number) {
  const rng = mulberry(seed);
  const specs = [];
  for (let i = 0; i < 4; i++) {
    specs.push({ id: i, name: 'F' + i, face: '', color: i, isBot: i >= humans, botLevel: (['easy', 'medium', 'hard'] as const)[i % 3] });
  }
  const world = createWorld(seed, specs);
  const inputs = new Map<number, InputFrame>();

  for (let tick = 0; tick < TOTAL_TICKS; tick++) {
    inputs.clear();
    for (let i = 0; i < humans; i++) inputs.set(i, randInput(rng));
    world.tick(inputs);

    for (const f of world.fighters) {
      const b = f.body;
      if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.vx) || !Number.isFinite(b.vy)) {
        console.error(`NaN at tick ${tick}, fighter ${f.id}: x=${b.x} y=${b.y} vx=${b.vx} vy=${b.vy}`);
        failures++;
        return;
      }
      // sanity: never absurdly far outside the world
      if (b.x < -50 || b.x > WORLD_W + 50 || b.y < -50 || b.y > WORLD_H + 50) {
        console.error(`Runaway position at tick ${tick}, fighter ${f.id}: x=${b.x} y=${b.y}`);
        failures++;
        return;
      }
      if (!Number.isFinite(f.damage) || f.damage < 0) {
        console.error(`Bad damage at tick ${tick}, fighter ${f.id}: ${f.damage}`);
        failures++;
        return;
      }
    }

    // If the match ended, start a fresh one to keep soaking.
    if (world.status === 'ended') {
      world.startCountdown();
    }
  }
}

console.log('fuzzing sim...');
try {
  run(12345, 2);
  run(67890, 1);
  run(2468, 4);
  run(99999, 0); // all bots
} catch (e) {
  console.error('THREW:', e);
  failures++;
}

if (failures === 0) {
  console.log(`OK — ${TOTAL_TICKS * 4} ticks across 4 matches, no NaNs / no runaways / no crashes.`);
  process.exit(0);
} else {
  console.error(`FAILED with ${failures} issue(s).`);
  process.exit(1);
}
