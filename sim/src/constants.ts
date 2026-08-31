// FLICK FIGHT — every tunable number in one place.
// Richard and his son will spend their first evening in here. Each constant has
// a one-line note; change a value, restart local dev, feel the difference.

export const GAME_NAME = 'FLICK FIGHT'; // working title — change in one place

// ---- Simulation ----
export const TICK_HZ = 60; // fixed simulation rate
export const DT = 1 / TICK_HZ; // seconds per tick (physics uses per-frame units though)
export const SNAPSHOT_EVERY = 3; // broadcast a snapshot every Nth tick -> 20 Hz

// ---- World / units ----
export const PX_PER_UNIT = 32; // 1 world unit = 32 px at reference zoom
export const FIGHTER_W = 0.8; // hurtbox width (units)
export const FIGHTER_H = 1.8; // hurtbox height (units)

// ---- Movement (units per frame; accel per frame^2) ----
export const WALK_SPEED = 0.09;
export const RUN_SPEED = 0.16;
export const AIR_ACCEL = 0.012;
export const AIR_MAX = 0.14;
export const GROUND_ACCEL = 0.05; // how fast ground speed ramps toward target
export const GROUND_FRICTION = 0.06; // decel when no input on ground
export const GRAVITY = 0.012;
export const FAST_FALL = 0.035; // downward accel while fast-falling
export const TERMINAL = 0.45; // max fall speed
export const JUMP_VEL = 0.3;
export const DOUBLE_JUMP_VEL = 0.27;
export const JUMP_SQUAT = 3; // frames of crouch before leaving the ground
export const COYOTE_FRAMES = 5; // grace frames to still jump after leaving a ledge

// Ground dash
export const DASH_SPEED = 0.28;
export const DASH_FRAMES = 8;
export const DASH_RECOVERY = 4;
export const DASH_INVULN_START = 2; // invulnerable frames [start,end) of the dash
export const DASH_INVULN_END = 5;
// Air dash
export const AIR_DASH_SPEED = 0.24;
export const AIR_DASH_FRAMES = 6;
// Wall jump
export const WALLJUMP_X = 0.22;
export const WALLJUMP_Y = 0.26;

// ---- Combat feel ----
// Tuned down from the brief's 0.35 (see README "Decisions made during build"):
// at 0.35 a fresh hit launched ~3.5 u/f and crossed the open stage in a few
// frames — every clean hit was an instant KO. 0.085 gives Smash-style percent
// buildup: a fresh kick pops, a kick at 120% threatens the blast zone.
export const KB_TO_VEL = 0.085; // launch velocity per knockback point
export const HITSTUN_PER_KB = 0.5; // hitstun frames per knockback point
export const HITSTOP_BASE = 3; // freeze frames on hit = base + floor(dmg/3)
export const HITSTOP_MAX = 12;
export const SHAKE_MAX = 6; // max screen shake (px)
export const SHAKE_DECAY = 10; // frames to decay shake
export const INPUT_BUFFER = 6; // frames an action is buffered until legal
export const DI_MAX_DEG = 15; // directional influence: max launch-angle rotation

// Block / parry
export const BLOCK_STARTUP = 2;
export const BLOCK_RELEASE = 4; // recovery frames on release
export const BLOCKSTUN_EXTRA = 4; // attacker blockstun = move recovery + this
export const PARRY_WINDOW = 6; // block frames 1..PARRY_WINDOW parry
export const PARRY_ATTACKER_STUN = 24;

// Tech / wall
export const TECH_THRESHOLD = 0.18; // min speed into a surface to be allowed to tech
export const TECH_INPUT_WINDOW = 8; // frames a tech flick stays valid before impact
export const TECH_RECOVERY = 4;
export const WALLSPLAT_FRAMES = 22;
export const FLOOR_BOUNCE = 0.5; // velocity kept on a non-teched floor bounce

// Momentum multiplier: moving fast hits harder (heavies + specials, not jabs)
export const MOMENTUM_BONUS = 0.6; // mult = 1 + BONUS * clamp(speed/RUN_SPEED,0,1.5)
export const MOMENTUM_CLAMP = 1.5;
export const SPEEDLINES_AT = 1.5; // show speed lines when momentumMult exceeds this

// ---- Stocks / match ----
export const START_STOCKS = 3;
export const START_DAMAGE = 0;
export const MAX_DAMAGE = 999;
export const RESPAWN_FRAMES = 90;
export const RESPAWN_INVULN = 120; // invuln frames after respawn (ends on attack)
export const MATCH_SECONDS = 180; // 3-minute cap
export const COUNTDOWN_SECONDS = 3;

// ---- Blink special cooldown ----
export const BLINK_COOLDOWN = 90;
export const BLINK_DISTANCE = 3.5;

// ---- Bell pickup ----
export const BELL_FIRST_SPAWN_S = 20;
export const BELL_RESPAWN_S = 30;
export const BELL_BUFF_S = 10;
export const BELL_DAMAGE_MULT = 1.3;
export const BELL_RING_EVERY_S = 2;

// ---- Stage: tiles / pillars / furnace ----
export const TILE_HP = 3;
export const TILE_REGEN_S = 20;
export const TILE_REFORGE_FRAMES = 60;
export const PILLAR_HP = 2; // heavy hits to break
export const PILLAR_DROP_DELAY = 60; // frames after break before the platform drops
export const FURNACE_EVERY_S = 45;
export const FURNACE_WARN_FRAMES = 90;
export const FURNACE_OPEN_S = 6;

// Killing-blow cinematics
export const SLOWMO_FRAMES = 12;
export const SLOWMO_SCALE = 0.25;
export const KILL_ZOOM = 1.15;

// A generic per-move "spike near ledge" helper distance
export const LEDGE_SPIKE_MARGIN = 3;
