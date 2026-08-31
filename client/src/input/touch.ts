// Touch input: two floating thumb-sticks. Left half moves + flicks (jump/dash/
// fast-fall) and carries DI/tech via its angle. Right half is combat: tap =
// jab, flick = heavy in a sector, hold = block, hold-then-flick = special.
// Grab = block (right held) + flick the LEFT stick toward the opponent.
//
// Flicks fire the instant displacement crosses 40px within 120ms — latency
// beats everything. Sectors lock at the moment of firing.

import { emptyInput, sectorFromVector, type InputFrame, type Sector } from '@flickfight/sim';
import type { InputSource } from './types.ts';

const DEAD = 12;
const RADIUS = 60;
const FLICK_DIST = 40;
const FLICK_TIME = 120;
const TAP_TIME = 150;
const TAP_DIST = 20;
const HOLD_TIME = 150;

interface Stick {
  id: number;
  sx: number;
  sy: number;
  x: number;
  y: number;
  startT: number;
  firstMoveT: number;
  flicked: boolean;
}

export interface StickView {
  active: boolean;
  bx: number;
  by: number;
  kx: number;
  ky: number;
}

export class TouchSource implements InputSource {
  private left: Stick | null = null;
  private right: Stick | null = null;
  private el: HTMLElement;
  private W = () => window.innerWidth;

  // pending one-frame edges
  private pending = {
    jump: false,
    dash: false,
    dashDir: 0,
    fastFall: false,
    jab: false,
    heavy: false,
    heavyDir: 'fwd' as Sector,
    special: false,
    specialDir: 'fwd' as Sector,
  };
  // right stick began as a hold (>=150ms, small move) -> blocking; if it then
  // flicks, that's a special.
  private rightHeldLong = false;

  ghostL: { x: number; y: number } | null = null;
  ghostR: { x: number; y: number } | null = null;

  // iOS Safari does not reliably deliver POINTER events to a <canvas>, so we
  // also listen to native TOUCH events and prefer them once seen (touch events
  // are the dependable path on all mobile; pointer stays for desktop mouse).
  // touchstart/move for one finger share an identifier, so matching by id works.
  private sawTouch = false;

  constructor(el: HTMLElement) {
    this.el = el;
    el.addEventListener('pointerdown', this.onPointerDown, { passive: false });
    el.addEventListener('pointermove', this.onPointerMove, { passive: false });
    el.addEventListener('pointerup', this.onPointerUp, { passive: false });
    el.addEventListener('pointercancel', this.onPointerUp, { passive: false });
    el.addEventListener('touchstart', this.onTouchStart, { passive: false });
    el.addEventListener('touchmove', this.onTouchMove, { passive: false });
    el.addEventListener('touchend', this.onTouchEnd, { passive: false });
    el.addEventListener('touchcancel', this.onTouchEnd, { passive: false });
  }

  private now() {
    return performance.now();
  }

  // Pointer path — desktop mouse and any device where pointer events work.
  // Ignored once touch events have been seen (avoids double-processing on
  // Android, where both fire).
  private onPointerDown = (e: PointerEvent) => {
    if (this.sawTouch) return;
    e.preventDefault();
    this.begin(e.pointerId, e.clientX, e.clientY);
  };
  private onPointerMove = (e: PointerEvent) => {
    if (this.sawTouch) return;
    if (this.left?.id === e.pointerId || this.right?.id === e.pointerId) e.preventDefault();
    this.moveTo(e.pointerId, e.clientX, e.clientY);
  };
  private onPointerUp = (e: PointerEvent) => {
    if (this.sawTouch) return;
    this.end(e.pointerId, e.clientX);
  };

