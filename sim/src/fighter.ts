// The Fighter state machine. One tick = one 60 Hz frame. Reads an InputFrame,
// drives movement + attacks + defence, and advances physics. Hit *resolution*
// (who hits whom) lives in hit.ts / world.ts; this file owns a fighter's own
// state, its active hitbox, and how it reacts when struck.

import {
  WALK_SPEED,
  RUN_SPEED,
  AIR_ACCEL,
  AIR_MAX,
  GROUND_ACCEL,
  GROUND_FRICTION,
  GRAVITY,
  FAST_FALL,
  TERMINAL,
  JUMP_VEL,
  DOUBLE_JUMP_VEL,
  JUMP_SQUAT,
  COYOTE_FRAMES,
  DASH_SPEED,
  DASH_FRAMES,
  DASH_RECOVERY,
  DASH_INVULN_START,
  DASH_INVULN_END,
  AIR_DASH_SPEED,
  AIR_DASH_FRAMES,
  WALLJUMP_X,
  WALLJUMP_Y,
  KB_TO_VEL,
  HITSTUN_PER_KB,
  DI_MAX_DEG,
  BLOCK_STARTUP,
  BLOCK_RELEASE,
  PARRY_WINDOW,
  PARRY_ATTACKER_STUN,
  TECH_THRESHOLD,
  TECH_INPUT_WINDOW,
  TECH_RECOVERY,
  WALLSPLAT_FRAMES,
  FLOOR_BOUNCE,
  MOMENTUM_BONUS,
  MOMENTUM_CLAMP,
  INPUT_BUFFER,
  START_STOCKS,
  START_DAMAGE,
  MAX_DAMAGE,
  RESPAWN_FRAMES,
  RESPAWN_INVULN,
  BLINK_COOLDOWN,
  BLINK_DISTANCE,
  FIGHTER_W,
  FIGHTER_H,
} from './constants.ts';
import { MOVES, THROW_ANGLE, type MoveDef, type MoveId } from './moves.ts';
import { emptyInput, type InputFrame, type Sector } from './input.ts';
import { newBody, stepBody, type Body, type CollisionFlags } from './physics.ts';
import type { Stage, AABB } from './stage.ts';
import { SPAWN_POINTS } from './stage.ts';

export type FighterState =
  | 'idle'
  | 'walk'
  | 'run'
  | 'crouch'
  | 'jumpsquat'
  | 'air'
  | 'dash'
  | 'airdash'
  | 'attack'
  | 'block'
  | 'parry'
  | 'grab'
  | 'grabhold'
  | 'grabbed'
  | 'throw'
  | 'hitstun'
  | 'wallsplat'
  | 'helpless'
  | 'tech'
  | 'respawn'
  | 'ko';

export interface WorldHooks {
  spawnPulse(f: Fighter): void;
  now(): number;
  // find nearest living opponent to a fighter (for grab direction / bots)
  nearestOpponent(f: Fighter): Fighter | null;
}

export class Fighter {
  id: number;
  isBot: boolean;
  name: string;
  face: string; // opaque doodle payload (drawn client-side)
  color: number; // body colour index

  body: Body;
  facing: number = 1; // +1 right, -1 left
  state: FighterState = 'idle';
  stateFrame = 0;

  // combat
  move: MoveId | null = null;
  moveFrame = 0;
  momentumMult = 1;
  hitThisMove: Set<number> = new Set(); // victim ids already hit by current move instance
  tileHitThisMove: Set<number> = new Set(); // tiles already damaged by this move
  pillarHitThisMove = false;
  blockstun = 0; // frames locked out after our strike was blocked
  jabStage = 0; // 0 none, 1 after jab1, 2 after jab2
  jabLinkTimer = 0;

  // defence
  blockFrame = 0; // frames blocking (for parry window)
  grabTarget: Fighter | null = null;
  grabHoldTimer = 0;
  counterActive = false; // set while a Counter special's window is live
  counterAbsorbed: { dmg: number; kb: number; angle: number } | null = null;

