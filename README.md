# FLIPSTAFF

A FLATPLAY game: the phone lies flat on the table, two players sit face to
face, each with the strip of screen at their own edge. Forked from FLICK
FIGHT, rebuilt purely local — no server, no netcode.

**The idea:** a side-view staff duel inside a closed box. Floor AND ceiling
are ground. Your fighter starts on the surface at YOUR edge, so it reads as
standing upright from your seat — and the classic "upside-down fighter"
problem becomes the mechanic: the FLIP button inverts your gravity only,
momentum carries, and you somersault across to land feet-first on the far
surface. One small double-sided platform floats mid-arena to catch you.

## Controls (per player, at their own edge)

- **Left thumb** — drag ↔ run · flick ↑ jump · pull ↓ and hold = block
- **Right thumb** — three buttons: **QUICK** (wrist-snap slash, 7 dmg, short
  arc), **HEAVY** (regrip-to-the-end overhead arc, 20 dmg, long reach, finish
  pose held ~350 ms = punishable), **FLIP** (gravity, ~1 s cooldown)
- Block stops frontal hits only; every block slides you back and a blocked
  heavy shoves you far. Backs are open. KO wins the round, first to 3 wins.

## Files

- `sim.js` — the whole game headless: physics, combat, rounds, AI. Every
  tunable number is in `C` at the top.
- `game.js` — shell: touch zones (top player's frame is rotated 180°),
  ink-and-shoji rendering, staff choreography, HUD, audio.
- `?ai=1` — solo test mode: an AI drives the top fighter through the same
  InputFrame pathway a thumb uses (reaction delay, honest mistakes).

## Test / run

```
node test/sim.test.js
node test/ai.test.js
node test/render.test.js
```

Static site — open `index.html` via any local server (`npx serve .`).
