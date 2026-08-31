// The input a fighter acts on each tick. The client recognises gestures
// (tap/flick/hold) and boils them down to this compact frame; the sim never
// sees raw touches. Buttons are edge-or-held booleans; the two sticks carry
// analog direction so DI, tech, and flick sectors work.

export interface InputFrame {
  // Movement stick (left thumb). Magnitude 0..1, angle via mx/my components.
  mx: number; // -1..1
  my: number; // -1..1 (up positive)
  // Discrete movement intents (edge-triggered by the recogniser)
  jump: boolean; // flick up
  dash: boolean; // flick sideways
  dashDir: number; // -1 left / +1 right (valid when dash true)
  fastFall: boolean; // flick down in air
  crouch: boolean; // hold down on ground

  // Combat stick (right thumb)
  jab: boolean; // tap
  heavy: boolean; // flick released -> heavy in sector
  heavyDir: Sector; // sector of the heavy
  block: boolean; // held
  special: boolean; // hold-then-flick
  specialDir: Sector;
  grab: boolean; // block + move-stick toward opponent
}

// 4 attack sectors, resolved from a flick angle. Forward/back are relative to
// the fighter's facing; up/down are absolute.
export type Sector = 'fwd' | 'back' | 'up' | 'down';

export function emptyInput(): InputFrame {
  return {
    mx: 0,
    my: 0,
    jump: false,
    dash: false,
    dashDir: 0,
    fastFall: false,
    crouch: false,
    jab: false,
    heavy: false,
    heavyDir: 'fwd',
    block: false,
    special: false,
    specialDir: 'fwd',
    grab: false,
  };
}

export function cloneInput(i: InputFrame): InputFrame {
  return { ...i };
}

// Resolve a flick vector into one of four sectors given the fighter facing
// (+1 right, -1 left). Screen convention: +x right, +y UP.
export function sectorFromVector(dx: number, dy: number, facing: number): Sector {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ay >= ax) {
    return dy >= 0 ? 'up' : 'down';
  }
  // horizontal: toward facing = fwd, away = back
  const towardFacing = dx * facing > 0;
  return towardFacing ? 'fwd' : 'back';
}