  // status
  damage = START_DAMAGE;
  stocks = START_STOCKS;
  hitstun = 0;
  hitstop = 0;
  invuln = 0;
  jumps = 0; // remaining air jumps
  usedAirDash = false;
  helplessUntilLand = false;
  blinkCooldown = 0;
  wallsplatTimer = 0;
  landClear = false; // aerial has landed; finish the move next tick (see tickAttack)
  techFlickTimer = 0; // frames since a tech flick toward a surface
  techDir = 0; // -1 left / +1 right / 0 none / 2 up / -2 down encoded loosely
  fastFalling = false;
  respawnTimer = 0;

  // knockback bookkeeping (for kill prediction/effects)
  lastKb = 0;
  lastHitBy = -1; // id of whoever last struck us — for KO credit on ring-out
  facingLockedByMove = false;

  // bell buff + match stats
  damageDealtMult = 1; // 1.3 while holding the bell
  bellBuffLeft = 0; // frames of bell buff remaining
  stat_dmgDealt = 0;
  stat_kos = 0;
  stat_parries = 0;
  stat_tiles = 0;
  stat_combo = 0; // current combo count
  stat_bestCombo = 0;

  input: InputFrame = emptyInput();
  buffer: { input: InputFrame; life: number } | null = null;
  botMemory: Record<string, number> = {};

  cf: CollisionFlags | null = null;

  constructor(id: number, name: string, face: string, color: number, isBot = false) {
    this.id = id;
    this.name = name;
    this.face = face;
    this.color = color;
    this.isBot = isBot;
    this.body = newBody(20, 15);
  }

  get grounded(): boolean {
    return this.cf?.grounded ?? false;
  }

  get alive(): boolean {
    return this.stocks > 0 && this.state !== 'ko';
  }

  get actionable(): boolean {
    return (
      this.hitstun === 0 &&
      this.hitstop === 0 &&
      this.state !== 'respawn' &&
      this.state !== 'ko' &&
      this.state !== 'wallsplat' &&
      this.state !== 'helpless' &&
      this.state !== 'parry' &&
      this.state !== 'tech' &&
      !(this.state === 'attack') &&
      !(this.state === 'grab') &&
      !(this.state === 'grabhold') &&
      !(this.state === 'throw') &&
      !(this.state === 'dash') &&
      !(this.state === 'airdash')
    );
  }

  reset(spawnIdx: number): void {
    const sp = SPAWN_POINTS[spawnIdx % SPAWN_POINTS.length];
    this.body = newBody(sp.x, sp.y + 0.01);
    this.state = 'respawn';
    this.stateFrame = 0;
    this.move = null;
    this.hitstun = 0;
    this.hitstop = 0;
    this.invuln = RESPAWN_INVULN;
    this.jumps = 1;
    this.usedAirDash = false;
    this.helplessUntilLand = false;
    this.fastFalling = false;
    this.respawnTimer = 0;
  }

  softReset(): void {
    // full match reset (rematch / start)
    this.damage = START_DAMAGE;
    this.stocks = START_STOCKS;
    this.blinkCooldown = 0;
  }

