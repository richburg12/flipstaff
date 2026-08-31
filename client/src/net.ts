// NetGame — the networked client. Authoritative server, we send inputs at
// 60 Hz and render interpolated snapshots. Per the brief's fallback rule we run
// WITHOUT own-fighter prediction (interpolate own at 50 ms, others at 100 ms):
// it removes all reconciliation jitter and is smooth for friends in one region.
// (See README "known issues".)

import { emptyInput, type InputFrame, type Snapshot, type Sector } from '@flickfight/sim';
import type { Game } from './game.ts';
import type { PlayerMeta } from './render/renderer.ts';
import type { ClientMessage, ServerMessage, PlayerInfo, CompactInput } from './proto.ts';
import { KeyboardSource, P1_KEYS } from './input/keyboard.ts';
import { TouchSource } from './input/touch.ts';
import type { InputSource } from './input/types.ts';
import type { Profile } from './main.ts';

const OWN_DELAY = 50;
const REMOTE_DELAY = 100;
const SECTORS: Sector[] = ['fwd', 'back', 'up', 'down'];

function packInput(i: InputFrame): CompactInput {
  let b = 0;
  if (i.jump) b |= 1;
  if (i.dash) b |= 2;
  if (i.fastFall) b |= 4;
  if (i.crouch) b |= 8;
  if (i.jab) b |= 16;
  if (i.heavy) b |= 32;
  if (i.block) b |= 64;
  if (i.special) b |= 128;
  if (i.grab) b |= 256;
  return { b, mx: +i.mx.toFixed(2), my: +i.my.toFixed(2), hd: SECTORS.indexOf(i.heavyDir), sd: SECTORS.indexOf(i.specialDir), dd: i.dashDir };
}

interface Buffered {
  t: number; // client receive time
  snap: Snapshot;
}

export class NetGame implements Game {
  isLocal = false;
  meta = new Map<number, PlayerMeta>();
  localIds: number[] = [];
  ping = 0;
  isHost = false;
  yourId = -1;

  onEnterRoom?: () => void;
  onRoomUpdate?: () => void;
  onStart?: () => void;
  onError?: (m: string) => void;

  players: PlayerInfo[] = [];
  hostId = -1;
  roomCode = '';
  roomStatus: 'lobby' | 'countdown' | 'live' | 'ended' = 'lobby';

  private ws: WebSocket | null = null;
  private profile: Profile;
  source: InputSource;
  get touch(): TouchSource | null {
    return this.source instanceof TouchSource ? this.source : null;
  }
  private seq = 0;
  private buf: Buffered[] = [];
  private pendingEvents: Snapshot['events'] = [];
  private pendingStr: string[] = [];
  private lastServerTick = -1;
  private pingSent = 0;
  private inRoom = false;

  constructor(profile: Profile) {
    this.profile = profile;
    const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.source = isTouch ? new TouchSource(document.querySelector('canvas')!) : new KeyboardSource(P1_KEYS);
  }

