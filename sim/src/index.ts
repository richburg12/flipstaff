// Public surface of the shared simulation. Both the server and the client
// import from here.

export * from './constants.ts';
export * from './input.ts';
export * from './moves.ts';
export * from './rng.ts';
export * from './physics.ts';
export * from './stage.ts';
export * from './fighter.ts';
export * from './hit.ts';
export * from './bot.ts';
export * from './world.ts';

import { World } from './world.ts';
import { Fighter } from './fighter.ts';

// Convenience: build a world with N fighters (humans + bots) and start it.
export interface FighterSpec {
  id: number;
  name: string;
  face: string;
  color: number;
  isBot: boolean;
  botLevel?: 'easy' | 'medium' | 'hard';
}

export function createWorld(seed: number, specs: FighterSpec[]): World {
  const w = new World(seed);
  let i = 0;
  for (const s of specs) {
    const f = new Fighter(s.id, s.name, s.face, s.color, s.isBot);
    if (s.isBot) w.botLevels.set(s.id, s.botLevel ?? 'medium');
    w.addFighter(f, i++);
  }
  w.startCountdown();
  return w;
}