  // ---- main tick ----
  tick(input: InputFrame, stage: Stage, hooks: WorldHooks): void {
    this.input = input;

    if (this.hitstop > 0) {
      this.hitstop--;
      return; // frozen — everything else keeps moving
    }
    if (this.blockstun > 0) {
      // locked out after our attack was blocked; gravity + physics only
      this.blockstun--;
      if (!this.grounded) this.applyGravity();
      this.doPhysics(stage, false);
      if (this.blockstun === 0) this.toGroundOrAir();
      return;
    }
    if (this.blinkCooldown > 0) this.blinkCooldown--;
    if (this.invuln > 0) this.invuln--;
    if (this.techFlickTimer > 0) this.techFlickTimer--;

    // Track tech intent: a movement-stick flick toward a surface arms teching.
    this.trackTechIntent(input);

    // buffer decay
    if (this.buffer) {
      this.buffer.life--;
      if (this.buffer.life <= 0) this.buffer = null;
    }

    switch (this.state) {
      case 'ko':
        return;
      case 'respawn':
        this.tickRespawn(input, stage);
        return;
      case 'hitstun':
        this.tickHitstun(input, stage, hooks);
        return;
      case 'wallsplat':
        this.tickWallsplat(stage);
        return;
      case 'helpless':
        this.tickHelpless(input, stage);
        return;
      case 'tech':
        this.stateFrame++;
        this.applyGravity();
        this.doPhysics(stage, false);
        if (this.stateFrame >= TECH_RECOVERY) this.toGroundOrAir();
        return;
      case 'parry':
        this.stateFrame++;
        this.doPhysics(stage, false);
        if (this.stateFrame >= 1) this.toGroundOrAir(); // parry gives immediate free action
        return;
      case 'attack':
      case 'throw':
        this.tickAttack(input, stage, hooks);
        return;
      case 'grab':
        this.tickGrab(input, stage, hooks);
        return;
      case 'grabhold':
        this.tickGrabHold(input, stage, hooks);
        return;
      case 'grabbed':
        // held by another fighter — do nothing; the grabber pins our position
        // and will throw or release us. Safety: if the grabber is gone, break free.
        if (!this.grabbedBy || this.grabbedBy.grabTarget !== this) {
          this.grabbedBy = null;
          this.toGroundOrAir();
        }
        return;
      case 'dash':
      case 'airdash':
        this.tickDash(stage);
        return;
      case 'jumpsquat':
        this.tickJumpsquat(input, stage);
        return;
      case 'block':
        this.tickBlock(input, stage, hooks);
        return;
      default:
        this.tickFree(input, stage, hooks);
    }
  }

  // ---- free movement / action state (idle/walk/run/air/crouch) ----
  private tickFree(input: InputFrame, stage: Stage, hooks: WorldHooks): void {
    const onGround = this.grounded;

    // Try to start an action (buffered). Highest priority: block, then attacks.
    if (this.tryStartAction(input, stage, hooks)) return;

    // facing from movement stick if not attacking
    if (Math.abs(input.mx) > 0.2 && onGround) this.facing = input.mx > 0 ? 1 : -1;

    // Jump (flick up) with coyote/double jump
    if (input.jump) {
      if (onGround || this.coyote > 0) {
        this.state = 'jumpsquat';
        this.stateFrame = 0;
        return;
      } else if (this.jumps > 0) {
        this.jumps--;
        this.body.vy = DOUBLE_JUMP_VEL;
        this.fastFalling = false;
      }
    }

    // Dash (flick sideways)
    if (input.dash) {
      if (onGround) {
        this.state = 'dash';
        this.stateFrame = 0;
        this.facing = input.dashDir >= 0 ? 1 : -1;
        this.body.vx = DASH_SPEED * this.facing;
        return;
      } else if (!this.usedAirDash) {
        this.usedAirDash = true;
        this.state = 'airdash';
        this.stateFrame = 0;
        const dir = input.dashDir >= 0 ? 1 : -1;
        this.facing = dir;
        this.body.vx = AIR_DASH_SPEED * dir;
        this.body.vy = 0;
        return;
      }
    }

    // Wall jump
    if (input.jump && !onGround && (this.cf?.wallLeft || this.cf?.wallRight)) {
      const away = this.cf?.wallLeft ? 1 : -1;
      this.body.vx = WALLJUMP_X * away;
      this.body.vy = WALLJUMP_Y;
      this.facing = away;
    }

    // Horizontal movement
    if (onGround) {
      const running = Math.abs(input.mx) >= 0.5;
      const target = input.mx * (running ? RUN_SPEED : WALK_SPEED);
      if (Math.abs(input.mx) > 0.1) {
        this.body.vx += (target - this.body.vx) * GROUND_ACCEL * 6;
      } else {
        // friction
        if (Math.abs(this.body.vx) < GROUND_FRICTION) this.body.vx = 0;
        else this.body.vx -= Math.sign(this.body.vx) * GROUND_FRICTION;
      }
    } else {
      // air control
      if (Math.abs(input.mx) > 0.1) {
        this.body.vx += Math.sign(input.mx) * AIR_ACCEL;
        this.body.vx = clamp(this.body.vx, -AIR_MAX * 2, AIR_MAX * 2);
        if (Math.abs(this.body.vx) > AIR_MAX && Math.sign(this.body.vx) === Math.sign(input.mx)) {
          // allow keeping momentum from dashes but cap gentle air accel target
        }
      }
    }

    // Fast fall / crouch
    if (!onGround && input.fastFall) this.fastFalling = true;
    const dropThrough = onGround && input.crouch;

    // Gravity
    this.applyGravity();

    // Physics
    this.doPhysics(stage, dropThrough);

    // Landing resets
    if (this.grounded) {
      this.jumps = 1;
      this.usedAirDash = false;
      this.fastFalling = false;
      if (this.helplessUntilLand) this.helplessUntilLand = false;
    }

    // Choose visible state
    if (this.grounded) {
      if (input.crouch) this.state = 'crouch';
      else if (Math.abs(this.body.vx) >= RUN_SPEED * 0.8) this.state = 'run';
      else if (Math.abs(this.body.vx) > 0.02) this.state = 'walk';
      else this.state = 'idle';
    } else {
      this.state = 'air';
    }
  }