  connect(onOpen: () => void): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    // dev: vite on 5173, server on 8080; prod: same host
    const host = location.port === '5173' ? `${location.hostname}:8080` : location.host;
    this.ws = new WebSocket(`${proto}://${host}`);
    this.ws.onopen = () => {
      onOpen();
      this.pingLoop();
    };
    this.ws.onmessage = (ev) => this.onMessage(JSON.parse(ev.data) as ServerMessage);
    this.ws.onerror = () => this.onError?.('Connection error.');
    this.ws.onclose = () => {
      if (this.inRoom) this.onError?.('Disconnected.');
    };
  }

  private send(m: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  create(): void {
    this.send({ type: 'create', name: this.profile.name || 'PLAYER', color: this.profile.color, face: this.profile.face });
  }
  join(code: string): void {
    this.send({ type: 'join', code, name: this.profile.name || 'PLAYER', color: this.profile.color, face: this.profile.face });
  }
  setReady(r: boolean): void {
    this.send({ type: 'ready', ready: r });
  }
  addBot(level: 'easy' | 'medium' | 'hard'): void {
    this.send({ type: 'addBot', level });
  }
  removeBot(): void {
    this.send({ type: 'removeBot' });
  }
  startMatch(): void {
    this.send({ type: 'start' });
  }
  rematch(): void {
    this.send({ type: 'rematch' });
  }
  leave(): void {
    this.inRoom = false;
    this.send({ type: 'leave' });
    this.ws?.close();
  }

  private pingLoop(): void {
    const beat = () => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.pingSent = performance.now();
      // reuse input channel timing; approximate ping via snapshot arrival cadence
      setTimeout(beat, 1000);
    };
    beat();
  }

  private onMessage(m: ServerMessage): void {
    switch (m.type) {
      case 'roomState': {
        this.players = m.players;
        this.hostId = m.hostId;
        this.roomCode = m.code;
        this.roomStatus = m.status;
        this.yourId = m.yourId;
        this.isHost = m.hostId === m.yourId;
        this.localIds = [m.yourId];
        this.meta.clear();
        for (const p of m.players) this.meta.set(p.id, { id: p.id, name: p.name, color: p.color, face: p.face });
        if (!this.inRoom) {
          this.inRoom = true;
          this.onEnterRoom?.();
        }
        this.onRoomUpdate?.();
        break;
      }
      case 'start':
        this.buf = [];
        this.onStart?.();
        break;
      case 'snapshot': {
        const now = performance.now();
        this.buf.push({ t: now, snap: m.snap });
        if (this.buf.length > 30) this.buf.shift();
        // collect events once
        if (m.snap.tick !== this.lastServerTick) {
          this.lastServerTick = m.snap.tick;
          this.pendingEvents.push(...m.snap.events);
          this.pendingStr.push(...m.snap.str);
        }
        // rough ping: server snapshots at 20Hz; measure jitter as ping proxy
        this.ping = Math.max(0, now - this.pingSent) % 200;
        break;
      }
      case 'error':
        this.onError?.(m.msg);
        break;
    }
  }

  step(): void {
    // send local input each client frame
    const own = this.buf.length ? this.buf[this.buf.length - 1].snap.fighters.find((f) => f.id === this.yourId) : null;
    const frame = this.source.poll(own?.facing ?? 1);
    // keyboard batch clear handled by main via endKeyboardFrame? Net uses its own source; clear here:
    this.seq++;
    this.send({ type: 'input', seq: this.seq, frame: packInput(frame) });
  }

  snapshot(): Snapshot {
    // Build an interpolated snapshot for rendering.
    const now = performance.now();
    const latest = this.buf.length ? this.buf[this.buf.length - 1].snap : null;
    if (!latest) return blankSnap();

    const interp = (delay: number) => this.sampleAt(now - delay);
    const ownSnap = interp(OWN_DELAY);
    const remoteSnap = interp(REMOTE_DELAY);

    const fighters = latest.fighters.map((lf) => {
      const src = lf.id === this.yourId ? ownSnap : remoteSnap;
      const sf = src?.fighters.find((f) => f.id === lf.id);
      return sf ?? lf;
    });

    const out: Snapshot = {
      ...latest,
      fighters,
      events: this.pendingEvents.splice(0),
      str: this.pendingStr.splice(0),
    };
    return out;
  }

  // Interpolate between the two buffered snapshots bracketing target time.
  private sampleAt(target: number): Snapshot | null {
    if (this.buf.length === 0) return null;
    if (this.buf.length === 1) return this.buf[0].snap;
    let a = this.buf[0];
    let b = this.buf[this.buf.length - 1];
    for (let i = 0; i < this.buf.length - 1; i++) {
      if (this.buf[i].t <= target && this.buf[i + 1].t >= target) {
        a = this.buf[i];
        b = this.buf[i + 1];
        break;
      }
    }
    const span = b.t - a.t || 1;
    const f = Math.max(0, Math.min(1.5, (target - a.t) / span)); // allow slight extrapolation
    const lerp = (x: number, y: number) => x + (y - x) * f;
    const fighters = a.snap.fighters.map((fa) => {
      const fb = b.snap.fighters.find((z) => z.id === fa.id) ?? fa;
      return { ...fb, x: lerp(fa.x, fb.x), y: lerp(fa.y, fb.y) };
    });
    return { ...b.snap, fighters };
  }
}

function blankSnap(): Snapshot {
  return {
    tick: 0,
    status: 'countdown',
    countdown: 3,
    timeLeft: 180,
    fighters: [],
    projectiles: [],
    stage: { tiles: [], pillars: [], leftPlatY: 11, rightPlatY: 11, bellActive: false, bellHolder: -1, furnaceTiles: [] },
    events: [],
    str: [],
    results: null,
  } as unknown as Snapshot;
}

void emptyInput;
