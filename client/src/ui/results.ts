// Results screen: winner big, placements, stats, Rematch (host) / Leave.

import type { Placement } from '@flickfight/sim';
import type { PlayerMeta } from '../render/renderer.ts';
import { BODY_COLORS } from '../render/stickman.ts';
import { faceImage } from '../render/faces.ts';

export interface ResultsOpts {
  canRematch: boolean;
  onRematch: () => void;
  onLeave: () => void;
}

export function renderResults(root: HTMLElement, results: Placement[], meta: Map<number, PlayerMeta>, o: ResultsOpts): void {
  root.innerHTML = '';
  const winner = results[0];
  const wm = meta.get(winner.id);

  const title = document.createElement('div');
  title.className = 'title';
  title.style.fontSize = '40px';
  title.innerHTML = `<span class="a">${escapeHtml(wm?.name ?? 'WINNER')}</span> WINS`;
  root.appendChild(title);

  // winner face big
  const big = document.createElement('canvas');
  big.width = 140;
  big.height = 140;
  big.style.width = '140px';
  big.style.height = '140px';
  const bctx = big.getContext('2d')!;
  bctx.fillStyle = BODY_COLORS[(wm?.color ?? 0) % BODY_COLORS.length];
  bctx.beginPath();
  bctx.arc(70, 70, 66, 0, Math.PI * 2);
  bctx.fill();
  const img = faceImage(wm?.face ?? '');
  const drawFace = () => {
    const i2 = faceImage(wm?.face ?? '');
    if (i2) {
      bctx.save();
      bctx.beginPath();
      bctx.arc(70, 70, 60, 0, Math.PI * 2);
      bctx.clip();
      bctx.drawImage(i2, 10, 10, 120, 120);
      bctx.restore();
    }
  };
  if (img) drawFace();
  else setTimeout(drawFace, 200);
  root.appendChild(big);

  // placements + stats
  const card = document.createElement('div');
  card.className = 'card';
  const list = document.createElement('div');
  list.className = 'results-list';
  for (const p of results) {
    const m = meta.get(p.id);
    const row = document.createElement('div');
    row.className = 'place';
    const n = document.createElement('div');
    n.className = 'n';
    n.textContent = String(p.place);
    n.style.color = BODY_COLORS[(m?.color ?? 0) % BODY_COLORS.length];
    row.appendChild(n);
    const info = document.createElement('div');
    info.style.flex = '1';
    info.innerHTML = `<strong>${escapeHtml(m?.name ?? 'P' + p.id)}</strong><div class="small">${p.kos} KO · ${p.dmgDealt} dmg · ${p.parries} parry · ${p.bestCombo} combo</div>`;
    row.appendChild(info);
    list.appendChild(row);
  }
  card.appendChild(list);
  root.appendChild(card);

  // buttons
  const row = document.createElement('div');
  row.className = 'row';
  if (o.canRematch) {
    const rb = document.createElement('button');
    rb.className = 'btn pink';
    rb.textContent = 'REMATCH';
    rb.onclick = o.onRematch;
    row.appendChild(rb);
  } else {
    const wait = document.createElement('div');
    wait.className = 'small';
    wait.textContent = 'Waiting for host to rematch…';
    row.appendChild(wait);
  }
  const lb = document.createElement('button');
  lb.className = 'btn alt';
  lb.textContent = 'Leave';
  lb.onclick = o.onLeave;
  row.appendChild(lb);
  root.appendChild(row);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