  private get coyote(): number {
    // simple coyote: allow jump shortly after leaving ground
    return this.airFrames <= COYOTE_FRAMES && this.airFrames > 0 && this.jumps >= 1 ? 1 : 0;
  }
  private airFrames = 0;

  private applyGravity(): void {
    const g = this.fastFalling ? FAST_FALL : GRAVITY;
    this.body.vy -= g;
    if (this.body.vy < -TERMINAL) this.body.vy = -TERMINAL;
  }

  private doPhysics(stage: Stage, dropThrough: boolean): void {
    const wasGround = this.grounded;
    this.cf = stepBody(this.body, stage, dropThrough);
    if (this.grounded) this.airFrames = 0;
    else this.airFrames++;
    void wasGround;
  }

  private toGroundOrAir(): void {
    this.state = this.grounded ? 'idle' : 'air';
    this.stateFrame = 0;
  }

  // ---- action start (attacks / block / grab / special) ----
  private tryStartAction(input: InputFrame, stage: Stage, hooks: WorldHooks): boolean {
    // Grab: block held-context handled in block state; here handle direct grab
    // request (block + move toward opponent) if currently able.
    if (input.grab && this.grounded) {
      this.startMove('grab');
      return true;
    }
    if (input.block && this.grounded) {
      this.state = 'block';
      this.stateFrame = 0;
      this.blockFrame = 0;
      return true;
    }
    if (input.special) {
      this.startSpecial(input.specialDir, hooks);
      return true;
    }
    if (input.heavy) {
      this.startHeavy(input.heavyDir);
      return true;
    }
    if (input.jab) {
      this.startJab();
      return true;
    }
    return false;
  }

  private startJab(): void {
    let id: MoveId = 'jab1';
    if (this.jabStage === 1 && this.jabLinkTimer > 0) id = 'jab2';
    else if (this.jabStage === 2 && this.jabLinkTimer > 0) id = 'jab3';
    this.startMove(id);
  }

  private startHeavy(dir: Sector): void {
    const air = !this.grounded;
    let id: MoveId;
    if (air) {
      id = dir === 'up' ? 'uair' : dir === 'down' ? 'dive' : dir === 'back' ? 'bair' : 'fair';
    } else {
      id = dir === 'up' ? 'launcher' : dir === 'down' ? 'sweep' : dir === 'back' ? 'bkick' : 'fkick';
    }
    this.startMove(id);
  }

  private startSpecial(dir: Sector, hooks: WorldHooks): void {
    let id: MoveId;
    if (dir === 'up') id = 'uppercut';
    else if (dir === 'down') id = 'counter';
    else if (dir === 'back') id = 'blink';
    else id = 'pulse';
    if (id === 'blink') {
      if (this.blinkCooldown > 0) {
        // on cooldown -> no move
        return;
      }
    }
    this.startMove(id);
    void hooks;
  }

  private startMove(id: MoveId): void {
    const m = MOVES[id];
    this.state = id === 'grab' ? 'grab' : 'attack';
    this.move = id;
    this.moveFrame = 0;
    this.hitThisMove.clear();
    this.tileHitThisMove.clear();
    this.pillarHitThisMove = false;
    this.momentumMult = 1;
    this.counterActive = false;
    this.landClear = false;
    this.facingLockedByMove = true;
    if (m.turnsAround) this.facing *= -1;
    // stop most horizontal movement on ground startup (aerials keep momentum)
    if (!m.aerial && this.grounded) this.body.vx *= 0.3;
  }

