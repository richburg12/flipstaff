// Hand-written AABB platformer physics. A "body" is a fighter's feet-centred
// box (x = centre, y = feet, moving in world units/frame). We move one axis at
// a time and correct out of solids, then handle one-way platforms on the way
// down. No engine, no sweep — speeds are small relative to tile size so simple
// move-and-correct never tunnels.

import type { AABB, OneWay, Stage } from './stage.ts';
import { FIGHTER_W, FIGHTER_H } from './constants.ts';

export interface Body {
  x: number; // centre x
  y: number; // feet y
  vx: number;
  vy: number;
  w: number;
  h: number;
}

export interface CollisionFlags {
  grounded: boolean;
  ceiling: boolean;
  wallLeft: boolean;
  wallRight: boolean;
  landedThisFrame: boolean;
  hitWallSpeed: number; // horizontal speed at moment of wall contact (for tech/splat)
  hitFloorSpeed: number; // vertical speed at floor contact
  groundTileX: number | null; // x of the tile the body is standing on (for tile logic)
}

export function bodyBox(b: Body): AABB {
  return { x0: b.x - b.w / 2, y0: b.y, x1: b.x + b.w / 2, y1: b.y + b.h };
}

export function overlap(a: AABB, c: AABB): boolean {
  return a.x0 < c.x1 && a.x1 > c.x0 && a.y0 < c.y1 && a.y1 > c.y0;
}

export function newBody(x: number, y: number): Body {
  return { x, y, vx: 0, vy: 0, w: FIGHTER_W, h: FIGHTER_H };
}

// Move the body through the stage for one frame. `dropThrough` lets a crouching
// fighter fall through one-way platforms this frame.
export function stepBody(b: Body, stage: Stage, dropThrough: boolean): CollisionFlags {
  const flags: CollisionFlags = {
    grounded: false,
    ceiling: false,
    wallLeft: false,
    wallRight: false,
    landedThisFrame: false,
    hitWallSpeed: 0,
    hitFloorSpeed: 0,
    groundTileX: null,
  };
  const solids = stage.solids();
  const oneways = stage.oneways();

  // --- Horizontal ---
  const preVx = b.vx;
  b.x += b.vx;
  {
    const box = bodyBox(b);
    for (const s of solids) {
      if (!overlap(box, s)) continue;
      // Resolve along x: push out to the nearer side.
      if (b.vx > 0) {
        b.x = s.x0 - b.w / 2 - 1e-4;
        flags.wallRight = true;
      } else if (b.vx < 0) {
        b.x = s.x1 + b.w / 2 + 1e-4;
        flags.wallLeft = true;
      } else {
        // zero vx but overlapping (e.g. pushed): nudge out minimally
        const dl = box.x1 - s.x0;
        const dr = s.x1 - box.x0;
        if (dl < dr) b.x -= dl + 1e-4;
        else b.x += dr + 1e-4;
      }
      flags.hitWallSpeed = Math.abs(preVx);
      b.vx = 0;
      box.x0 = b.x - b.w / 2;
      box.x1 = b.x + b.w / 2;
    }
  }

  // --- Vertical ---
  const preVy = b.vy;
  const prevFeet = b.y;
  b.y += b.vy;
  {
    const box = bodyBox(b);
    // Solids (floors/ceilings/tile sides already handled horizontally)
    for (const s of solids) {
      if (!overlap(box, s)) continue;
      if (b.vy > 0) {
        // moving up -> hit ceiling
        b.y = s.y0 - b.h - 1e-4;
        flags.ceiling = true;
        flags.hitFloorSpeed = Math.abs(preVy);
        b.vy = 0;
      } else {
        // moving down or resting -> land on top
        b.y = s.y1 + 1e-4;
        flags.grounded = true;
        flags.landedThisFrame = preVy < 0;
        flags.hitFloorSpeed = Math.abs(preVy);
        b.vy = 0;
      }
      box.y0 = b.y;
      box.y1 = b.y + b.h;
    }
    // One-way platforms: only when falling, feet crossed the platform top this
    // frame, and not dropping through.
    if (!flags.grounded && b.vy <= 0 && !dropThrough) {
      for (const w of oneways) {
        if (b.x < w.x0 || b.x > w.x1) continue;
        if (prevFeet >= w.y - 1e-3 && b.y <= w.y + 1e-3) {
          b.y = w.y;
          b.vy = 0;
          flags.grounded = true;
          flags.landedThisFrame = preVy < 0;
          flags.hitFloorSpeed = Math.abs(preVy);
          break;
        }
      }
    }
  }

  // Record the tile currently underfoot (for dive/heavy tile logic and drops).
  if (flags.grounded) {
    const t = stage.tileAtX(b.x);
    if (t && Math.abs(b.y - 6) < 0.05) flags.groundTileX = t.x0;
  }

  return flags;
}

// Standing check without moving (used for coyote time / grab range etc.)
export function isGroundedAt(b: Body, stage: Stage): boolean {
  const probe: Body = { ...b, y: b.y - 0.02, vy: -0.02 };
  const box = bodyBox(probe);
  for (const s of stage.solids()) {
    if (overlap(box, s) && probe.y < s.y1) return true;
  }
  for (const w of stage.oneways()) {
    if (b.x >= w.x0 && b.x <= w.x1 && Math.abs(b.y - w.y) < 0.05) return true;
  }
  return false;
}
