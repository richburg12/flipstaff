// Synthesised audio via Web Audio — no files. Each sound is a tiny oscillator/
// noise burst. The context is unlocked on first touch/click. Mute is persisted.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = localStorage.getItem('ff_muted') === '1';

export function unlockAudio(): void {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.5;
  master.connect(ctx.destination);
}

export function setMuted(m: boolean): void {
  muted = m;
  localStorage.setItem('ff_muted', m ? '1' : '0');
  if (master) master.gain.value = m ? 0 : 0.5;
}
export function isMuted(): boolean {
  return muted;
}

function noiseBuffer(dur: number): AudioBuffer {
  const c = ctx!;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number): void {
  if (!ctx || !master || muted) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  if (slideTo !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), ctx.currentTime + dur);
  g.gain.value = gain;
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
  o.connect(g).connect(master);
  o.start();
  o.stop(ctx.currentTime + dur);
}

function noise(dur: number, gain: number, filterFreq: number, sweepTo?: number): void {
  if (!ctx || !master || muted) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(dur);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = filterFreq;
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, ctx.currentTime + dur);
  const g = ctx.createGain();
  g.gain.value = gain;
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
  src.connect(f).connect(g).connect(master);
  src.start();
  src.stop(ctx.currentTime + dur);
}

export const Sound = {
  jab: () => tone(680, 0.05, 'square', 0.08),
  whoosh: () => noise(0.16, 0.12, 900, 3000),
  hit: (dmg: number) => {
    tone(120 - Math.min(60, dmg * 3), 0.12, 'sine', 0.25, 60);
    noise(0.09, 0.18, 500);
  },
  block: () => tone(1400, 0.05, 'triangle', 0.1),
  parry: () => tone(1800, 0.5, 'sine', 0.2, 900),
  grab: () => tone(160, 0.08, 'sawtooth', 0.12),
  ko: () => {
    tone(200, 0.5, 'sawtooth', 0.3, 40);
    noise(0.5, 0.2, 400, 80);
  },
  tile: () => noise(0.14, 0.16, 300),
  bell: () => {
    tone(1000, 0.6, 'sine', 0.18);
    tone(1500, 0.6, 'sine', 0.1);
  },
  klaxon: () => tone(220, 0.4, 'sawtooth', 0.15, 180),
  beep: () => tone(880, 0.08, 'square', 0.15),
  victory: () => {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.2, 'triangle', 0.2), i * 120));
  },
  pulse: () => tone(500, 0.2, 'sine', 0.1, 900),
};