  // ---- attack progression ----
  private jabBuffered = false;
  private tickAttack(input: InputFrame, stage: Stage, hooks: WorldHooks): void {
    const m = MOVES[this.move!];
    this.moveFrame++;
    // buffer a jab pressed during a jab's active/recovery so mashing links
    if (this.move && this.move.startsWith('jab') && input.jab && this.moveFrame > m.startup) {
      this.jabBuffered = true;
    }

    // momentum locked at first active frame
    if (this.moveFrame === m.startup + 1) {
      const speed = Math.hypot(this.body.vx, this.body.vy);
      this.momentumMult = m.isHeavy || m.isSpecial ? 1 + MOMENTUM_BONUS * clamp(speed / RUN_SPEED, 0, MOMENTUM_CLAMP) : 1;
      if (this.move === 'pulse') hooks.spawnPulse(this);
      if (this.move === 'blink') this.doBlink(stage, hooks);
      if (this.move === 'uppercut') this.body.vy = 0.38;
    }
    if (this.move === 'counter') {
      this.counterActive = this.moveFrame > m.startup && this.moveFrame <= m.startup + m.active;
    }
    // dive travels down at 45 deg until landing
    if (this.move === 'dive') {
      const sp = 0.34 * (1 + MOMENTUM_BONUS * clamp(Math.hypot(this.body.vx, this.body.vy) / RUN_SPEED, 0, MOMENTUM_CLAMP) * 0.4);
      this.body.vx = this.facing * sp * Math.SQRT1_2;
      this.body.vy = -sp * Math.SQRT1_2;
    } else if (m.aerial) {
      this.applyGravity();
    } else if (this.move === 'uppercut') {
      // rising during active
      this.body.vy -= GRAVITY * 0.5;
    } else {
      // grounded attacks: slight friction
      this.body.vx *= 0.85;
      if (!this.grounded) this.applyGravity();
    }

    this.doPhysics(stage, false);

    // End of move
    const total = m.startup + m.active + m.recovery;
    const aerialLanded = m.aerial && this.grounded && this.moveFrame > m.startup;
    if (aerialLanded) {
      // Keep the move (and its hitbox) live for THIS world tick so hit
      // resolution — which runs after all fighters advance — still sees the
      // landing frame. Without this the dive's tile-break on landing (its whole
      // point) is lost. Finish on the next tick.
      if (this.landClear) {
        this.state = 'idle';
        this.move = null;
        this.facingLockedByMove = false;
        this.jabStage = 0;
        this.landClear = false;
        return;
      }
      this.landClear = true;
      this.body.vx *= 0.3;
      return;
    }
    if (this.moveFrame >= total) {
      // jab links
      const wasJab = this.move === 'jab1' || this.move === 'jab2';
      if (this.move === 'jab1') {
        this.jabStage = 1;
        this.jabLinkTimer = 12;
      } else if (this.move === 'jab2') {
        this.jabStage = 2;
        this.jabLinkTimer = 12;
      } else {
        this.jabStage = 0;
      }
      // buffered jab -> chain immediately into the next jab
      if (wasJab && this.jabBuffered) {
        this.jabBuffered = false;
        this.move = null;
        this.facingLockedByMove = false;
        this.startJab();
        return;
      }
      this.jabBuffered = false;
      if (this.move === 'uppercut') {
        this.state = 'helpless';
        this.helplessUntilLand = true;
        this.move = null;
        this.stateFrame = 0;
        return;
      }
      this.move = null;
      this.facingLockedByMove = false;
      this.toGroundOrAir();
    }
    if (this.jabLinkTimer > 0) this.jabLinkTimer--;
  }

  private doBlink(stage: Stage, hooks: WorldHooks): void {
    this.blinkCooldown = BLINK_COOLDOWN;
    const dir = -this.facing; // teleport backward
    let nx = this.body.x + dir * BLINK_DISTANCE;
    // stop at walls/edges: clamp within main play area
    nx = clamp(nx, -3, 43);
    this.body.x = nx;
    this.body.vx = 0;
    this.invuln = Math.max(this.invuln, 8);
    void stage;
    void hooks;
  }

