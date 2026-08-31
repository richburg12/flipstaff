/* FLIPSTAFF sim — the whole game, headless. No DOM, no timers, no Math.random
   (the AI carries its own seeded rng). One step() = one 60 Hz frame.

   Forked-from-flickfight bones: fixed-tick fighter state machine, per-frame
   world units, AABB move-and-correct physics, hitstop-driven feel. Everything
   online is gone — two InputFrames in, one world out, same pathway for humans
   and the AI.

   World: a closed box. y is UP. Floor top surface at y=0, ceiling underside at
   y=AH. One small double-sided platform mid-arena. Each fighter has its own
   gravity sign g: +1 falls toward the floor, -1 falls toward the ceiling.
   The FLIP button inverts g for that fighter only — momentum carries, they arc
   across and land feet-first on the other surface. */

(function () {
  'use strict';

  // ---------- tuning (every number a human should touch lives here) ----------
  var C = {
    // arena
    AW: 16, // interior width (units)
    AH: 18, // floor-to-ceiling interior height
    FW: 0.9, // fighter hurtbox width
    FH: 2.0, // fighter hurtbox height
    PLAT: { x0: 5.75, y0: 8.7, x1: 10.25, y1: 9.3 }, // one double-sided platform, dead centre

    // movement (units per frame @60Hz)
    RUN: 0.13,
    GACC: 0.3, // ground accel lerp factor toward target speed
    AIRACC: 0.014,
    FRICTION: 0.045,
    GRAV: 0.032,
    TERM: 0.55,
    JUMP: 0.4,
    COYOTE: 5,

    // gravity flip — the signature move
    FLIP_CD: 60, // ~1 s between flips: no spam-hovering
    FLIP_ANIM: 13, // frames the somersault takes to visually re-orient

    // combat
    HP: 100,
    // QUICK is a wrist-snap of the staff's top half: the hitbox is only the
    // short frontal arc plane the tip sweeps — short range by design.
    QUICK: { startup: 4, active: 4, rec: 8, dmg: 7, ox: 1.0, w: 1.5, h: 1.6, nudge: 0.09 },
    // HEAVY is a regripped full overhead arc: hands slide to the butt end and
    // the far tip travels a big overhead plane — tall and long hitbox.
    HEAVY: { startup: 14, active: 6, hold: 21, rec: 6, dmg: 20, ox: 1.7, w: 2.7, h: 2.4, lunge: 0.2 },
    BLOCK_STARTUP: 4, // frames of down-hold before the block counts
    PB_QUICK: 0.16, // blocker slide-back per blocked quick
    PB_HEAVY: 0.9, // blocked HEAVY shoves the blocker far back — turtling loses ground
    KB_QUICK: { vx: 0.2, up: 0.1, stun: 14 },
    KB_HEAVY: { vx: 0.4, up: 0.2, stun: 26 },
    HITSTOP_QUICK: 6,
    HITSTOP_HEAVY: 10,

    // rounds / match
    ROUNDS_TO_WIN: 3, // best of 5
    INTRO_F: 90, // "ROUND N" freeze before FIGHT
    ROUNDEND_F: 130, // banner + crumple time after a KO
  };
  var HEAVY_TOTAL = C.HEAVY.startup + C.HEAVY.active + C.HEAVY.hold + C.HEAVY.rec;

  function emptyInput() {
    return { mx: 0, jump: false, block: false, quick: false, heavy: false, flip: false };
  }

  function upSign(f) {
    return f.g === 1 ? 1 : -1; // local "up" is opposite the pull
  }

  // ---------- fighter ----------
  function newFighter(i) {
    return {
      i: i,
      x: 0, y: 0, vx: 0, vy: 0,
      g: 1, // +1 falls to floor, -1 falls to ceiling
      facing: 1,
      hp: C.HP,
      state: 'idle', // idle|run|air|attack|block|hitstun|ko
      move: null, // 'quick' | 'heavy'
      mf: 0,
      hitDone: false,
      blockF: 0, // frames block has been held (>= BLOCK_STARTUP counts)
      hitstun: 0,
      hitstop: 0,
      koT: -1,
      grounded: true,
      coyote: 0,
      flipCd: 0,
      flipAnimT: 99, // frames since last flip (render somersault)
      flipDir: 1, // somersault spin direction
      // per-round bookkeeping for the shell
      lastHitT: -999,
    };
  }

  function spawn(f, roundNum) {
    // Each fighter starts on the surface nearest its OWN player's edge.
    // Fighter 0 = bottom player = floor; fighter 1 = top player = ceiling.
    var left = (roundNum % 2 === 0) === (f.i === 0);
    f.x = left ? C.AW * 0.28 : C.AW * 0.72;
    f.g = f.i === 0 ? 1 : -1;
    f.y = f.i === 0 ? C.FH / 2 : C.AH - C.FH / 2;
    f.vx = 0; f.vy = 0;
    f.hp = C.HP;
    f.state = 'idle'; f.move = null; f.mf = 0; f.hitDone = false;
    f.blockF = 0; f.hitstun = 0; f.hitstop = 0; f.koT = -1;
    f.grounded = true; f.coyote = C.COYOTE;
    f.flipCd = 0; f.flipAnimT = 99;
    f.facing = f.x < C.AW / 2 ? 1 : -1;
  }

  // ---------- physics: move-and-correct vs the closed box + platform ----------
  function physics(f) {
    var hw = C.FW / 2, hh = C.FH / 2, p = C.PLAT;
    f.grounded = false;

    // x axis
    f.x += f.vx;
    if (f.x < hw) { f.x = hw; f.vx = 0; }
    if (f.x > C.AW - hw) { f.x = C.AW - hw; f.vx = 0; }
    if (f.x + hw > p.x0 && f.x - hw < p.x1 && f.y + hh > p.y0 && f.y - hh < p.y1) {
      if (f.vx > 0) f.x = p.x0 - hw;
      else if (f.vx < 0) f.x = p.x1 + hw;
      f.vx = 0;
    }

    // y axis
    f.y += f.vy;
    if (f.y - hh < 0) { // floor
      f.y = hh; f.vy = 0;
      if (f.g === 1) f.grounded = true;
    }
    if (f.y + hh > C.AH) { // ceiling
      f.y = C.AH - hh; f.vy = 0;
      if (f.g === -1) f.grounded = true;
    }
    if (f.x + hw > p.x0 && f.x - hw < p.x1 && f.y + hh > p.y0 && f.y - hh < p.y1) {
      if (f.vy < 0) { // moving down: rest on platform top
        f.y = p.y1 + hh; f.vy = 0;
        if (f.g === 1) f.grounded = true;
      } else if (f.vy > 0) { // moving up: rest against platform underside
        f.y = p.y0 - hh; f.vy = 0;
        if (f.g === -1) f.grounded = true;
      }
    }
    // resting contact (vy == 0 exactly on a surface)
    if (!f.grounded && f.vy === 0) {
      if (f.g === 1 && (f.y - hh <= 1e-9 || (f.y - hh <= p.y1 + 1e-9 && f.y - hh >= p.y1 - 1e-6 && f.x + hw > p.x0 && f.x - hw < p.x1))) f.grounded = true;
      if (f.g === -1 && (f.y + hh >= C.AH - 1e-9 || (f.y + hh >= p.y0 - 1e-9 && f.y + hh <= p.y0 + 1e-6 && f.x + hw > p.x0 && f.x - hw < p.x1))) f.grounded = true;
    }
    if (f.grounded) f.coyote = C.COYOTE;
    else if (f.coyote > 0) f.coyote--;
  }

  function gravity(f) {
    if (f.g === 1) { f.vy -= C.GRAV; if (f.vy < -C.TERM) f.vy = -C.TERM; }
    else { f.vy += C.GRAV; if (f.vy > C.TERM) f.vy = C.TERM; }
  }

  function doFlip(f) {
    f.g = -f.g;
    f.flipCd = C.FLIP_CD;
    f.flipAnimT = 0;
    f.flipDir = f.vx !== 0 ? (f.vx > 0 ? 1 : -1) : f.facing;
    f.grounded = false;
    // momentum carries — vx, vy untouched. That's the Geometry Dash feel:
    // the world doesn't kick you, the pull just reverses and you arc.
  }

  function startMove(f, id) {
    f.move = id;
    f.mf = 0;
    f.hitDone = false;
    f.blockF = 0;
    f.state = 'attack';
    if (id === 'quick' && f.grounded) f.vx += f.facing * C.QUICK.nudge;
  }

  // ---------- per-fighter tick ----------
  function tickFighter(f, foe, inp) {
    f.flipAnimT++;
    if (f.state === 'ko') {
      f.koT++;
      gravity(f);
      f.vx *= 0.9;
      physics(f);
      return;
    }
    if (f.hitstop > 0) { f.hitstop--; return; } // frozen — impact frames
    if (f.flipCd > 0) f.flipCd--;

    if (f.hitstun > 0) {
      f.hitstun--;
      gravity(f);
      physics(f);
      if (f.hitstun === 0) f.state = f.grounded ? 'idle' : 'air';
      else f.state = 'hitstun';
      return;
    }

    // auto-face the opponent unless committed (attacking or blocking locks
    // facing — so flipping over a turtle and striking the back actually works)
    if (f.move === null && f.blockF === 0) {
      var dx = foe.x - f.x;
      if (Math.abs(dx) > 0.05) f.facing = dx > 0 ? 1 : -1;
    }

    // attack in progress
    if (f.move !== null) {
      f.mf++;
      var m = f.move === 'quick' ? C.QUICK : C.HEAVY;
      if (f.move === 'heavy') {
        if (f.mf <= C.HEAVY.startup) {
          f.vx *= 0.8; // gather
        } else if (f.mf <= C.HEAVY.startup + C.HEAVY.active) {
          f.vx = f.facing * C.HEAVY.lunge * (f.grounded ? 1 : 0.85); // the lunge
        } else {
          f.vx *= 0.7; // held finish pose — planted, open, vulnerable
        }
        if (f.mf >= HEAVY_TOTAL) { f.move = null; f.state = f.grounded ? 'idle' : 'air'; }
      } else {
        f.vx *= f.grounded ? 0.86 : 1;
        if (f.mf >= m.startup + m.active + m.rec) { f.move = null; f.state = f.grounded ? 'idle' : 'air'; }
      }
      if (!f.grounded) gravity(f);
      physics(f);
      return;
    }

    // block: pronounced down-hold, grounded only, locks you in place
    if (inp.block && f.grounded) {
      f.blockF++;
      f.state = 'block';
      f.vx *= 0.6; // blocked-hit pushback decays through this — the slide
      gravity(f);
      physics(f);
      return;
    }
    if (f.blockF > 0) f.blockF = 0; // released

    // gravity flip — allowed any time you're actionable, ground or air
    if (inp.flip && f.flipCd === 0) doFlip(f);

    // jump (in local up), with coyote grace
    if (inp.jump && (f.grounded || f.coyote > 0)) {
      f.vy = C.JUMP * upSign(f);
      f.grounded = false;
      f.coyote = 0;
    }

    // attacks
    if (inp.quick) { startMove(f, 'quick'); if (!f.grounded) gravity(f); physics(f); return; }
    if (inp.heavy) { startMove(f, 'heavy'); if (!f.grounded) gravity(f); physics(f); return; }

    // run / air drift
    if (f.grounded) {
      var target = Math.max(-1, Math.min(1, inp.mx)) * C.RUN;
      if (Math.abs(inp.mx) > 0.08) f.vx += (target - f.vx) * C.GACC;
      else if (Math.abs(f.vx) < C.FRICTION) f.vx = 0;
      else f.vx -= Math.sign(f.vx) * C.FRICTION;
    } else if (Math.abs(inp.mx) > 0.08) {
      f.vx += Math.sign(inp.mx) * C.AIRACC;
      var cap = C.RUN * 1.15;
      if (f.vx > cap) f.vx = cap;
      if (f.vx < -cap) f.vx = -cap;
    }

    gravity(f);
    physics(f);
    f.state = f.grounded ? (Math.abs(f.vx) > 0.02 ? 'run' : 'idle') : 'air';
  }

  // ---------- hit resolution ----------
  function activeHitbox(f) {
    if (f.move === null) return null;
    var m = f.move === 'quick' ? C.QUICK : C.HEAVY;
    if (f.mf <= m.startup || f.mf > m.startup + m.active) return null;
    var cx = f.x + f.facing * m.ox;
    return { x0: cx - m.w / 2, y0: f.y - m.h / 2, x1: cx + m.w / 2, y1: f.y + m.h / 2, m: m, id: f.move };
  }

  function hurtbox(f) {
    return { x0: f.x - C.FW / 2, y0: f.y - C.FH / 2, x1: f.x + C.FW / 2, y1: f.y + C.FH / 2 };
  }

  function overlap(a, b) {
    return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  }

  function resolveHits(game) {
    var ev = [];
    for (var a = 0; a < 2; a++) {
      var atk = game.fighters[a];
      var vic = game.fighters[1 - a];
      if (atk.hitstop > 0) continue; // no new hits while frozen
      var hb = activeHitbox(atk);
      if (!hb || atk.hitDone) continue;
      if (vic.state === 'ko') continue;
      if (!overlap(hb, hurtbox(vic))) continue;

      atk.hitDone = true;
      var dxa = atk.x - vic.x;
      var frontal = dxa === 0 ? true : (dxa > 0 ? 1 : -1) === vic.facing;
      var away = dxa === 0 ? -atk.facing : (dxa > 0 ? -1 : 1); // push victim away from attacker
      var heavy = hb.id === 'heavy';

      if (vic.blockF >= C.BLOCK_STARTUP && frontal && vic.grounded) {
        // BLOCKED: no damage, blocker slides back (a lot, if it was a heavy)
        vic.vx = away * (heavy ? C.PB_HEAVY : C.PB_QUICK);
        vic.lastHitT = game.tick;
        ev.push({ type: 'block', x: (atk.x + vic.x) / 2, y: vic.y, heavy: heavy, victim: vic.i });
        continue;
      }

      // CLEAN HIT (behind-block hits land here too)
      var kb = heavy ? C.KB_HEAVY : C.KB_QUICK;
      vic.hp -= hb.m.dmg;
      vic.vx = away * kb.vx;
      vic.vy = kb.up * upSign(vic); // pop in the victim's own "up"
      vic.hitstun = kb.stun;
      vic.state = 'hitstun';
      vic.move = null;
      vic.blockF = 0;
      vic.lastHitT = game.tick;
      var stop = heavy ? C.HITSTOP_HEAVY : C.HITSTOP_QUICK;
      vic.hitstop = stop;
      atk.hitstop = stop;
      ev.push({ type: 'hit', x: (atk.x + vic.x) / 2, y: vic.y, heavy: heavy, dmg: hb.m.dmg, victim: vic.i });

      if (vic.hp <= 0 && game.screen === 'fight') {
        vic.hp = 0;
        vic.state = 'ko';
        vic.koT = 0;
        vic.hitstun = 0;
        game.wins[atk.i]++;
        game.screen = 'roundend';
        game.roundEndT = 0;
        game.roundWinner = atk.i;
        ev.push({ type: 'ko', x: vic.x, y: vic.y, victim: vic.i });
      }
    }
    return ev;
  }

  // ---------- game ----------
  function createGame() {
    var game = {
      tick: 0,
      screen: 'intro', // intro | fight | roundend | over
      roundNum: 0, // 0-based
      introT: 0,
      roundEndT: 0,
      roundWinner: -1,
      winner: -1,
      wins: [0, 0],
      fighters: [newFighter(0), newFighter(1)],
      events: [], // impact events from the last step (shell reads these)
    };
    spawn(game.fighters[0], 0);
    spawn(game.fighters[1], 0);
    return game;
  }

  function resetMatch(game) {
    game.tick = 0;
    game.screen = 'intro';
    game.roundNum = 0;
    game.introT = 0;
    game.roundEndT = 0;
    game.roundWinner = -1;
    game.winner = -1;
    game.wins = [0, 0];
    spawn(game.fighters[0], 0);
    spawn(game.fighters[1], 0);
    game.events = [];
  }

  var IDLE = emptyInput();

  function step(game, inputs) {
    game.tick++;
    game.events = [];
    var i0 = inputs && inputs[0] ? inputs[0] : IDLE;
    var i1 = inputs && inputs[1] ? inputs[1] : IDLE;
    var f0 = game.fighters[0], f1 = game.fighters[1];

    switch (game.screen) {
      case 'intro':
        game.introT++;
        if (game.introT >= C.INTRO_F) game.screen = 'fight';
        break;
      case 'fight':
        tickFighter(f0, f1, i0);
        tickFighter(f1, f0, i1);
        game.events = resolveHits(game);
        break;
      case 'roundend':
        // loser crumples, winner settles; no inputs, no hits
        tickFighter(f0, f1, IDLE);
        tickFighter(f1, f0, IDLE);
        game.roundEndT++;
        if (game.roundEndT >= C.ROUNDEND_F) {
          if (game.wins[game.roundWinner] >= C.ROUNDS_TO_WIN) {
            game.screen = 'over';
            game.winner = game.roundWinner;
          } else {
            game.roundNum++;
            game.introT = 0;
            game.screen = 'intro';
            spawn(f0, game.roundNum);
            spawn(f1, game.roundNum);
          }
        }
        break;
      case 'over':
        break;
    }
    return game.events;
  }

  // ---------- AI (drives fighter 1 through the same InputFrame pathway) ----------
  // Honest opponent: sees the world through a ~180 ms delay buffer, decides a
  // few times a second, sometimes blocks, sometimes flips, punishes held heavy
  // poses imperfectly, and makes genuine mistakes. It cannot poke sim state —
  // its only output is an InputFrame.
  function mulberry(seed) {
    var s = seed >>> 0;
    return function () {
      s |= 0; s = (s + 0x6d2b79f5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var AI = {
    REACT: 11, // frames of perception delay (~180 ms)
    DECIDE_MIN: 22, // frames between decisions
    DECIDE_VAR: 26,
    MISTAKE: 0.08, // fraction of decisions that are just wrong
    BLOCK_REACT: 0.35, // odds it answers a seen heavy with block
    FLIP_EVADE: 0.25, // odds it answers a seen heavy with a gravity flip
    PUNISH: 0.8, // odds it actually takes the pose-hold punish
  };

  function createAI(seed) {
    return {
      rng: mulberry(seed || 12345),
      hist: [],
      decideT: 20,
      mx: 0,
      moveT: 0, // frames left to keep current mx
      blockT: 0,
      threatSeen: false,
    };
  }

  function aiInput(game, ai) {
    var inp = emptyInput();
    var me = game.fighters[1], foe = game.fighters[0];

    // perception delay: act on where the foe WAS
    ai.hist.push({ x: foe.x, y: foe.y, g: foe.g, move: foe.move, mf: foe.mf });
    var seen = ai.hist.length > AI.REACT ? ai.hist.shift() : ai.hist[0];

    if (game.screen !== 'fight') { ai.hist.length = 0; return inp; }
    if (me.state === 'ko' || me.hitstun > 0 || me.move !== null) return inp;

    var r = ai.rng;
    var dx = seen.x - me.x;
    var adx = Math.abs(dx);
    var vdist = Math.abs(seen.y - me.y);
    var engaged = vdist < 2.8; // close enough vertically to trade hits
    var toward = dx > 0 ? 1 : -1;

    if (ai.blockT > 0) { ai.blockT--; inp.block = true; return inp; }

    // react to a seen heavy: block, flip away, back off — or freeze (mistake)
    var heavyThreat = engaged && adx < 3.6 && seen.move === 'heavy' &&
      seen.mf <= C.HEAVY.startup + C.HEAVY.active;
    if (heavyThreat && !ai.threatSeen) {
      ai.threatSeen = true;
      var t = r();
      if (t < AI.BLOCK_REACT) { ai.blockT = 30; inp.block = true; return inp; }
      else if (t < AI.BLOCK_REACT + AI.FLIP_EVADE && me.flipCd === 0) { inp.flip = true; return inp; }
      else if (t < 0.85) { ai.mx = -toward; ai.moveT = 18; }
      // else: caught flat-footed
    }
    if (seen.move !== 'heavy') ai.threatSeen = false;

    // the punish loop: foe is holding the heavy finish pose — run in and hit
    var poseHold = engaged && seen.move === 'heavy' &&
      seen.mf > C.HEAVY.startup + C.HEAVY.active && seen.mf < HEAVY_TOTAL - 4;
    if (poseHold && adx < 4.2) {
      ai.mx = toward; ai.moveT = 10;
      if (adx < 2.1 && r() < AI.PUNISH) {
        if (r() < 0.35) inp.heavy = true; else inp.quick = true;
        ai.moveT = 0; ai.mx = 0;
      }
      inp.mx = ai.mx;
      return inp;
    }

    // periodic decisions
    ai.decideT--;
    if (ai.decideT <= 0) {
      ai.decideT = AI.DECIDE_MIN + Math.floor(r() * AI.DECIDE_VAR);
      var roll = r();
      if (roll < AI.MISTAKE) {
        // genuine mistake: wander the wrong way or stall
        ai.mx = r() < 0.5 ? 0 : (r() < 0.5 ? 1 : -1);
        ai.moveT = 20;
      } else if (!engaged) {
        // foe is on the other surface: line up and flip over to them
        if (adx < 2.4 && me.flipCd === 0 && r() < 0.55) inp.flip = true;
        else { ai.mx = toward; ai.moveT = 26; }
        if (r() < 0.06 && me.flipCd === 0) inp.flip = true; // the occasional stylish flip
      } else if (adx < 2.0) {
        // in range: mostly quick, sometimes heavy, sometimes turtle or step out
        var a2 = r();
        if (a2 < 0.48) inp.quick = true;
        else if (a2 < 0.62) inp.heavy = true;
        else if (a2 < 0.74) { ai.blockT = 26; inp.block = true; }
        else if (a2 < 0.9) { ai.mx = -toward; ai.moveT = 14; }
        // else stand and watch (human-ish)
      } else if (adx < 3.0) {
        // spacing band: poke heavy occasionally (this is where it whiffs)
        if (r() < 0.22) inp.heavy = true;
        else { ai.mx = toward; ai.moveT = 22; }
        if (r() < 0.07) inp.jump = true;
      } else {
        ai.mx = toward; ai.moveT = 30;
        if (r() < 0.05) inp.jump = true;
      }
    }

    if (ai.moveT > 0) { ai.moveT--; inp.mx = ai.mx; }
    return inp;
  }

  var SIM = {
    C: C,
    HEAVY_TOTAL: HEAVY_TOTAL,
    AI: AI,
    emptyInput: emptyInput,
    createGame: createGame,
    resetMatch: resetMatch,
    step: step,
    createAI: createAI,
    aiInput: aiInput,
    activeHitbox: activeHitbox,
    upSign: upSign,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SIM;
  if (typeof window !== 'undefined') window.SIM = SIM;
})();
