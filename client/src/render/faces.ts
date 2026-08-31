// Face doodles. A face is stored as a small PNG data URL (drawn by the player)
// or generated procedurally from a seed. In-game the image is cached and drawn
// clipped inside the head circle.

import { seedFromString, RNG } from '@flickfight/sim';

const cache = new Map<string, HTMLImageElement | null>();

export function faceImage(face: string): HTMLImageElement | null {
  if (!face) return null;
  if (cache.has(face)) return cache.get(face)!;
  cache.set(face, null);
  const img = new Image();
  img.onload = () => cache.set(face, img);
  img.src = face;
  return null;
}

// Generate a simple stick-figure face PNG from a seed string.
export function randomFace(seedStr: string): string {
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 96;
  const ctx = c.getContext('2d')!;
  const rng = new RNG(seedFromString(seedStr || Math.random().toString()));
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 96, 96);
  ctx.strokeStyle = '#111';
  ctx.fillStyle = '#111';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  // eyes
  const ey = 38 + rng.range(-6, 6);
  const gap = 16 + rng.range(0, 10);
  const eyeStyle = rng.int(0, 2);
  for (const sx of [-1, 1]) {
    const x = 48 + sx * gap;
    if (eyeStyle === 0) {
      ctx.beginPath();
      ctx.arc(x, ey, 5, 0, Math.PI * 2);
      ctx.fill();
    } else if (eyeStyle === 1) {
      ctx.beginPath();
      ctx.moveTo(x - 6, ey - 5);
      ctx.lineTo(x + 6, ey + 5);
      ctx.moveTo(x + 6, ey - 5);
      ctx.lineTo(x - 6, ey + 5);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(x, ey, 6, Math.PI, 0);
      ctx.stroke();
    }
  }
  // brows maybe
  if (rng.next() < 0.5) {
    for (const sx of [-1, 1]) {
      const x = 48 + sx * gap;
      ctx.beginPath();
      ctx.moveTo(x - 7, ey - 12);
      ctx.lineTo(x + 7, ey - 10 + rng.range(-4, 4));
      ctx.stroke();
    }
  }
  // mouth
  const my = 64 + rng.range(-4, 8);
  const mstyle = rng.int(0, 3);
  ctx.beginPath();
  if (mstyle === 0) {
    ctx.arc(48, my - 6, 12, 0.15 * Math.PI, 0.85 * Math.PI); // smile
  } else if (mstyle === 1) {
    ctx.arc(48, my + 8, 12, 1.15 * Math.PI, 1.85 * Math.PI); // frown
  } else if (mstyle === 2) {
    ctx.moveTo(36, my);
    ctx.lineTo(60, my); // flat
  } else {
    ctx.arc(48, my, 6, 0, Math.PI * 2); // o
  }
  ctx.stroke();
  return c.toDataURL('image/png');
}