  // ---- grab / throw ----
  private tickGrab(input: InputFrame, stage: Stage, hooks: WorldHooks): void {
    const m = MOVES.grab;
    this.moveFrame++;
    this.body.vx *= 0.8;
    this.applyGroundGravity(stage);
    // active frames: try to catch nearest opponent in range
    if (this.moveFrame > m.startup && this.moveFrame <= m.startup + m.active && !this.grabTarget) {
      const opp = hooks.nearestOpponent(this);
      if (opp && !opp.invuln && this.inGrabRange(opp)) {
        this.grabTarget = opp;
        opp.getGrabbed(this);
        this.state = 'grabhold';
        this.grabHoldTimer = 0;
        this.moveFrame = 0;
        return;
      }
    }
    if (this.moveFrame >= m.startup + m.active + m.recovery) {
      this.move = null;
      this.toGroundOrAir();
    }
  }

  private tickGrabHold(input: InputFrame, stage: Stage, hooks: WorldHooks): void {
    this.grabHoldTimer++;
    this.body.vx = 0;
    this.applyGroundGravity(stage);
    const opp = this.grabTarget;
    if (!opp || !opp.alive) {
      this.releaseGrab();
      return;
    }
    // pin opponent beside us
    opp.body.x = this.body.x + this.facing * 0.7;
    opp.body.y = this.body.y;
    opp.body.vx = 0;
    opp.body.vy = 0;
    // throw on flick, or auto forward after 30f
    let dir: Sector | null = null;
    if (input.heavy) dir = input.heavyDir;
    else if (Math.hypot(input.mx, input.my) > 0.6) {
      const ax = Math.abs(input.mx), ay = Math.abs(input.my);
      dir = ay > ax ? (input.my > 0 ? 'up' : 'down') : input.mx * this.facing > 0 ? 'fwd' : 'back';
    } else if (this.grabHoldTimer >= 30) dir = 'fwd';
    if (dir) this.doThrow(dir, hooks);
  }

  private doThrow(dir: Sector, hooks: WorldHooks): void {
    const opp = this.grabTarget!;
    const t = MOVES.throw;
    const angle = THROW_ANGLE[dir] ?? 35;
    opp.applyKnockback(t.dmg, t.baseKb, t.growth, angle, this.facing, 1, this);
    opp.state = 'hitstun';
    this.releaseGrab();
    this.state = 'throw';
    this.move = 'throw';
    this.moveFrame = MOVES.throw.startup; // recovery only
    void hooks;
  }

  private releaseGrab(): void {
    if (this.grabTarget) {
      this.grabTarget.grabbedBy = null;
      if (this.grabTarget.state === 'grabbed') this.grabTarget.state = this.grabTarget.grounded ? 'idle' : 'air';
    }
    this.grabTarget = null;
    this.state = 'idle';
  }

  grabbedBy: Fighter | null = null;
  getGrabbed(by: Fighter): void {
    this.grabbedBy = by;
    this.state = 'grabbed';
    this.move = null;
    this.hitstun = 0;
  }

  private inGrabRange(opp: Fighter): boolean {
    const dx = opp.body.x - this.body.x;
    return dx * this.facing > -0.2 && Math.abs(dx) <= 1.0 && Math.abs(opp.body.y - this.body.y) < 1.2;
  }

  private applyGroundGravity(stage: Stage): void {
    if (!this.grounded) this.applyGravity();
    this.doPhysics(stage, false);
  }

  // ---- block / parry ----
  private tickBlock(input: InputFrame, stage: Stage, hooks: WorldHooks): void {
    this.blockFrame++;
    this.body.vx *= 0.6;
    this.applyGroundGravity(stage);
    // grab out of block: flick move stick toward opponent
    if (input.grab) {
      this.startMove('grab');
      return;
    }
    // hold-then-flick special
    if (input.special && this.blockFrame >= 9) {
      this.startSpecial(input.specialDir, hooks);
      return;
    }
    if (!input.block) {
      // release: short recovery then free
      this.state = 'idle';
      this.stateFrame = 0;
    }
  }

