// Particles, hitsparks, screen shake, slow-mo, damage numbers. Effects live in
// world coordinates and are spawned from sim events; the renderer draws them
// inside the world transform (numbers are drawn upright by the renderer).

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  grav: number;
}

export interface DamageNumber {
  x: number;
  y: number;
  vy: number;
  life: number;
  text: string;
  color: string;
}

export class Effects {
  particles: Particle[] = [];
  numbers: DamageNumber[] = [];
  shake = 0;
  slowmo = 0; // frames remaining of slow-mo
  ringFlash: { x: number; y: number; life: number } | null = null;

  burst(x: number, y: number, n: number, color: string, speed = 0.3, grav = 0.01): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random());
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 18 + Math.random() * 14,
        maxLife: 30,
        size: 0.05 + Math.random() * 0.08,
        color,
        grav,
      });
    }
  }

  hitspark(x: number, y: number, dmg: number): void {
    this.burst(x, y, 6 + Math.floor(dmg), '#fff2a8', 0.35, 0.004);
    this.burst(x, y, 4, '#ff8a3d', 0.5, 0.004);
  }

  damageNumber(x: number, y: number, dmg: number): void {
    this.numbers.push({ x, y: y + 1.6, vy: 0.03, life: 40, text: Math.round(dmg).toString(), color: dmg >= 9 ? '#ff5a5a' : '#ffe27a' });
  }

  addShake(px: number): void {
    this.shake = Math.min(6, Math.max(this.shake, px));
  }

  triggerSlowmo(frames: number, x: number, y: number): void {
    this.slowmo = frames;
    this.ringFlash = { x, y, life: 16 };
  }

  update(): void {
    const keep: Particle[] = [];
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy -= p.grav;
      p.life--;
      if (p.life > 0) keep.push(p);
    }
    this.particles = keep;
    const nkeep: DamageNumber[] = [];
    for (const n of this.numbers) {
      n.y += n.vy;
      n.life--;
      if (n.life > 0) nkeep.push(n);
    }
    this.numbers = nkeep;
    if (this.shake > 0) this.shake *= 0.82;
    if (this.shake < 0.1) this.shake = 0;
    if (this.slowmo > 0) this.slowmo--;
    if (this.ringFlash) {
      this.ringFlash.life--;
      if (this.ringFlash.life <= 0) this.ringFlash = null;
    }
  }

  draw(ctx: CanvasRenderingContext2D, scale: number): void {
    for (const p of this.particles) {
      ctx.globalAlpha = Math.min(1, p.life / 12);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (this.ringFlash) {
      const r = (16 - this.ringFlash.life) * 0.4;
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = this.ringFlash.life / 16;
      ctx.lineWidth = 4 / scale;
      ctx.beginPath();
      ctx.arc(this.ringFlash.x, this.ringFlash.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}
