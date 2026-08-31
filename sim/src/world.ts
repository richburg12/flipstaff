// The World: owns the fighters, projectiles, stage, and match clock. tick()
// advances everything one 60 Hz frame given each fighter's input for this tick.
// The server runs this authoritatively; the client runs it for local prediction
// and for the offline ?local=1 mode.

import { Fighter, type WorldHooks } from './fighter.ts';
import { Stage, BLAST } from './stage.ts';
import { RNG } from './rng.ts';
import { resolveCombat, checkRingouts, type HitEvent } from './hit.ts';
import { emptyInput, type InputFrame } from './input.ts';
import { MOVES } from './moves.ts';
import {
  TICK_HZ,
  MATCH_SECONDS,
  COUNTDOWN_SECONDS,
  RESPAWN_FRAMES,
  BELL_BUFF_S,
  BELL_DAMAGE_MULT,
  BELL_RING_EVERY_S,
} from './constants.ts';
import { computeBot, type BotLevel } from './bot.ts';

export interface Projectile {
  id: number;
  owner: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  dmg: number;
  baseKb: number;
  growth: number;
  angle: number;
  facing: number;
}

export type MatchStatus = 'countdown' | 'live' | 'ended';

export interface Placement {
  id: number;
  name: string;
  place: number;
  kos: number;
  dmgDealt: number;
  parries: number;
  tiles: number;
  bestCombo: number;
}

export class World {
  fighters: Fighter[] = [];
  projectiles: Projectile[] = [];
  stage = new Stage();
  rng: RNG;
  tick_ = 0;
  status: MatchStatus = 'countdown';
  countdownLeft: number;
  timeLeft: number; // frames
  events: HitEvent[] = [];
  strEvents: string[] = [];
  private projId = 1;
  botLevels = new Map<number, BotLevel>();
  results: Placement[] | null = null;
  deathOrder: number[] = []; // ids in the order they were eliminated (for placement)

  constructor(seed: number) {
    this.rng = new RNG(seed);
    this.countdownLeft = COUNTDOWN_SECONDS * TICK_HZ;
    this.timeLeft = MATCH_SECONDS * TICK_HZ;
  }

  private hooks: WorldHooks = {
    spawnPulse: (f: Fighter) => {
      // one pulse on screen per player
      if (this.projectiles.some((p) => p.owner === f.id)) return;
      const m = MOVES.pulse;
      this.projectiles.push({
        id: this.projId++,
        owner: f.id,
        x: f.body.x + f.facing * 0.6,
        y: f.body.y + 1.0,
        vx: f.facing * 0.22,
        vy: 0,
        life: 30,
        dmg: m.dmg,
        baseKb: m.baseKb,
        growth: m.growth,
        angle: m.angle,
        facing: f.facing,
      });
      this.strEvents.push('pulse:' + f.id);
    },
    now: () => this.tick_,
    nearestOpponent: (f: Fighter) => this.nearestOpponent(f),
  };

  addFighter(f: Fighter, spawnIdx: number): void {
    f.reset(spawnIdx);
    f.softReset();
    this.fighters.push(f);
  }

