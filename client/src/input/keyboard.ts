// Keyboard input — the desktop testing path (must be complete). Two mappings so
// two people can fight on one keyboard for solo dev testing (?local=1).
//
// Edge-triggered actions (jab, heavy flicks, jump, dash, special) fire for one
// frame on keydown; held actions (block, crouch, movement) read live key state.

import { emptyInput, sectorFromVector, type InputFrame, type Sector } from '@flickfight/sim';
import type { InputSource } from './types.ts';

export interface KeyMap {
  left: string;
  right: string;
  up: string; // jump
  down: string; // crouch / fast-fall
  run: string; // modifier (may be '')
  dashL: string;
  dashR: string;
  jab: string;
  block: string; // held
  atkUp: string;
  atkDown: string;
  atkLeft: string;
  atkRight: string;
}

export const P1_KEYS: KeyMap = {
  left: 'KeyA',
  right: 'KeyD',
  up: 'KeyW',
  down: 'KeyS',
  run: 'ShiftLeft',
  dashL: 'KeyQ',
  dashR: 'KeyE',
  jab: 'KeyJ',
  block: 'KeyK',
  atkUp: 'ArrowUp',
  atkDown: 'ArrowDown',
  atkLeft: 'ArrowLeft',
  atkRight: 'ArrowRight',
};

// P2 on the numpad for local two-player.
export const P2_KEYS: KeyMap = {
  left: 'Numpad4',
  right: 'Numpad6',
  up: 'Numpad8',
  down: 'Numpad5',
  run: 'Numpad7',
  dashL: 'Numpad1',
  dashR: 'Numpad3',
  jab: 'Numpad0',
  block: 'NumpadDecimal',
  atkUp: 'KeyI',
  atkDown: 'KeyK', // note: overlaps; P2 attack cluster on IJKL is optional
  atkLeft: 'KeyJ',
  atkRight: 'KeyL',
};

// A single shared key state so multiple sources read one keyboard.
const held = new Set<string>();
const edges: string[] = []; // keydown events since last drain, per-source tracked below
let listening = false;

function ensureListening() {
  if (listening) return;
  listening = true;
  window.addEventListener('keydown', (e) => {
    if (!e.repeat) edges.push(e.code);
    held.add(e.code);
    // stop browser scrolling on arrows/space
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  });
  window.addEventListener('keyup', (e) => held.delete(e.code));
  window.addEventListener('blur', () => held.clear());
}

export class KeyboardSource implements InputSource {
  private map: KeyMap;
  constructor(map: KeyMap) {
    this.map = map;
    ensureListening();
  }

  // This frame's keydown edges. Every source reads them all and filters by its
  // own keymap; endKeyboardFrame() clears the batch after all have polled.
  private freshEdges(): string[] {
    return edges;
  }

  poll(facing: number): InputFrame {
    const m = this.map;
    const i = emptyInput();
    const down = (code: string) => code !== '' && held.has(code);

    // movement (analog from held keys)
    const run = down(m.run);
    if (down(m.left)) i.mx = run ? -1 : -0.49;
    if (down(m.right)) i.mx = run ? 1 : 0.49;
    if (down(m.down)) {
      i.crouch = true;
      i.fastFall = true;
    }

    const e = this.freshEdges();
    for (const code of e) {
      if (code === m.up) i.jump = true;
      else if (code === m.dashL) {
        i.dash = true;
        i.dashDir = -1;
      } else if (code === m.dashR) {
        i.dash = true;
        i.dashDir = 1;
      } else if (code === m.jab) i.jab = true;
      else if (code === m.atkUp) setAttack(i, 'up', down(m.block), facing);
      else if (code === m.atkDown) setAttack(i, 'down', down(m.block), facing);
      else if (code === m.atkLeft) setAttack(i, sectorFromVector(-1, 0, facing), down(m.block), facing);
      else if (code === m.atkRight) setAttack(i, sectorFromVector(1, 0, facing), down(m.block), facing);
    }

    // block held
    if (down(m.block)) i.block = true;

    // grab: block + left/right (toward opponent) — fire while blocking and a dir edge
    if (down(m.block) && (down(m.left) || down(m.right))) {
      i.grab = true;
      i.mx = down(m.left) ? -0.6 : 0.6;
    }

    return i;
  }

  destroy(): void {
    /* shared listeners persist for the session */
  }
}

function setAttack(i: InputFrame, sector: Sector, blocking: boolean, _facing: number): void {
  if (blocking) {
    i.special = true;
    i.specialDir = sector;
  } else {
    i.heavy = true;
    i.heavyDir = sector;
  }
}

// Call once per frame AFTER all sources have polled, to clear the edge batch.
export function endKeyboardFrame(): void {
  edges.length = 0;
}
