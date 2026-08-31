// Wire protocol (JSON over WebSocket). Kept in sync with server/src/protocol.ts
// — these are erased TS types; the JSON message shapes are the real contract.

import type { Snapshot } from '@flickfight/sim';

export interface PlayerInfo {
  id: number;
  name: string;
  color: number;
  face: string;
  isBot: boolean;
  ready: boolean;
  botLevel?: 'easy' | 'medium' | 'hard';
}

export interface RoomStateMsg {
  type: 'roomState';
  code: string;
  players: PlayerInfo[];
  hostId: number;
  status: 'lobby' | 'countdown' | 'live' | 'ended';
  yourId: number;
}

export type ServerMessage =
  | RoomStateMsg
  | { type: 'start'; seed: number }
  | { type: 'snapshot'; snap: Snapshot; ackSeq: number }
  | { type: 'error'; msg: string };

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

// Compact input bitfield + stick angles for the wire.
export interface CompactInput {
  b: number; // bitfield
  mx: number;
  my: number;
  hd: number; // heavy sector 0..3
  sd: number; // special sector 0..3
  dd: number; // dash dir
}
