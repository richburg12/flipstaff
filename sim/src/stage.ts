// The Foundry — the one stage. World is 40x22 units, origin bottom-left, +y up.
// Holds all destructible/dynamic geometry (tiles, pillars, platforms) and the
// stage's own clock (bell, furnace surge). Physics reads solids()/oneways().

import {
  TILE_HP,
  TILE_REGEN_S,
  TILE_REFORGE_FRAMES,
  PILLAR_HP,
  PILLAR_DROP_DELAY,
  FURNACE_EVERY_S,
  FURNACE_WARN_FRAMES,
  FURNACE_OPEN_S,
  BELL_FIRST_SPAWN_S,
  BELL_RESPAWN_S,
  TICK_HZ,
} from './constants.ts';
import type { RNG } from './rng.ts';

export interface AABB {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface OneWay {
  x0: number;
  x1: number;
  y: number;
}

export const WORLD_W = 40;
export const WORLD_H = 22;
export const BLAST = { left: -4, right: 44, bottom: -3, top: 27 };

export const SPAWN_POINTS = [
  { x: 20, y: 15 }, // top platform (respawn)
  { x: 12, y: 11 },
  { x: 28, y: 11 },
  { x: 20, y: 6 },
];

const TILE_COUNT = 12;
const TILE_W = 2;
const TILE_X0 = 8; // main floor x 8..32
const TILE_TOP = 6; // top surface y=6, tile body y in [5,6]

export interface Tile {
  index: number;
  x0: number;
  x1: number;
  hp: number;
  gone: boolean;
  regenAt: number; // tick to start reforge (0 = n/a)
  reforge: number; // frames left in reforge animation
}

export interface Pillar {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  hp: number;
  broken: boolean;
  dropAt: number; // tick the side platform drops (0 = n/a)
  side: 'left' | 'right';
}

export class Stage {
  tiles: Tile[] = [];
  pillars: Pillar[] = [];
  // Side platforms can drop when their pillar breaks.
  leftPlatY = 11;
  rightPlatY = 11;
  topPlatY = 15;

  // Bell
  bellActive = false;
  bellSpawnTick = Math.round(BELL_FIRST_SPAWN_S * TICK_HZ);
  bellHolder = -1; // fighter id, -1 none

  // Furnace surge
  furnaceNextTick = Math.round(FURNACE_EVERY_S * TICK_HZ);
  furnaceWarnLeft = 0;
  furnaceOpenLeft = 0;
  furnaceTiles: number[] = []; // tile indices currently surging

  constructor() {
    for (let i = 0; i < TILE_COUNT; i++) {
      const x0 = TILE_X0 + i * TILE_W;
      this.tiles.push({ index: i, x0, x1: x0 + TILE_W, hp: TILE_HP, gone: false, regenAt: 0, reforge: 0 });
    }
    this.pillars.push({ x0: 7, x1: 8, y0: 6, y1: 12, hp: PILLAR_HP, broken: false, dropAt: 0, side: 'left' });
    this.pillars.push({ x0: 32, x1: 33, y0: 6, y1: 12, hp: PILLAR_HP, broken: false, dropAt: 0, side: 'right' });
  }

  // Solid AABBs a fighter collides with on all sides.
  solids(): AABB[] {
    const out: AABB[] = [];
    for (const t of this.tiles) {
      if (!t.gone) out.push({ x0: t.x0, y0: 5, x1: t.x1, y1: TILE_TOP });
    }
    for (const p of this.pillars) {
      if (!p.broken) out.push({ x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1 });
    }
    return out;
  }

  // One-way (drop-through) platforms.
  oneways(): OneWay[] {
    return [
      { x0: 4, x1: 10, y: this.leftPlatY },
      { x0: 30, x1: 36, y: this.rightPlatY },
      { x0: 17, x1: 23, y: this.topPlatY },
    ];
  }

  tileAtX(x: number): Tile | null {
    for (const t of this.tiles) if (!t.gone && x >= t.x0 && x < t.x1) return t;
    return null;
  }

  // Returns event strings for effects/audio. `now` is the current tick.
  update(now: number, rng: RNG, events: string[]): void {
    // Tile regen
    for (const t of this.tiles) {
      if (t.gone && t.regenAt > 0 && now >= t.regenAt) {
        t.regenAt = 0;
        t.reforge = TILE_REFORGE_FRAMES;
      }
      if (t.reforge > 0) {
        t.reforge--;
        if (t.reforge === 0) {
          t.gone = false;
          t.hp = TILE_HP;
          events.push('tileReforge:' + t.index);
        }
      }
    }
    // Pillar platform drop
    for (const p of this.pillars) {
      if (p.dropAt > 0 && now >= p.dropAt) {
        p.dropAt = 0;
        if (p.side === 'left') this.leftPlatY = 9;
        else this.rightPlatY = 9;
        events.push('platDrop:' + p.side);
      }
    }
    // Bell spawn
    if (!this.bellActive && this.bellHolder < 0 && this.bellSpawnTick > 0 && now >= this.bellSpawnTick) {
      this.bellActive = true;
      this.bellSpawnTick = 0;
      events.push('bellSpawn');
    }
    // Furnace surge
    if (this.furnaceWarnLeft > 0) {
      this.furnaceWarnLeft--;
      if (this.furnaceWarnLeft === 0) {
        // open: mark tiles gone temporarily (hp irrelevant), reforge after open
        for (const idx of this.furnaceTiles) {
          const t = this.tiles[idx];
          t.gone = true;
          t.regenAt = now + Math.round(FURNACE_OPEN_S * TICK_HZ);
        }
        events.push('furnaceOpen');
      }
    } else if (this.furnaceOpenLeft > 0) {
      this.furnaceOpenLeft--;
    } else if (this.furnaceNextTick > 0 && now >= this.furnaceNextTick) {
      // pick a contiguous 3-tile section among present tiles
      const start = rng.int(0, TILE_COUNT - 3);
      this.furnaceTiles = [start, start + 1, start + 2];
      this.furnaceWarnLeft = FURNACE_WARN_FRAMES;
      this.furnaceOpenLeft = FURNACE_WARN_FRAMES + Math.round(FURNACE_OPEN_S * TICK_HZ);
      this.furnaceNextTick = now + Math.round(FURNACE_EVERY_S * TICK_HZ);
      events.push('furnaceWarn');
    }
  }

  // Damage a tile (heavy hit = 1, dive = 3). Returns true if it broke now.
  hitTile(t: Tile, amount: number, now: number, events: string[]): boolean {
    if (t.gone) return false;
    t.hp -= amount;
    if (t.hp <= 0) {
      t.gone = true;
      t.hp = 0;
      t.regenAt = now + Math.round(TILE_REGEN_S * TICK_HZ);
      events.push('tileBreak:' + t.index);
      return true;
    }
    events.push('tileCrack:' + t.index);
    return false;
  }

  hitPillar(p: Pillar, now: number, events: string[]): void {
    if (p.broken) return;
    p.hp -= 1;
    if (p.hp <= 0) {
      p.broken = true;
      p.dropAt = now + PILLAR_DROP_DELAY;
      events.push('pillarBreak:' + p.side);
    }
  }

  takeBell(fighterId: number, events: string[]): void {
    if (!this.bellActive) return;
    this.bellActive = false;
    this.bellHolder = fighterId;
    events.push('bellTaken:' + fighterId);
  }

  // Called when a bell holder's buff ends; schedule respawn.
  dropBell(now: number, events: string[]): void {
    this.bellHolder = -1;
    this.bellSpawnTick = now + Math.round(BELL_RESPAWN_S * TICK_HZ);
    events.push('bellGone');
  }
}
