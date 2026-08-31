// Frame data — the whole fight lives here. Angles in degrees: 0 = toward the
// attacker's facing, 90 = straight up, 270 = straight down. Hitboxes are in
// units relative to the fighter's centre-bottom origin, x positive = in front
// of facing (mirrored automatically for a left-facing fighter).

export type MoveId =
  | 'jab1'
  | 'jab2'
  | 'jab3'
  | 'fkick'
  | 'bkick'
  | 'launcher'
  | 'sweep'
  | 'fair'
  | 'bair'
  | 'uair'
  | 'dive'
  | 'grab'
  | 'throw'
  | 'pulse'
  | 'uppercut'
  | 'counter'
  | 'blink';

export interface Hitbox {
  x: number; // forward offset from fighter centre (units)
  y: number; // up offset from fighter feet (units)
  w: number;
  h: number;
}

export interface MoveDef {
  id: MoveId;
  startup: number;
  active: number;
  recovery: number; // "land" recovery for aerials handled in fighter logic
  dmg: number;
  baseKb: number;
  growth: number;
  angle: number; // launch angle, degrees (relative to facing for x)
  hitbox?: Hitbox;
  aerial?: boolean;
  isHeavy?: boolean; // momentum multiplier applies
  isSpecial?: boolean;
  spike?: boolean;
  breaksTile?: boolean;
  turnsAround?: boolean;
  landingRecovery?: number; // aerials: recovery frames after landing
}

// Reference hitbox in front of the fighter roughly at chest height.
const front = (x: number, y: number, w: number, h: number): Hitbox => ({ x, y, w, h });

export const MOVES: Record<MoveId, MoveDef> = {
  jab1: { id: 'jab1', startup: 3, active: 3, recovery: 7, dmg: 2, baseKb: 3, growth: 0.02, angle: 40, hitbox: front(0.55, 1.1, 0.7, 0.5) },
  jab2: { id: 'jab2', startup: 3, active: 3, recovery: 8, dmg: 2, baseKb: 3, growth: 0.02, angle: 40, hitbox: front(0.6, 1.1, 0.75, 0.5) },
  jab3: { id: 'jab3', startup: 5, active: 3, recovery: 14, dmg: 4, baseKb: 7, growth: 0.06, angle: 45, hitbox: front(0.7, 1.0, 0.85, 0.7) },

  fkick: { id: 'fkick', startup: 7, active: 4, recovery: 14, dmg: 9, baseKb: 10, growth: 0.1, angle: 35, isHeavy: true, hitbox: front(0.85, 0.7, 1.0, 0.6) },
  bkick: { id: 'bkick', startup: 9, active: 4, recovery: 15, dmg: 11, baseKb: 12, growth: 0.11, angle: 30, isHeavy: true, turnsAround: true, hitbox: front(0.9, 0.9, 1.0, 0.7) },
  launcher: { id: 'launcher', startup: 6, active: 4, recovery: 16, dmg: 8, baseKb: 12, growth: 0.09, angle: 82, isHeavy: true, hitbox: front(0.4, 1.4, 0.9, 0.9) },
  sweep: { id: 'sweep', startup: 6, active: 5, recovery: 18, dmg: 6, baseKb: 6, growth: 0.05, angle: 60, isHeavy: true, hitbox: front(0.7, 0.25, 1.1, 0.4) },

  fair: { id: 'fair', startup: 6, active: 5, recovery: 10, dmg: 8, baseKb: 9, growth: 0.09, angle: 40, aerial: true, isHeavy: true, landingRecovery: 10, hitbox: front(0.75, 1.0, 0.9, 0.7) },
  bair: { id: 'bair', startup: 8, active: 4, recovery: 12, dmg: 10, baseKb: 11, growth: 0.1, angle: 25, aerial: true, isHeavy: true, turnsAround: true, landingRecovery: 12, hitbox: front(0.85, 1.0, 0.95, 0.7) },
  uair: { id: 'uair', startup: 5, active: 5, recovery: 10, dmg: 7, baseKb: 8, growth: 0.08, angle: 88, aerial: true, isHeavy: true, landingRecovery: 10, hitbox: front(0.1, 1.7, 0.9, 0.8) },
  dive: { id: 'dive', startup: 6, active: 40, recovery: 12, dmg: 10, baseKb: 11, growth: 0.11, angle: 275, aerial: true, isHeavy: true, spike: true, breaksTile: true, landingRecovery: 12, hitbox: front(0.2, 0.4, 0.9, 0.9) },

  grab: { id: 'grab', startup: 6, active: 2, recovery: 20, dmg: 0, baseKb: 0, growth: 0, angle: 0, hitbox: front(0.6, 0.9, 0.6, 0.9) },
  throw: { id: 'throw', startup: 8, active: 1, recovery: 10, dmg: 7, baseKb: 11, growth: 0.09, angle: 35 },

  pulse: { id: 'pulse', startup: 12, active: 30, recovery: 14, dmg: 5, baseKb: 8, growth: 0.06, angle: 35, isSpecial: true },
  uppercut: { id: 'uppercut', startup: 4, active: 12, recovery: 20, dmg: 7, baseKb: 13, growth: 0.1, angle: 85, isSpecial: true, isHeavy: true, hitbox: front(0.4, 0.8, 0.8, 1.3) },
  counter: { id: 'counter', startup: 3, active: 18, recovery: 26, dmg: 1.5, baseKb: 1.3, growth: 0, angle: 45, isSpecial: true },
  blink: { id: 'blink', startup: 2, active: 8, recovery: 10, dmg: 0, baseKb: 0, growth: 0, angle: 0, isSpecial: true },
};

// Throw angles by direction (relative to facing; up/down absolute).
export const THROW_ANGLE: Record<string, number> = { fwd: 35, back: 145, up: 88, down: 270 };

export function totalFrames(m: MoveDef): number {
  return m.startup + m.active + m.recovery;
}
