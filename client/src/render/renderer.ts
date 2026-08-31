// Canvas 2D renderer. Draws a sim Snapshot each frame: camera framing the
// living fighters, The Foundry (tiles/pillars/platforms/molten glow/bell/
// furnace), fighters as stick figures, projectiles, particles, and the HUD.

import type { Snapshot } from '@flickfight/sim';
import { WORLD_W, WORLD_H, GAME_NAME } from '@flickfight/sim';
import { drawStickman, BODY_COLORS, type FighterView } from './stickman.ts';
import { Effects } from './effects.ts';

export interface PlayerMeta {
  id: number;
  name: string;
  color: number;
  face: string;
}

const MIN_VIEW_W = 24;
const MIN_VIEW_H = 13;

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  effects = new Effects();
  dpr = 1;
  cw = 0;
  ch = 0;
  showHitboxes = false;
  debug = false;
  ping = 0;
  private camX = WORLD_W / 2;
  private camY = WORLD_H / 2;
  private scale = 20;
  private t = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cw = this.canvas.clientWidth;
    this.ch = this.canvas.clientHeight;
    this.canvas.width = Math.floor(this.cw * this.dpr);
    this.canvas.height = Math.floor(this.ch * this.dpr);
  }

  private updateCamera(snap: Snapshot): void {
    const living = snap.fighters.filter((f) => f.stocks > 0 && f.state !== 'ko');
    let minX = WORLD_W / 2 - 4,
      maxX = WORLD_W / 2 + 4,
      minY = 6,
      maxY = 12;
    if (living.length > 0) {
      minX = Math.min(...living.map((f) => f.x));
      maxX = Math.max(...living.map((f) => f.x));
      minY = Math.min(...living.map((f) => f.y));
      maxY = Math.max(...living.map((f) => f.y + 1.8));
    }
    const pad = 4;
    let viewW = Math.max(MIN_VIEW_W, maxX - minX + pad * 2);
    let viewH = Math.max(MIN_VIEW_H, maxY - minY + pad * 2);
    // maintain aspect
    const aspect = this.cw / this.ch;
    if (viewW / viewH < aspect) viewW = viewH * aspect;
    else viewH = viewW / aspect;
    viewW = Math.min(viewW, WORLD_W + 12);
    viewH = Math.min(viewH, WORLD_H + 12);
    const targetX = (minX + maxX) / 2;
    const targetY = (minY + maxY) / 2;
    const targetScale = Math.min(this.cw / viewW, this.ch / viewH);
    // smooth
    this.camX += (targetX - this.camX) * 0.12;
    this.camY += (targetY - this.camY) * 0.12;
    this.scale += (targetScale - this.scale) * 0.12;
  }

  private worldTransform(): void {
    const ctx = this.ctx;
    const sh = this.effects.shake;
    const sx = (Math.random() - 0.5) * sh * this.dpr;
    const sy = (Math.random() - 0.5) * sh * this.dpr;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.translate(this.cw / 2 + sx / this.dpr, this.ch / 2 + sy / this.dpr);
    ctx.scale(this.scale, -this.scale);
    ctx.translate(-this.camX, -this.camY);
  }

  project(x: number, y: number): { x: number; y: number } {
    return { x: (x - this.camX) * this.scale + this.cw / 2, y: this.ch / 2 - (y - this.camY) * this.scale };
  }

  render(snap: Snapshot, meta: Map<number, PlayerMeta>): void {
    this.t++;
    const ctx = this.ctx;
    this.updateCamera(snap);
    this.effects.update();

    // background (screen space)
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, this.ch);
    g.addColorStop(0, '#12101a');
    g.addColorStop(1, '#0a0a0f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.cw, this.ch);

    // world
    this.worldTransform();
    this.drawMolten();
    this.drawStage(snap);
    this.drawProjectiles(snap);
    for (const fs of snap.fighters) {
      if (fs.state === 'ko' && fs.stocks <= 0) continue;
      const m = meta.get(fs.id);
      const view: FighterView = {
        ...fs,
        color: m?.color ?? fs.id,
        face: m?.face ?? '',
      } as FighterView;
      drawStickman(ctx, view, this.scale);
      if (this.showHitboxes) this.drawHitbox(fs);
      // blink cooldown ring
      if (fs.blink > 0) {
        ctx.strokeStyle = 'rgba(140,180,255,0.6)';
        ctx.lineWidth = 2 / this.scale;
        ctx.beginPath();
        ctx.arc(fs.x, fs.y + 0.9, 0.5, 0, (Math.PI * 2 * (90 - fs.blink)) / 90);
        ctx.stroke();
      }
    }
    this.effects.draw(ctx, this.scale);

    // damage numbers (upright, screen space)
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.font = `bold ${Math.round(this.scale * 0.6)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    for (const n of this.effects.numbers) {
      const p = this.project(n.x, n.y);
      ctx.globalAlpha = Math.min(1, n.life / 15);
      ctx.fillStyle = n.color;
      ctx.fillText(n.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;

    // slow-mo vignette
    if (this.effects.slowmo > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(0, 0, this.cw, this.ch);
    }

    this.drawHUD(snap, meta);
  }

  private drawMolten(): void {
    const ctx = this.ctx;
    const glow = 0.5 + 0.3 * Math.sin(this.t * 0.05);
    const grad = ctx.createLinearGradient(0, -3, 0, 2);
    grad.addColorStop(0, 'rgba(20,4,0,1)');
    grad.addColorStop(1, `rgba(255,${Math.round(90 * glow)},20,0.7)`);
    ctx.fillStyle = grad;
    ctx.fillRect(-4, -3, WORLD_W + 8, 5);
  }

  private drawStage(snap: Snapshot): void {
    const ctx = this.ctx;
    const st = snap.stage;
    // main floor tiles: 12 tiles, x from 8, width 2, body y 5..6
    for (let i = 0; i < st.tiles.length; i++) {
      const raw = st.tiles[i];
      const hp = raw & 7;
      const reforging = (raw & 8) !== 0;
      const x0 = 8 + i * 2;
      const surging = st.furnaceTiles.includes(i);
      if (hp <= 0 && !reforging) continue;
      if (reforging) {
        ctx.fillStyle = 'rgba(255,140,40,0.5)';
        ctx.fillRect(x0 + 0.05, 5, 1.9, 1);
        continue;
      }
      ctx.fillStyle = surging ? `rgba(255,60,20,${0.5 + 0.4 * Math.sin(this.t * 0.3)})` : '#2c2636';
      ctx.fillRect(x0 + 0.02, 5, 1.96, 1);
      ctx.fillStyle = '#3d3550';
      ctx.fillRect(x0 + 0.02, 5.85, 1.96, 0.15); // top highlight
      // cracks
      if (hp <= 2) this.crack(x0 + 1, 5.5, hp);
    }
    // pillars
    for (let i = 0; i < st.pillars.length; i++) {
      const hp = st.pillars[i];
      if (hp <= 0) continue;
      const x0 = i === 0 ? 7 : 32;
      ctx.fillStyle = hp === 1 ? '#4a3d2a' : '#33475a';
      ctx.fillRect(x0, 6, 1, 6);
      ctx.strokeStyle = '#5a6d80';
      ctx.lineWidth = 2 / this.scale;
      ctx.strokeRect(x0, 6, 1, 6);
    }
    // one-way platforms
    this.platform(4, 10, st.leftPlatY);
    this.platform(30, 36, st.rightPlatY);
    this.platform(17, 23, 15);
    // bell
    if (st.bellActive) {
      ctx.save();
      ctx.fillStyle = '#ffd24a';
      ctx.globalAlpha = 0.6 + 0.3 * Math.sin(this.t * 0.2);
      ctx.beginPath();
      ctx.arc(20, 7.4, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private crack(cx: number, cy: number, hp: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1.5 / this.scale;
    ctx.beginPath();
    ctx.moveTo(cx - 0.4, cy + 0.4);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + 0.3, cy + 0.4);
    if (hp <= 1) {
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx - 0.2, cy - 0.4);
    }
    ctx.stroke();
  }

  private platform(x0: number, x1: number, y: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#2a2438';
    ctx.fillRect(x0, y - 0.25, x1 - x0, 0.3);
    ctx.fillStyle = '#4a4060';
    ctx.fillRect(x0, y - 0.05, x1 - x0, 0.08);
  }

  private drawProjectiles(snap: Snapshot): void {
    const ctx = this.ctx;
    for (const p of snap.projectiles) {
      ctx.save();
      const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 0.5);
      grd.addColorStop(0, '#bff0ff');
      grd.addColorStop(1, 'rgba(90,200,255,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawHitbox(fs: Snapshot['fighters'][number]): void {
    // draw hurtbox + active hitbox in debug
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(0,255,120,0.7)';
    ctx.lineWidth = 1 / this.scale;
    ctx.strokeRect(fs.x - 0.4, fs.y, 0.8, 1.8);
  }

  private drawHUD(snap: Snapshot, meta: Map<number, PlayerMeta>): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const players = snap.fighters;
    const n = players.length;
    const slotW = Math.min(150, this.cw / n);
    ctx.textAlign = 'left';
    for (let i = 0; i < n; i++) {
      const f = players[i];
      const m = meta.get(f.id);
      const x = 12 + i * (slotW + 8);
      const y = 12;
      // face circle
      const col = BODY_COLORS[(m?.color ?? f.id) % BODY_COLORS.length];
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x + 14, y + 14, 14, 0, Math.PI * 2);
      ctx.fill();
      // name + damage
      ctx.fillStyle = '#e8e8f0';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.fillText((m?.name ?? 'P' + f.id).slice(0, 10), x + 34, y + 12);
      const dmgCol = f.dmg < 60 ? '#8affc1' : f.dmg < 130 ? '#ffd24a' : '#ff5a5a';
      ctx.fillStyle = dmgCol;
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.fillText(`${f.dmg}%`, x + 34, y + 32);
      // stocks
      ctx.fillStyle = col;
      for (let s = 0; s < f.stocks; s++) {
        ctx.beginPath();
        ctx.arc(x + 110 + s * 12, y + 10, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // timer center
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8e8f0';
    ctx.font = 'bold 22px system-ui, sans-serif';
    const mm = Math.floor(snap.timeLeft / 60);
    const ss = snap.timeLeft % 60;
    ctx.fillText(`${mm}:${ss.toString().padStart(2, '0')}`, this.cw / 2, 26);

    // countdown / GO
    if (snap.status === 'countdown') {
      ctx.font = 'bold 90px system-ui, sans-serif';
      ctx.fillStyle = '#ffd24a';
      ctx.fillText(snap.countdown > 0 ? String(snap.countdown) : 'GO', this.cw / 2, this.ch / 2);
    }

    // ping
    ctx.textAlign = 'left';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = this.ping > 250 ? '#ff5a5a' : '#7a8a9a';
    if (this.ping > 0) ctx.fillText(`${Math.round(this.ping)}ms`, 12, this.ch - 12);

    // debug overlay
    if (this.debug) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(this.cw - 200, this.ch - 90, 190, 80);
      ctx.fillStyle = '#8affc1';
      ctx.font = '11px monospace';
      ctx.textAlign = 'left';
      const f0 = snap.fighters[0];
      ctx.fillText(`tick ${snap.tick}  ping ${Math.round(this.ping)}`, this.cw - 194, this.ch - 72);
      ctx.fillText(`p0 ${f0?.state} ${f0?.move ?? ''} f${f0?.moveFrame ?? 0}`, this.cw - 194, this.ch - 58);
      ctx.fillText(`p0 dmg ${f0?.dmg} spd ${f0?.speed}`, this.cw - 194, this.ch - 44);
      ctx.fillText(`parts ${this.effects.particles.length}`, this.cw - 194, this.ch - 30);
    }

    // watermark title (only pre-fight tiny)
    void GAME_NAME;
  }
}