  nearestOpponent(f: Fighter): Fighter | null {
    let best: Fighter | null = null;
    let bd = Infinity;
    for (const o of this.fighters) {
      if (o === f || !o.alive) continue;
      const d = Math.hypot(o.body.x - f.body.x, o.body.y - f.body.y);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  startCountdown(): void {
    this.status = 'countdown';
    this.countdownLeft = COUNTDOWN_SECONDS * TICK_HZ;
    let i = 0;
    for (const f of this.fighters) {
      f.softReset();
      f.reset(i++);
    }
  }

  tick(inputsById: Map<number, InputFrame>): void {
    this.events = [];
    this.strEvents = [];

    if (this.status === 'ended') {
      this.tick_++;
      return;
    }

    if (this.status === 'countdown') {
      this.countdownLeft--;
      if (this.countdownLeft <= 0) {
        this.status = 'live';
        this.strEvents.push('go');
      }
      this.tick_++;
      return;
    }

    // ---- live ----
    this.timeLeft--;

    for (const f of this.fighters) {
      if (!f.alive && f.state !== 'ko') continue;
      let input: InputFrame;
      if (f.isBot) {
        input = computeBot(f, this, this.botLevels.get(f.id) ?? 'medium');
      } else {
        input = inputsById.get(f.id) ?? emptyInput();
      }
      // bell buff bookkeeping
      if (this.stage.bellHolder === f.id) {
        f.damageDealtMult = BELL_DAMAGE_MULT;
        f.bellBuffLeft--;
        if (f.bellBuffLeft % (BELL_RING_EVERY_S * TICK_HZ) === 0) this.strEvents.push('bellRing:' + f.id);
        if (f.bellBuffLeft <= 0) {
          f.damageDealtMult = 1;
          this.stage.dropBell(this.tick_, this.strEvents);
        }
      } else {
        f.damageDealtMult = 1;
      }
      f.tick(input, this.stage, this.hooks);

      // reset combo if actionable and idle for a while handled loosely
    }

    // Bell pickup
    if (this.stage.bellActive) {
      for (const f of this.fighters) {
        if (!f.alive) continue;
        if (Math.hypot(f.body.x - 20, f.body.y - 7) < 1.0) {
          this.stage.takeBell(f.id, this.strEvents);
          f.bellBuffLeft = BELL_BUFF_S * TICK_HZ;
          f.damageDealtMult = BELL_DAMAGE_MULT;
          break;
        }
      }
    }

    // Combat
    const before = this.events.length;
    resolveCombat(this.fighters, this.stage, this.tick_, this.events, this.strEvents);
    // combo/parry/tile stat bookkeeping from events
    for (let i = before; i < this.events.length; i++) {
      const e = this.events[i];
      const atk = this.byId(e.a);
      const vic = this.byId(e.v);
      if (e.type === 'hit' && atk && vic) {
        atk.stat_combo++;
        atk.stat_bestCombo = Math.max(atk.stat_bestCombo, atk.stat_combo);
        vic.stat_combo = 0;
      }
      if (e.type === 'parry' && vic) vic.stat_parries++;
    }
    for (const s of this.strEvents) {
      if (s.startsWith('tileBreak')) {
        // credit most recent attacker loosely — handled where broken; skip
      }
    }

    // Projectiles
    this.tickProjectiles();

    // Stage clock
    this.stage.update(this.tick_, this.rng, this.strEvents);

    // Ring-outs
    const dead = checkRingouts(this.fighters, this.events);
    for (const f of dead) {
      // credit KO to whoever last struck this fighter
      const killer = f.lastHitBy >= 0 ? this.byId(f.lastHitBy) : this.recentAttackerOf(f.id);
      if (killer && killer !== f) killer.stat_kos++;
      f.lastHitBy = -1;
      f.stocks--;
      f.stat_combo = 0;
      if (f.stocks > 0) {
        f.reset(0); // respawn on top platform
      } else {
        f.state = 'ko';
        if (!this.deathOrder.includes(f.id)) this.deathOrder.push(f.id);
      }
    }

    // Win / timeout
    const living = this.fighters.filter((f) => f.stocks > 0);
    if (living.length <= 1 && this.fighters.length > 1) {
      this.endMatch();
    } else if (this.timeLeft <= 0) {
      this.endMatch();
    }

    this.tick_++;
  }

  private tickProjectiles(): void {
    const keep: Projectile[] = [];
    for (const p of this.projectiles) {
      p.x += p.vx;
      p.y += p.vy;
      p.life--;
      let consumed = false;
      // hit a fighter?
      for (const f of this.fighters) {
        if (f.id === p.owner || !f.alive || f.invuln > 0) continue;
        const hb = f.hurtbox();
        if (p.x > hb.x0 && p.x < hb.x1 && p.y > hb.y0 && p.y < hb.y1) {
          // parry/block reflect
          if (f.parrying || f.blocking) {
            p.vx *= -1;
            p.facing *= -1;
            p.owner = f.id;
            this.strEvents.push('pulseReflect:' + f.id);
          } else {
            f.applyKnockback(p.dmg, p.baseKb, p.growth, p.angle, p.facing, 1, f);
            f.lastHitBy = p.owner;
            const shooter = this.byId(p.owner);
            if (shooter) shooter.stat_dmgDealt += p.dmg;
            this.events.push({ type: 'hit', x: p.x, y: p.y, a: p.owner, v: f.id, dmg: p.dmg, kb: f.lastKb });
            consumed = true;
          }
          break;
        }
      }
      if (!consumed && p.life > 0 && p.x > BLAST.left && p.x < BLAST.right) keep.push(p);
    }
    this.projectiles = keep;
  }

  private byId(id?: number): Fighter | undefined {
    return id === undefined ? undefined : this.fighters.find((f) => f.id === id);
  }

  private recentAttackerOf(victimId: number): Fighter | undefined {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      if ((e.type === 'hit' || e.type === 'counter') && e.v === victimId) return this.byId(e.a);
    }
    // fall back: nearest other fighter
    return undefined;
  }

  private endMatch(): void {
    this.status = 'ended';
    // placement: living first (by stocks then least damage), then reverse death order
    const living = this.fighters.filter((f) => f.stocks > 0);
    living.sort((a, b) => (b.stocks - a.stocks) || (a.damage - b.damage));
    const deadByRecency = this.fighters
      .filter((f) => f.stocks <= 0)
      .sort((a, b) => this.deathOrder.indexOf(b.id) - this.deathOrder.indexOf(a.id));
    const ordered = [...living, ...deadByRecency];
    this.results = ordered.map((f, i) => ({
      id: f.id,
      name: f.name,
      place: i + 1,
      kos: f.stat_kos,
      dmgDealt: Math.round(f.stat_dmgDealt),
      parries: f.stat_parries,
      tiles: f.stat_tiles,
      bestCombo: f.stat_bestCombo,
    }));
    this.strEvents.push('matchEnd');
  }

  // Compact snapshot for the wire (server -> client) and for serialise/debug.
  serialize() {
    return {
      tick: this.tick_,
      status: this.status,
      countdown: Math.ceil(this.countdownLeft / TICK_HZ),
      timeLeft: Math.ceil(this.timeLeft / TICK_HZ),
      fighters: this.fighters.map((f) => ({
        id: f.id,
        x: +f.body.x.toFixed(3),
        y: +f.body.y.toFixed(3),
        vx: +f.body.vx.toFixed(3),
        vy: +f.body.vy.toFixed(3),
        facing: f.facing,
        state: f.state,
        move: f.move,
        moveFrame: f.moveFrame,
        dmg: Math.round(f.damage),
        stocks: f.stocks,
        invuln: f.invuln,
        hitstop: f.hitstop,
        blink: f.blinkCooldown,
        bell: f.bellBuffLeft > 0,
        speed: +Math.hypot(f.body.vx, f.body.vy).toFixed(3),
      })),
      projectiles: this.projectiles.map((p) => ({ id: p.id, x: +p.x.toFixed(2), y: +p.y.toFixed(2), owner: p.owner })),
      stage: {
        tiles: this.stage.tiles.map((t) => (t.gone ? 0 : t.hp) | (t.reforge > 0 ? 8 : 0)),
        pillars: this.stage.pillars.map((p) => (p.broken ? 0 : p.hp)),
        leftPlatY: this.stage.leftPlatY,
        rightPlatY: this.stage.rightPlatY,
        bellActive: this.stage.bellActive,
        bellHolder: this.stage.bellHolder,
        furnaceTiles: this.stage.furnaceWarnLeft > 0 ? this.stage.furnaceTiles : [],
      },
      events: this.events,
      str: this.strEvents,
      results: this.results,
    };
  }
}

export type Snapshot = ReturnType<World['serialize']>;