  // Native touch path — the reliable one on iOS/Android.
  private onTouchStart = (e: TouchEvent) => {
    this.sawTouch = true;
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) this.begin(t.identifier, t.clientX, t.clientY);
  };
  private onTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) this.moveTo(t.identifier, t.clientX, t.clientY);
  };
  private onTouchEnd = (e: TouchEvent) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) this.end(t.identifier, t.clientX);
  };

  // ---- shared core ----
  // Resolve which stick a move/end belongs to: by identifier first, then by
  // screen half (there's at most one stick per half). The half fallback makes
  // us resilient to platforms/emulators that don't keep touch identifiers
  // stable between touchstart and touchmove.
  private resolveStick(id: number, cx: number): Stick | null {
    if (this.left && this.left.id === id) return this.left;
    if (this.right && this.right.id === id) return this.right;
    return cx < this.W() / 2 ? this.left : this.right;
  }

  private begin(id: number, cx: number, cy: number): void {
    const isLeft = cx < this.W() / 2;
    const s: Stick = { id, sx: cx, sy: cy, x: cx, y: cy, startT: this.now(), firstMoveT: 0, flicked: false };
    if (isLeft) {
      if (!this.left) this.left = s;
    } else if (!this.right) {
      this.right = s;
      this.rightHeldLong = false;
    }
  }

  private moveTo(id: number, cx: number, cy: number): void {
    const s = this.resolveStick(id, cx);
    if (!s) return;
    s.x = cx;
    s.y = cy;
    const dx = s.x - s.sx;
    const dy = s.y - s.sy;
    const dist = Math.hypot(dx, dy);
    if (s.firstMoveT === 0 && dist > 4) s.firstMoveT = this.now();

    const isLeft = s === this.left;
    if (!s.flicked && dist >= FLICK_DIST && s.firstMoveT && this.now() - s.firstMoveT <= FLICK_TIME) {
      s.flicked = true;
      const ux = dx;
      const uy = -dy; // up positive
      if (isLeft) {
        if (Math.abs(uy) >= Math.abs(ux)) {
          if (uy > 0) this.pending.jump = true;
          else this.pending.fastFall = true;
        } else {
          this.pending.dash = true;
          this.pending.dashDir = ux > 0 ? 1 : -1;
        }
      } else {
        const sector = sectorFromVector(ux, uy, this.curFacing);
        if (this.rightHeldLong) {
          this.pending.special = true;
          this.pending.specialDir = sector;
        } else {
          this.pending.heavy = true;
          this.pending.heavyDir = sector;
        }
      }
    }
  }

  private end(id: number, cx: number): void {
    const s = this.resolveStick(id, cx);
    if (s && s === this.right) {
      const dist = Math.hypot(s.x - s.sx, s.y - s.sy);
      const dur = this.now() - s.startT;
      if (!s.flicked && dur < TAP_TIME && dist < TAP_DIST) this.pending.jab = true;
      this.ghostR = { x: s.x, y: s.y };
      this.right = null;
      this.rightHeldLong = false;
    } else if (s && s === this.left) {
      this.ghostL = { x: s.x, y: s.y };
      this.left = null;
    }
  }

  private curFacing = 1;

  poll(facing: number): InputFrame {
    this.curFacing = facing;
    const i = emptyInput();

    // left stick analog
    if (this.left) {
      const dx = this.left.x - this.left.sx;
      const dy = this.left.y - this.left.sy;
      const mag = Math.hypot(dx, dy);
      if (mag > DEAD) {
        i.mx = clampUnit(dx / RADIUS);
        i.my = clampUnit(-dy / RADIUS);
      }
      // hold down -> crouch (mostly downward, not flicked)
      if (!this.left.flicked && dy > DEAD && Math.abs(dy) > Math.abs(dx)) i.crouch = true;
    }

    // right stick: block if held long enough with small displacement
    if (this.right) {
      const dur = this.now() - this.right.startT;
      const dist = Math.hypot(this.right.x - this.right.sx, this.right.y - this.right.sy);
      if (dur >= HOLD_TIME && dist < TAP_DIST && !this.right.flicked) {
        this.rightHeldLong = true;
        i.block = true;
      }
    }

    // consume edges
    if (this.pending.jump) i.jump = true;
    if (this.pending.dash) {
      i.dash = true;
      i.dashDir = this.pending.dashDir;
    }
    if (this.pending.fastFall) i.fastFall = true;
    if (this.pending.jab) i.jab = true;
    if (this.pending.heavy) {
      i.heavy = true;
      i.heavyDir = this.pending.heavyDir;
    }
    if (this.pending.special) {
      i.special = true;
      i.specialDir = this.pending.specialDir;
    }

    // grab: blocking (right held) + left flick toward facing/opponent
    if (i.block && this.left && Math.hypot(i.mx, i.my) > 0.5) {
      i.grab = true;
    }

    this.resetPending();
    // expose ghosts for the renderer
    this.ghostL = this.left ? { x: this.left.x, y: this.left.y } : this.ghostL;
    this.ghostR = this.right ? { x: this.right.x, y: this.right.y } : this.ghostR;
    return i;
  }

  private resetPending(): void {
    this.pending.jump = false;
    this.pending.dash = false;
    this.pending.fastFall = false;
    this.pending.jab = false;
    this.pending.heavy = false;
    this.pending.special = false;
  }

  // Stick visuals for the renderer overlay.
  sticks(): { left: StickView; right: StickView } {
    return {
      left: this.left
        ? { active: true, bx: this.left.sx, by: this.left.sy, kx: this.left.x, ky: this.left.y }
        : { active: false, bx: 0, by: 0, kx: 0, ky: 0 },
      right: this.right
        ? { active: true, bx: this.right.sx, by: this.right.sy, kx: this.right.x, ky: this.right.y }
        : { active: false, bx: 0, by: 0, kx: 0, ky: 0 },
    };
  }

  debugState() { return { sawTouch: this.sawTouch, left: this.left ? { x: Math.round(this.left.x), sx: Math.round(this.left.sx) } : null, right: !!this.right, lastPending: this.pending.jab||this.pending.heavy }; }

  destroy(): void {
    this.el.removeEventListener('pointerdown', this.onPointerDown);
    this.el.removeEventListener('pointermove', this.onPointerMove);
    this.el.removeEventListener('pointerup', this.onPointerUp);
    this.el.removeEventListener('pointercancel', this.onPointerUp);
  }
}

function clampUnit(v: number) {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}
