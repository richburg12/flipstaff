import type { InputFrame } from '@flickfight/sim';

// A source of input for one local fighter. poll() returns the InputFrame for
// the current frame; it's given the fighter's facing so flick directions can be
// resolved into fwd/back sectors. Edge-triggered actions (jab, flicks, jump)
// fire for exactly one frame and then clear.
export interface InputSource {
  poll(facing: number): InputFrame;
  destroy(): void;
}
