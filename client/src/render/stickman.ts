// Procedural stick figure. Drawn in world units inside a y-up transform set by
// the renderer. Poses are derived from the fighter's state + move + frame, with
// simple keyframe blends. No art assets — everything is lines and a head.

import { MOVES, type MoveId, FIGHTER_H } from '@flickfight/sim';
import { faceImage } from './faces.ts';

export interface FighterView {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  state: string;
  move: MoveId | null;
  moveFrame: number;
  dmg: number;
  invuln: number;
  bell: boolean;
  color: number;
  face: string;
}

export const BODY_COLORS = ['#5ad1ff', '#ff6b8b', '#ffd24a', '#8affc1', '#c58bff', '#ff9d5a'];

interface Pt {
  x: number;
  y: number;
}

// Joints in local space (feet at 0,0; up positive). Facing handled by caller.
interface Pose {
  hip: Pt;
  chest: Pt;
  head: Pt;
  handF: Pt; // front hand
  handB: Pt; // back hand
  footF: Pt;
  footB: Pt;
}

const H = FIGHTER_H;

function base(): Pose {
  return {
    hip: { x: 0, y: H * 0.5 },
    chest: { x: 0, y: H * 0.78 },
    head: { x: 0, y: H * 0.95 },
    handF: { x: 0.25, y: H * 0.62 },
    handB: { x: -0.25, y: H * 0.62 },
    footF: { x: 0.18, y: 0 },
    footB: { x: -0.18, y: 0 },
  };
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function lp(a: Pt, b: Pt, t: number): Pt {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

function poseFor(v: FighterView, phase: number): Pose {
  const p = base();
  const s = v.state;
  const bob = Math.sin(phase * 0.12) * 0.04;

  if (s === 'idle') {
    p.chest.y += bob;
    p.head.y += bob;
    p.handF.y += bob;
    p.handB.y += bob;
  } else if (s === 'walk' || s === 'run') {
    const spd = s === 'run' ? 0.5 : 0.28;
    const c = Math.sin(phase * spd);
    p.footF.x = 0.18 + c * 0.35;
    p.footB.x = -0.18 - c * 0.35;
    p.footF.y = Math.max(0, c) * 0.15;
    p.footB.y = Math.max(0, -c) * 0.15;
    p.handF.x = 0.25 - c * 0.2;
    p.handB.x = -0.25 + c * 0.2;
    p.chest.x = c * 0.05;
  } else if (s === 'jumpsquat' || s === 'crouch') {
    p.hip.y = H * 0.38;
    p.chest.y = H * 0.62;
    p.head.y = H * 0.8;
    p.footF.x = 0.28;
    p.footB.x = -0.28;
  } else if (s === 'air' || s === 'helpless') {
    const up = v.vy > 0;
    p.footF.x = 0.22;
    p.footB.x = -0.12;
    p.footF.y = up ? -0.05 : 0.1;
    p.handF = { x: 0.3, y: up ? H * 0.75 : H * 0.5 };
    p.handB = { x: -0.3, y: up ? H * 0.75 : H * 0.5 };
    if (s === 'helpless') {
      const r = phase * 0.4;
      p.handF = { x: Math.cos(r) * 0.35, y: H * 0.6 + Math.sin(r) * 0.2 };
      p.handB = { x: -Math.cos(r) * 0.35, y: H * 0.6 - Math.sin(r) * 0.2 };
    }
  } else if (s === 'block') {
    p.handF = { x: 0.2, y: H * 0.7 };
    p.handB = { x: 0.28, y: H * 0.55 };
    p.hip.y = H * 0.46;
  } else if (s === 'hitstun' || s === 'wallsplat') {
    const f = Math.min(1, Math.hypot(v.vx, v.vy) * 3);
    const r = phase * 0.9;
    p.handF = { x: Math.cos(r) * 0.4 * (0.5 + f), y: H * 0.6 + Math.sin(r) * 0.3 };
    p.handB = { x: -Math.cos(r) * 0.4, y: H * 0.6 - Math.sin(r) * 0.3 };
    p.footF = { x: 0.3, y: 0.1 };
    p.footB = { x: -0.3, y: 0.05 };
    p.head.x = v.facing * -0.1;
    if (s === 'wallsplat') {
      p.chest.x = 0.15;
      p.head.x = 0.2;
    }
  } else if (s === 'attack' && v.move) {
    return attackPose(v, p);
  } else if (s === 'grab' || s === 'grabhold') {
    p.handF = { x: 0.7, y: H * 0.6 };
    p.handB = { x: 0.5, y: H * 0.6 };
  } else if (s === 'parry') {
    p.handF = { x: 0.35, y: H * 0.75 };
    p.handB = { x: 0.3, y: H * 0.6 };
  } else if (s === 'dash' || s === 'airdash') {
    p.chest.x = 0.2;
    p.head.x = 0.25;
    p.handB = { x: -0.4, y: H * 0.55 };
    p.footB = { x: -0.4, y: 0.1 };
  } else if (s === 'respawn') {
    p.chest.y += bob;
    p.head.y += bob;
  } else if (s === 'ko') {
    // lie down-ish
    p.hip.y = 0.2;
    p.chest = { x: 0.4, y: 0.35 };
    p.head = { x: 0.7, y: 0.45 };
  }
  return p;
}

function attackPose(v: FighterView, p: Pose): Pose {
  const m = MOVES[v.move as MoveId];
  const t = clamp01((v.moveFrame - m.startup) / Math.max(1, m.active)); // 0..1 across active
  const ext = v.moveFrame <= m.startup ? -0.3 : 1; // wind up then extend
  switch (v.move) {
    case 'jab1':
    case 'jab2':
    case 'jab3':
      p.handF = { x: lerp(0.3, 0.9, t) * ext, y: H * 0.72 };
      break;
    case 'fkick':
    case 'bkick':
    case 'fair':
    case 'bair':
      p.footF = { x: lerp(0.3, 1.0, t) * ext, y: H * 0.45 };
      p.chest.x = -0.1;
      break;
    case 'launcher':
    case 'uair':
    case 'uppercut':
      p.handF = { x: 0.2, y: lerp(H * 0.7, H * 1.25, t) };
      p.handB = { x: -0.1, y: lerp(H * 0.7, H * 1.2, t) };
      break;
    case 'sweep':
      p.footF = { x: lerp(0.4, 1.1, t), y: 0.05 };
      p.hip.y = H * 0.35;
      break;
    case 'dive':
      p.footF = { x: 0.5, y: -0.1 };
      p.footB = { x: 0.2, y: 0.1 };
      p.handB = { x: -0.4, y: H * 0.8 };
      break;
    case 'pulse':
      p.handF = { x: 0.6, y: H * 0.62 };
      break;
    case 'counter':
      p.handF = { x: 0.35, y: H * 0.7 };
      p.handB = { x: 0.35, y: H * 0.55 };
      break;
    case 'blink':
      p.chest.x = -0.2;
      break;
    default:
      p.handF = { x: 0.7, y: H * 0.65 };
  }
  return p;
}

function clamp01(x: number) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function drawStickman(ctx: CanvasRenderingContext2D, v: FighterView, scale: number): void {
  const pose = poseFor(v, v.moveFrame + v.x * 3 + v.y);
  const f = v.facing;
  const px = (pt: Pt) => ({ x: v.x + pt.x * f, y: v.y + pt.y });

  const hip = px(pose.hip);
  const chest = px(pose.chest);
  const head = px(pose.head);
  const handF = px(pose.handF);
  const handB = px(pose.handB);
  const footF = px(pose.footF);
  const footB = px(pose.footB);

  const col = BODY_COLORS[v.color % BODY_COLORS.length];
  const flashing = v.invuln > 0 && Math.floor(v.moveFrame + v.x * 10) % 6 < 3;
  ctx.save();
  ctx.globalAlpha = flashing ? 0.35 : 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3 / scale;
  ctx.strokeStyle = col;

  // bell aura
  if (v.bell) {
    ctx.save();
    ctx.strokeStyle = '#ffd24a';
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 6 / scale;
    ctx.beginPath();
    ctx.arc(v.x, v.y + H * 0.5, H * 0.7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // limbs
  line(ctx, footB, hip);
  line(ctx, footF, hip);
  line(ctx, hip, chest);
  line(ctx, chest, handB);
  line(ctx, chest, handF);

  // head
  const hr = 0.28;
  ctx.beginPath();
  ctx.fillStyle = col;
  ctx.arc(head.x, head.y, hr, 0, Math.PI * 2);
  ctx.fill();
  // simple face (eyes) — drawn in a mini upright transform to avoid y-flip
  drawFace(ctx, head.x, head.y, hr, f, v);

  ctx.restore();
}

function line(ctx: CanvasRenderingContext2D, a: Pt, b: Pt) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function drawFace(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, facing: number, v: FighterView) {
  const img = faceImage(v.face);
  if (img) {
    // draw the doodle clipped to the head; counter-flip the y-up transform so
    // it isn't upside down, and mirror horizontally to match facing.
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(x, y);
    ctx.scale((r / 48) * facing, -(r / 48));
    ctx.drawImage(img, -48, -48, 96, 96);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.fillStyle = '#0a0a0f';
  const ex = r * 0.35 * facing;
  const ey = r * 0.1;
  dot(ctx, x + ex - 0.06 * facing, y + ey, r * 0.12);
  dot(ctx, x + ex + 0.12 * facing, y + ey, r * 0.12);
  ctx.restore();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}