  get parrying(): boolean {
    return this.state === 'block' && this.blockFrame >= 1 && this.blockFrame <= PARRY_WINDOW;
  }
  get blocking(): boolean {
    return this.state === 'block' && this.blockFrame >= BLOCK_STARTUP;
  }

  // ---- hitstun / tech / wall ----
  private tickHitstun(input: InputFrame, stage: Stage, hooks: WorldHooks): void {
    this.hitstun--;
    this.applyGravity();
    this.doPhysics(stage, false);
    // tech on surface contact
    if (this.cf) {
      const intoWall = (this.cf.wallLeft || this.cf.wallRight) && this.cf.hitWallSpeed >= TECH_THRESHOLD;
      const intoFloor = this.cf.grounded && this.cf.hitFloorSpeed >= TECH_THRESHOLD;
      if (intoWall || intoFloor) {
        if (this.techFlickTimer > 0) {
          this.state = 'tech';
          this.stateFrame = 0;
          this.hitstun = 0;
          this.body.vx = 0;
          this.body.vy = 0;
          if (intoWall) this.jumps = Math.max(this.jumps, 1); // wall tech grants a jump
          return;
        }
        // wall-splat / floor-bounce
        if (intoWall) {
          this.state = 'wallsplat';
          this.wallsplatTimer = WALLSPLAT_FRAMES;
          this.body.vx = 0;
          this.body.vy = 0;
          return;
        }
        if (intoFloor) {
          this.body.vy = this.cf.hitFloorSpeed * FLOOR_BOUNCE;
        }
      }
    }
    if (this.hitstun <= 0) {
      this.toGroundOrAir();
    }
    void input;
    void hooks;
  }

  private tickWallsplat(stage: Stage): void {
    this.wallsplatTimer--;
    // pinned; slight slide near end
    if (this.wallsplatTimer <= 6) {
      this.applyGravity();
      this.doPhysics(stage, false);
    }
    if (this.wallsplatTimer <= 0) this.toGroundOrAir();
  }

  private tickHelpless(input: InputFrame, stage: Stage): void {
    this.applyGravity();
    // minimal air drift
    if (Math.abs(input.mx) > 0.1) this.body.vx += Math.sign(input.mx) * AIR_ACCEL * 0.4;
    this.doPhysics(stage, false);
    if (this.grounded) {
      this.helplessUntilLand = false;
      this.toGroundOrAir();
    }
  }

  private tickRespawn(input: InputFrame, stage: Stage): void {
    this.respawnTimer++;
    this.body.vx = 0;
    this.body.vy = 0;
    // hover on respawn platform; drop when any attack pressed or timer done
    const anyAction = input.jab || input.heavy || input.special || input.jump || Math.abs(input.mx) > 0.3;
    if (this.respawnTimer >= RESPAWN_FRAMES || anyAction) {
      this.state = 'idle';
      this.stateFrame = 0;
      if (anyAction && this.respawnTimer < RESPAWN_FRAMES) {
        // early drop keeps some invuln but shortened
        this.invuln = Math.min(this.invuln, 40);
      }
    }
    void stage;
  }

  private tickDash(stage: Stage): void {
    this.stateFrame++;
    const isAir = this.state === 'airdash';
    const frames = isAir ? AIR_DASH_FRAMES : DASH_FRAMES;
    if (!isAir && this.stateFrame >= DASH_INVULN_START && this.stateFrame < DASH_INVULN_END) {
      this.invuln = Math.max(this.invuln, 1);
    }
    if (isAir) this.applyGravity();
    this.doPhysics(stage, false);
    if (this.stateFrame >= frames + (isAir ? 0 : DASH_RECOVERY)) {
      this.body.vx *= 0.5;
      this.toGroundOrAir();
    }
  }

  private tickJumpsquat(input: InputFrame, stage: Stage): void {
    this.stateFrame++;
    this.doPhysics(stage, false);
    if (this.stateFrame >= JUMP_SQUAT) {
      this.body.vy = JUMP_VEL;
      this.jumps = 1;
      this.fastFalling = false;
      this.state = 'air';
      this.stateFrame = 0;
    }
    void input;
  }

