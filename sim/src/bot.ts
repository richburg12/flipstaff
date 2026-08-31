// Bot controller. Produces an InputFrame each tick from the world state. Three
// levels; higher levels react faster and use more of the kit. Bots never walk
// off the stage voluntarily and always try to recover. State that must persist
// between ticks lives on the fighter's botMemory.

import { emptyInput, type InputFrame, type Sector } from './input.ts';
import type { Fighter } from './fighter.ts';
import type { World } from './world.ts';
import { MOVES } from './moves.ts';

export type BotLevel = 'easy' | 'medium' | 'hard';

const REACT: Record<BotLevel, number> = { easy: 20, medium: 12, hard: 6 };
const STAGE_L = 8.5;
const STAGE_R = 31.5;
const CENTER = 20;

export function computeBot(f: Fighter, world: World, level: BotLevel): InputFrame {
  const inp = emptyInput();
  const opp = nearest(f, world);
  const react = REACT[level];
  const mem = f.botMemory;
  const t = world.tick_;

  // --- recovery: back onto the stage takes priority over everything ---
  const offLeft = f.body.x < STAGE_L;
  const offRight = f.body.x > STAGE_R;
  const belowStage = f.body.y < 5.5;
  const airborne = !f.grounded;
  if ((offLeft || offRight) && (airborne || belowStage)) {
    inp.mx = offLeft ? 1 : -1;
    if (f.body.vy < 0.02 && belowStage) {
      // jump / up-special to recover
      if (f.jumps > 0) inp.jump = true;
      else if (f.blinkCooldown === 0 && level !== 'easy') {
        inp.special = true;
        inp.specialDir = 'up';
      }
    }
    return inp;
  }

  if (!opp) {
    // wander toward center
    inp.mx = f.body.x < CENTER ? 0.4 : -0.4;
    return inp;
  }

  const dx = opp.body.x - f.body.x;
  const dy = opp.body.y - f.body.y;
  const dist = Math.hypot(dx, dy);
  const wantFace = dx >= 0 ? 1 : -1;
  const towardStick = wantFace; // mx sign toward opponent

  // Don't step off a ledge chasing.
  const nearLedge = (f.body.x < STAGE_L + 1 && wantFace < 0) || (f.body.x > STAGE_R - 1 && wantFace > 0);

  // Reaction gate: only make fresh offensive decisions every `react` ticks.
  const decide = (t + f.id * 7) % react === 0;

  // Hard: parry attempt when opponent attack is about to connect.
  if (level === 'hard' && opp.state === 'attack' && opp.move) {
    const m = MOVES[opp.move];
    const active = opp.moveFrame >= m.startup - 2 && opp.moveFrame <= m.startup + m.active;
    if (active && dist < 1.6 && Math.random() < 0.3) {
      inp.block = true;
      return inp;
    }
  }
  // Medium: block when opponent is in startup at close range (50%).
  if (level !== 'easy' && opp.state === 'attack' && opp.move) {
    const m = MOVES[opp.move];
    if (opp.moveFrame <= m.startup && dist < 1.8 && chance(mem, t, level === 'hard' ? 0.6 : 0.5)) {
      inp.block = true;
      return inp;
    }
  }

  // Off-stage opponent: go for the spike (hard) / edgeguard.
  if (level === 'hard' && (opp.body.x < STAGE_L || opp.body.x > STAGE_R) && opp.body.y < f.body.y) {
    inp.mx = towardStick * 0.8;
    if (airborne) {
      inp.heavy = true;
      inp.heavyDir = 'down'; // dive spike
      return inp;
    }
    if (f.grounded) inp.jump = true;
    return inp;
  }

  // Movement toward opponent (unless it means walking off).
  if (dist > 1.3 && !nearLedge) {
    inp.mx = towardStick * (dist > 4 ? 0.9 : 0.6);
  } else if (nearLedge) {
    inp.mx = 0;
  }

  // Jump to chase aerial opponents.
  if (dy > 1.5 && f.grounded && decide) {
    inp.jump = true;
  }

  // Attacks by range.
  if (decide) {
    if (dist <= 1.2) {
      if (!airborne) {
        // close: jab or grab mixups
        if (level !== 'easy' && opp.blocking && Math.random() < 0.5) {
          inp.grab = true;
          inp.mx = towardStick * 0.9;
        } else if (dy > 0.8) {
          inp.heavy = true;
          inp.heavyDir = 'up'; // launcher
        } else {
          inp.jab = true;
        }
      } else {
        inp.heavy = true;
        inp.heavyDir = dy > 0.5 ? 'up' : 'fwd';
      }
    } else if (dist <= 1.8) {
      inp.heavy = true;
      inp.heavyDir = 'fwd'; // forward kick, bread and butter
    } else if (dist <= 3.2 && level !== 'easy' && Math.random() < 0.25) {
      inp.special = true;
      inp.specialDir = 'fwd'; // pulse poke
    }
  }

  // Medium+: launcher -> up-air follow-up when opponent just got launched.
  if (level !== 'easy' && opp.state === 'hitstun' && opp.body.y > f.body.y && airborne && decide) {
    inp.heavy = true;
    inp.heavyDir = 'up';
  }

  // DI on hard when in hitstun (handled by movement stick angle).
  if (level === 'hard' && f.state === 'hitstun') {
    // DI perpendicular to launch, toward stage center
    inp.mx = f.body.x < CENTER ? 0.8 : -0.8;
    inp.my = 0.4;
  }

  // Tech attempts (hard 70%) — flick toward the surface we're flying into.
  if (level === 'hard' && f.state === 'hitstun' && Math.random() < 0.7) {
    inp.mx = f.body.vx > 0 ? 1 : -1;
  }

  return inp;
}

function nearest(f: Fighter, world: World): Fighter | null {
  let best: Fighter | null = null;
  let bd = Infinity;
  for (const o of world.fighters) {
    if (o === f || !o.alive) continue;
    const d = Math.hypot(o.body.x - f.body.x, o.body.y - f.body.y);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

// Deterministic-ish chance keyed loosely by memory so bots don't jitter block.
function chance(mem: Record<string, number>, t: number, p: number): boolean {
  const last = mem.lastBlock ?? -999;
  if (t - last < 20) return false;
  if (Math.random() < p) {
    mem.lastBlock = t;
    return true;
  }
  return false;
}

export type { Sector };
