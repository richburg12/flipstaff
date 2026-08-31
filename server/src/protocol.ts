// Wire protocol (server side). Mirrors client/src/proto.ts. Includes the
// InputFrame (un)packer so the room loop can feed compact wire inputs to the sim.

import { emptyInput, type InputFrame, type Sector, type Snapshot } from '@flickfight/sim';

export interface PlayerInfo {
  id: number;
  name: string;
  color: number;
  face: string;
  isBot: boolean;
  ready: boolean;
  botLevel?: 'easy' | 'medium' | 'hard';
}

export type ServerMessage =
  | { type: 'roomState'; code: string; players: PlayerInfo[]; hostId: number; status: string; yourId: number }
  | { type: 'start'; seed: number }
  | { type: 'snapshot'; snap: Snapshot; ackSeq: number }
  | { type: 'error'; msg: string };

export interface CompactInput {
  b: number;
  mx: number;
  my: number;
  hd: number;
  sd: number;
  dd: number;
}

export type ClientMessage =
  | { type: 'create'; name: string; color: number; face: string }
  | { type: 'join'; code: string; name: string; color: number; face: string }
  | { type: 'input'; seq: number; frame: CompactInput }
  | { type: 'ready'; ready: boolean }
  | { type: 'addBot'; level: 'easy' | 'medium' | 'hard' }
  | { type: 'removeBot' }
  | { type: 'start' }
  | { type: 'rematch' }
  | { type: 'leave' };

const SECTORS: Sector[] = ['fwd', 'back', 'up', 'down'];

export function unpackInput(c: CompactInput): InputFrame {
  const i = emptyInput();
  i.jump = (c.b & 1) !== 0;
  i.dash = (c.b & 2) !== 0;
  i.fastFall = (c.b & 4) !== 0;
  i.crouch = (c.b & 8) !== 0;
  i.jab = (c.b & 16) !== 0;
  i.heavy = (c.b & 32) !== 0;
  i.block = (c.b & 64) !== 0;
  i.special = (c.b & 128) !== 0;
  i.grab = (c.b & 256) !== 0;
  i.mx = c.mx;
  i.my = c.my;
  i.heavyDir = SECTORS[c.hd] ?? 'fwd';
  i.specialDir = SECTORS[c.sd] ?? 'fwd';
  i.dashDir = c.dd;
  return i;
}
