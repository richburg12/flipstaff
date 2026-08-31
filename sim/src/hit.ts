// Hit resolution: attacker active hitboxes vs victim hurtboxes, the
// Strike/Grab/Block triangle, knockback, hitstop, tile/pillar destruction, and
// blast-zone ring-outs. Called by World once per tick after fighters advance.

import { MOVES } from './moves.ts';
import { overlap } from './physics.ts';
import { HITSTOP_BASE, HITSTOP_MAX, BLOCKSTUN_EXTRA } from './constants.ts';
import type { Fighter } from './fighter.ts';
import type { Stage, AABB } from './stage.ts';
import { BLAST } from './stage.ts';

export interface HitEvent {
  type: string;
  x: number;
  y: number;
  a?: number; // attacker id
  v?: number; // victim id
  dmg?: number;
  kb?: number;
  extra?: string;
}

function center(a: AABB) {
  return { x: (a.x0 + a.x1) / 2, y: (a.y0 + a.y1) / 2 };
}

export function resolveCombat(fighters: Fighter[], stage: Stage, now: number, events: HitEvent[], strEvents: string[]): void {
  for (const atk of fighters) {
    if (!atk.alive) continue;
    const hb = atk.activeHitbox();
    if (!hb || !atk.move) continue;
    const m = MOVES[atk.move];

    // Tile / pillar destruction on heavy or dive overlap
    if (m.isHeavy || m.breaksTile) {
      for (const t of stage.tiles) {
        if (t.gone) continue;
        const tb: AABB = { x0: t.x0, y0: 5, x1: t.x1, y1: 6 };
        if (overlap(hb, tb)) {
          const dmg = atk.move === 'dive' ? 3 : 1;
          if (!atk.tileHitThisMove.has(t.index)) {
            atk.tileHitThisMove.add(t.index);
            stage.hitTile(t, dmg, now, strEvents);
          }
        }
      }
      for (const p of stage.pillars) {
        if (p.broken) continue;
        const pb: AABB = { x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1 };
        if (overlap(hb, pb) && !atk.pillarHitThisMove) {
          atk.pillarHitThisMove = true;
          stage.hitPillar(p, now, strEvents);
        }
      }
    }

    // Fighter hits
    for (const vic of fighters) {
      if (vic === atk || !vic.alive) continue;
      if (atk.hitThisMove.has(vic.id)) continue;
      if (!overlap(hb, vic.hurtbox())) continue;

      // from behind? use the ATTACKER's position vs the victim's facing (the
      // hitbox centre sits past a point-blank defender's back and would wrongly
      // read every close hit as a crossup).
      const behind = (atk.body.x - vic.body.x) * vic.facing < 0;

      const outcome = vic.onStruck(atk, m, behind);
      atk.hitThisMove.add(vic.id);
      const cc = center(hb);

      if (outcome === 'immune') {
        continue;
      }
      if (outcome === 'parried') {
        events.push({ type: 'parry', x: cc.x, y: cc.y, a: atk.id, v: vic.id });
        continue;
      }
      if (outcome === 'blocked') {
        // attacker suffers blockstun = recovery + extra; defender gains advantage
        atk.hitstun = 0;
        atk.blockstun = m.recovery + BLOCKSTUN_EXTRA;
        events.push({ type: 'blocked', x: cc.x, y: cc.y, a: atk.id, v: vic.id });
        continue;
      }
      if (outcome === 'counter') {
        // victim absorbs and strikes back
        const ab = vic.counterAbsorbed!;
        atk.applyKnockback(ab.dmg * 1.5, ab.kb * 1.3, 0.05, ab.angle, vic.facing, 1, vic);
        applyHitstop(atk, vic, ab.dmg * 1.5);
        events.push({ type: 'counter', x: cc.x, y: cc.y, a: vic.id, v: atk.id });
        continue;
      }

      // clean hit — momentum mult (attacker speed) x bell damage-dealt mult
      const mult = atk.momentumMult * atk.damageDealtMult;
      vic.applyKnockback(m.dmg, m.baseKb, m.growth, m.angle, atk.facing, mult, atk);
      applyHitstop(atk, vic, m.dmg);
      events.push({ type: 'hit', x: cc.x, y: cc.y, a: atk.id, v: vic.id, dmg: m.dmg, kb: vic.lastKb, extra: m.spike ? 'spike' : '' });
      atk.stat_dmgDealt += m.dmg * mult;
      if (predictKill(vic)) events.push({ type: 'killblow', x: cc.x, y: cc.y, a: atk.id, v: vic.id });
    }
  }
}

function applyHitstop(a: Fighter, b: Fighter, dmg: number): void {
  const stop = Math.min(HITSTOP_BASE + Math.floor(dmg / 3), HITSTOP_MAX);
  a.hitstop = Math.max(a.hitstop, stop);
  b.hitstop = Math.max(b.hitstop, stop);
}

// Blast-zone check -> returns victims who died this tick (for stock/respawn).
export function checkRingouts(fighters: Fighter[], events: HitEvent[]): Fighter[] {
  const dead: Fighter[] = [];
  for (const f of fighters) {
    if (!f.alive || f.state === 'respawn') continue;
    const b = f.body;
    if (b.x < BLAST.left || b.x > BLAST.right || b.y < BLAST.bottom || b.y + f.body.h > BLAST.top) {
      dead.push(f);
      events.push({ type: 'kill', x: clampBlastX(b.x), y: clampBlastY(b.y), v: f.id });
    }
  }
  return dead;
}

function clampBlastX(x: number) {
  return Math.max(BLAST.left, Math.min(BLAST.right, x));
}
function clampBlastY(y: number) {
  return Math.max(BLAST.bottom, Math.min(BLAST.top, y));
}

// Predict whether a knockback will carry a victim out of the blast zone within
// ~30 frames (for the killing-blow slow-mo). Simple ballistic projection.
export function predictKill(f: Fighter): boolean {
  let x = f.body.x;
  let y = f.body.y;
  let vx = f.body.vx;
  let vy = f.body.vy;
  for (let i = 0; i < 40; i++) {
    x += vx;
    y += vy;
    vy -= 0.012;
    if (vy < -0.45) vy = -0.45;
    if (x < BLAST.left || x > BLAST.right || y < BLAST.bottom || y > BLAST.top) return true;
  }
  return false;
}