  private trackTechIntent(input: InputFrame): void {
    // A movement-stick push toward a wall/floor arms teching for a window.
    if (Math.hypot(input.mx, input.my) > 0.6) {
      this.techFlickTimer = TECH_INPUT_WINDOW;
    }
  }

  // ---- being hit ----
  // Returns 'hit' | 'blocked' | 'parried' | 'grabbed-immune' | 'counter'
  onStruck(attacker: Fighter, m: MoveDef, fromBehind: boolean): 'hit' | 'blocked' | 'parried' | 'counter' | 'immune' {
    if (this.invuln > 0 || this.state === 'respawn' || this.state === 'ko') return 'immune';

    // Counter special absorbs
    if (this.counterActive) {
      this.counterAbsorbed = { dmg: m.dmg, kb: m.baseKb, angle: m.angle };
      return 'counter';
    }

    // Parry window
    if (this.parrying && !fromBehind) {
      this.state = 'parry';
      this.stateFrame = 0;
      attacker.getParried();
      return 'parried';
    }
    // Block (not from behind, not a grab)
    if (this.blocking && !fromBehind) {
      return 'blocked';
    }
    return 'hit';
  }

  getParried(): void {
    this.state = 'helpless'; // stumble ~ use hitstun-like lock
    this.hitstun = PARRY_ATTACKER_STUN;
    this.state = 'hitstun';
    this.move = null;
    this.body.vx = -this.facing * 0.05;
  }

  applyKnockback(dmg: number, baseKb: number, growth: number, angleDeg: number, attackerFacing: number, mult: number, attacker: Fighter): void {
    this.damage = clamp(this.damage + dmg * mult, 0, MAX_DAMAGE);
    let kb = (baseKb + this.damage * growth) * mult;
    // DI: rotate angle up to ±15° toward the movement stick
    let angle = angleDeg;
    const stickMag = Math.hypot(this.input.mx, this.input.my);
    if (stickMag > 0.2) {
      const stickAngle = Math.atan2(this.input.my, this.input.mx) * (180 / Math.PI);
      // convert move angle (relative facing) to world angle
      const worldAngle = attackerFacing >= 0 ? angleDeg : 180 - angleDeg;
      let diff = ((stickAngle - worldAngle + 540) % 360) - 180;
      const applied = clamp(diff, -DI_MAX_DEG, DI_MAX_DEG);
      angle = worldAngle + applied;
      const rad = (angle * Math.PI) / 180;
      this.body.vx = Math.cos(rad) * kb * KB_TO_VEL;
      this.body.vy = Math.sin(rad) * kb * KB_TO_VEL;
    } else {
      const worldAngle = attackerFacing >= 0 ? angleDeg : 180 - angleDeg;
      const rad = (worldAngle * Math.PI) / 180;
      this.body.vx = Math.cos(rad) * kb * KB_TO_VEL;
      this.body.vy = Math.sin(rad) * kb * KB_TO_VEL;
    }
    this.lastKb = kb;
    if (attacker && attacker.id !== this.id) this.lastHitBy = attacker.id;
    this.hitstun = Math.max(this.hitstun, Math.floor(kb * HITSTUN_PER_KB));
    this.state = 'hitstun';
    this.move = null;
    this.grabTarget = null;
    if (this.grabbedBy) {
      this.grabbedBy.grabTarget = null;
      this.grabbedBy = null;
    }
    void attacker;
  }

  // world-space hitbox of the current move on its active frames (or null)
  activeHitbox(): AABB | null {
    if ((this.state !== 'attack' && this.state !== 'throw') || !this.move) return null;
    const m = MOVES[this.move];
    if (!m.hitbox) return null;
    if (this.moveFrame <= m.startup || this.moveFrame > m.startup + m.active) return null;
    const hb = m.hitbox;
    const cx = this.body.x + this.facing * hb.x;
    const cy = this.body.y + hb.y;
    return { x0: cx - hb.w / 2, y0: cy - hb.h / 2, x1: cx + hb.w / 2, y1: cy + hb.h / 2 };
  }

  hurtbox(): AABB {
    return { x0: this.body.x - FIGHTER_W / 2, y0: this.body.y, x1: this.body.x + FIGHTER_W / 2, y1: this.body.y + FIGHTER_H };
  }
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
