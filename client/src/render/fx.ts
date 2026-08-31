// Turn sim events (from a snapshot) into particles, screen shake, slow-mo, and
// sounds. Shared by local play and networked play so effects are identical.

import type { Snapshot } from '@flickfight/sim';
import { SHAKE_MAX, SLOWMO_FRAMES } from '@flickfight/sim';
import type { Renderer } from './renderer.ts';
import { Sound } from '../audio.ts';

export function applyFx(snap: Snapshot, r: Renderer): void {
  const fx = r.effects;
  for (const e of snap.events) {
    switch (e.type) {
      case 'hit': {
        fx.hitspark(e.x, e.y, e.dmg ?? 4);
        fx.damageNumber(e.x, e.y, e.dmg ?? 0);
        fx.addShake(Math.min(SHAKE_MAX, (e.kb ?? 0) * 0.15));
        Sound.hit(e.dmg ?? 4);
        if (e.extra === 'spike') fx.burst(e.x, e.y, 8, '#ff4a4a', 0.5);
        break;
      }
      case 'killblow': {
        fx.triggerSlowmo(SLOWMO_FRAMES, e.x, e.y);
        fx.burst(e.x, e.y, 30, '#ffffff', 0.6, 0.002);
        fx.addShake(SHAKE_MAX);
        break;
      }
      case 'kill':
        Sound.ko();
        fx.burst(e.x, e.y, 24, '#ffb84a', 0.5);
        break;
      case 'blocked':
        fx.burst(e.x, e.y, 5, '#7ab8ff', 0.2);
        Sound.block();
        break;
      case 'parry':
        fx.triggerSlowmo(6, e.x, e.y);
        fx.burst(e.x, e.y, 14, '#ffffff', 0.35);
        Sound.parry();
        break;
      case 'counter':
        fx.burst(e.x, e.y, 16, '#ff8a3d', 0.4);
        Sound.hit(10);
        break;
    }
  }
  for (const s of snap.str) {
    if (s.startsWith('tileBreak')) {
      Sound.tile();
      const idx = Number(s.split(':')[1]);
      fx.burst(9 + idx * 2, 5.5, 12, '#ff8a3d', 0.35, 0.01);
    } else if (s.startsWith('tileCrack')) Sound.tile();
    else if (s.startsWith('pillarBreak')) {
      Sound.tile();
      fx.addShake(4);
    } else if (s.startsWith('bellSpawn')) Sound.bell();
    else if (s.startsWith('bellRing')) Sound.bell();
    else if (s === 'furnaceWarn') Sound.klaxon();
    else if (s === 'go') Sound.beep();
    else if (s.startsWith('pulse:')) Sound.pulse();
    else if (s === 'matchEnd') Sound.victory();
  }
}
