// LocalGame — runs the sim in-browser for offline modes (?local two-keyboard,
// and as the bot-fill engine). The server uses the same World; NetGame (net.ts)
// mirrors this shape so main.ts drives either the same way.

import { World, createWorld, type Snapshot, type InputFrame } from '@flickfight/sim';
import type { InputSource } from './input/types.ts';
import { endKeyboardFrame } from './input/keyboard.ts';
import type { PlayerMeta } from './render/renderer.ts';

export interface FighterSpec {
  id: number;
  name: string;
  face: string;
  color: number;
  isBot: boolean;
  botLevel?: 'easy' | 'medium' | 'hard';
}

export interface Game {
  isLocal: boolean;
  step(): void;
  snapshot(): Snapshot;
  meta: Map<number, PlayerMeta>;
  rematch(): void;
  localIds: number[];
}

export class LocalGame implements Game {
  isLocal = true;
  world: World;
  sources = new Map<number, InputSource>();
  meta = new Map<number, PlayerMeta>();
  private specs: FighterSpec[];
  private seed: number;
  localIds: number[] = [];

  constructor(seed: number, specs: FighterSpec[], sources: Map<number, InputSource>) {
    this.seed = seed;
    this.specs = specs;
    this.sources = sources;
    this.localIds = [...sources.keys()];
    this.world = createWorld(seed, specs);
    for (const s of specs) this.meta.set(s.id, { id: s.id, name: s.name, color: s.color, face: s.face });
  }

  step(): void {
    const inputs = new Map<number, InputFrame>();
    for (const [id, src] of this.sources) {
      const f = this.world.fighters.find((x) => x.id === id);
      inputs.set(id, src.poll(f?.facing ?? 1));
    }
    endKeyboardFrame();
    this.world.tick(inputs);
  }

  snapshot(): Snapshot {
    return this.world.serialize();
  }

  rematch(): void {
    this.world = createWorld(this.seed + this.world.tick_, this.specs);
  }
}
