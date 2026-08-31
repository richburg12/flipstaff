// Rooms: one Room per 4-letter code, each owning a World and its clients. The
// Room runs the authoritative 60 Hz loop, feeds the latest input per human into
// world.tick(), and broadcasts a snapshot every 3rd tick (20 Hz). Bots fill
// empty slots and are driven inside the sim.

import type { WebSocket } from 'ws';
import { World, createWorld, emptyInput, type InputFrame, type FighterSpec } from '@flickfight/sim';
import { unpackInput, type ClientMessage, type PlayerInfo, type ServerMessage } from './protocol.ts';

const TICK_MS = 1000 / 60;
const SNAPSHOT_EVERY = 3;
const MAX_SLOTS = 4;
const CODE_CHARS = 'ABCDEFGHJKLMNPRSTUVWXYZ'; // no ambiguous I O Q
const BOT_NAMES = ['BOT-ZAP', 'BOT-KRUNCH', 'BOT-VOLT', 'BOT-HEX'];

interface Client {
  id: number;
  socket: WebSocket;
  info: PlayerInfo;
  lastInput: InputFrame;
  ackSeq: number;
}

export class Room {
  code: string;
  hostId = -1;
  clients = new Map<number, Client>(); // humans only
  bots: PlayerInfo[] = [];
  world: World | null = null;
  status: 'lobby' | 'countdown' | 'live' | 'ended' = 'lobby';
  private loop: NodeJS.Timeout | null = null;
  private tickN = 0;
  private emptySince = 0;
  onEmpty?: () => void;

  constructor(code: string) {
    this.code = code;
  }

  private freeSlot(): number {
    const used = new Set<number>([...this.clients.keys(), ...this.bots.map((b) => b.id)]);
    for (let i = 0; i < MAX_SLOTS; i++) if (!used.has(i)) return i;
    return -1;
  }

  addHuman(socket: WebSocket, name: string, color: number, face: string): number | null {
    const id = this.freeSlot();
    if (id < 0) return null;
    const info: PlayerInfo = { id, name: name.slice(0, 10) || 'PLAYER', color, face, isBot: false, ready: false };
    this.clients.set(id, { id, socket, info, lastInput: emptyInput(), ackSeq: 0 });
    if (this.hostId < 0) this.hostId = id;
    this.broadcastState();
    return id;
  }

  addBot(level: 'easy' | 'medium' | 'hard'): void {
    const id = this.freeSlot();
    if (id < 0) return;
    this.bots.push({ id, name: BOT_NAMES[id % BOT_NAMES.length], color: id, face: '', isBot: true, ready: true, botLevel: level });
    this.broadcastState();
  }

  removeBot(): void {
    if (this.bots.length === 0) return;
    this.bots.pop();
    this.broadcastState();
  }

  setReady(id: number, ready: boolean): void {
    const c = this.clients.get(id);
    if (c) {
      c.info.ready = ready;
      this.broadcastState();
    }
  }

  handle(id: number, msg: ClientMessage): void {
    const c = this.clients.get(id);
    switch (msg.type) {
      case 'input':
        if (c) {
          c.lastInput = unpackInput(msg.frame);
          c.ackSeq = msg.seq;
        }
        break;
      case 'ready':
        this.setReady(id, msg.ready);
        break;
      case 'addBot':
        if (id === this.hostId) this.addBot(msg.level);
        break;
      case 'removeBot':
        if (id === this.hostId) this.removeBot();
        break;
      case 'start':
        if (id === this.hostId) this.startMatch();
        break;
      case 'rematch':
        if (id === this.hostId) this.startMatch();
        break;
    }
  }

  private specs(): FighterSpec[] {
    const specs: FighterSpec[] = [];
    for (const c of this.clients.values()) specs.push({ id: c.id, name: c.info.name, face: c.info.face, color: c.info.color, isBot: false });
    for (const b of this.bots) specs.push({ id: b.id, name: b.name, face: b.face, color: b.color, isBot: true, botLevel: b.botLevel });
    specs.sort((a, b) => a.id - b.id);
    return specs;
  }

  startMatch(): void {
    const specs = this.specs();
    if (specs.length < 1) return;
    const seed = (Date.now() ^ (this.tickN << 8)) >>> 0;
    this.world = createWorld(seed, specs);
    this.status = 'live';
    this.tickN = 0;
    this.send({ type: 'start', seed });
    this.broadcastState();
    if (!this.loop) this.loop = setInterval(() => this.step(), TICK_MS);
  }

  private step(): void {
    if (this.status !== 'live' || !this.world) return;
    const inputs = new Map<number, InputFrame>();
    for (const c of this.clients.values()) inputs.set(c.id, c.lastInput);
    this.world.tick(inputs);
    this.tickN++;

    if (this.tickN % SNAPSHOT_EVERY === 0) {
      const snap = this.world.serialize();
      // send with each client's own ack
      for (const c of this.clients.values()) {
        this.sendTo(c, { type: 'snapshot', snap, ackSeq: c.ackSeq });
      }
    }
    if (this.world.status === 'ended') {
      this.status = 'ended';
      if (this.loop) {
        clearInterval(this.loop);
        this.loop = null;
      }
      // final snapshot carries results
      const snap = this.world.serialize();
      this.send({ type: 'snapshot', snap, ackSeq: 0 });
      this.broadcastState();
    }
  }

  removeHuman(id: number): void {
    this.clients.delete(id);
    if (this.world) {
      const f = this.world.fighters.find((x) => x.id === id);
      if (f) f.stocks = 0; // forfeit
    }
    if (id === this.hostId) {
      const next = [...this.clients.keys()][0];
      this.hostId = next ?? -1;
    }
    if (this.clients.size === 0) {
      this.emptySince = Date.now();
      if (this.loop) {
        clearInterval(this.loop);
        this.loop = null;
      }
    }
    this.broadcastState();
  }

  isEmpty(): boolean {
    return this.clients.size === 0;
  }
  emptyDurationMs(): number {
    return this.clients.size === 0 ? Date.now() - this.emptySince : 0;
  }

  private players(): PlayerInfo[] {
    return [...[...this.clients.values()].map((c) => c.info), ...this.bots].sort((a, b) => a.id - b.id);
  }

  private broadcastState(): void {
    for (const c of this.clients.values()) {
      this.sendTo(c, { type: 'roomState', code: this.code, players: this.players(), hostId: this.hostId, status: this.status, yourId: c.id });
    }
  }

  private send(msg: ServerMessage): void {
    const s = JSON.stringify(msg);
    for (const c of this.clients.values()) if (c.socket.readyState === 1) c.socket.send(s);
  }
  private sendTo(c: Client, msg: ServerMessage): void {
    if (c.socket.readyState === 1) c.socket.send(JSON.stringify(msg));
  }

  dispose(): void {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
  }
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor() {
    setInterval(() => this.gc(), 5000);
  }

  private newCode(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      let c = '';
      for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!this.rooms.has(c)) return c;
    }
    return 'ROOM';
  }

  create(): Room {
    const code = this.newCode();
    const room = new Room(code);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  private gc(): void {
    for (const [code, room] of this.rooms) {
      if (room.emptyDurationMs() > 60_000) {
        room.dispose();
        this.rooms.delete(code);
      }
    }
  }
}
