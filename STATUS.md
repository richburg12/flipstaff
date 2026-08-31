# FLICK FIGHT — build status (one-shot overnight build)

_Built 2026-08-24. Repo: github.com/richburg12/flickfight (private)._

## Where it stands: complete and deploy-ready

A full, playable game. Not a scaffold. The one thing left is **you running the
deploy** (~2 min) — the code is ready and `railway.json`/`npm start`/`/health`
are all wired. Deploy steps are in the README.

## What's built (all milestones M1–M11)

- **Monorepo** (`sim`/`server`/`client`), TypeScript, Vite client, tsx server,
  npm workspaces. `npm run dev` runs both with hot-reload.
- **Shared sim** — 60Hz fixed tick, hand-written AABB physics, a full Fighter
  state machine, the whole move set with frame data, the Strike/Grab/Block
  triangle, Smash knockback/hitstun/hitstop, momentum multiplier, parry, DI,
  tech/wall-splat, all 4 specials, three bot levels.
- **The Foundry** — 12 destructible tiles over a molten pit, breakable pillars
  that drop the side platforms, the Bell buff, the Furnace Surge, tile regen.
- **Client** — Canvas 2D renderer (camera, stage, procedural stick figures with
  your doodled face, particles/hitsparks/slow-mo/damage numbers), floating
  dual-stick touch with a flick recogniser, full keyboard (P1 + P2 numpad),
  home/room/results screens, face doodle, share link, synth audio, debug overlay.
- **Server + netcode** — authoritative rooms (`Map<code, Room>`), 60Hz loop,
  20Hz snapshots, bot-fill, disconnect handling, one URL for page + WebSocket.

## Verified (this session, automated)
- Combat mechanics (scripted inputs, **7/7**): block negates damage · grab beats
  block · strike interrupts grab · parry + attacker-stun · jab ×3 links ·
  launcher · **dive breaks a tile and drops a victim into the pit**.
- KO credit, match end + placements.
- Netcode: two WebSocket clients — create/join/start, 20Hz snapshots with input
  acks, bot filling a slot.
- Stability: 40,000-tick fuzz, no NaNs / no stuck fighters / no crashes.
- Production server serves the built client + health + assets (all 200).
- Rendered screenshots of the Foundry (fight) and the home/lobby look right.

## To play right now (before deploy)
```powershell
npm install
npm run dev
```
Then open **http://localhost:5173/?local=1** — two keyboard players + 2 bots.
(P1 = WASD/JK/arrows, P2 = numpad + IJKL. See README for the full map.)

## Next: deploy (see README "Deploying to Railway")
```powershell
npm i -g @railway/cli
railway login
railway init
railway up
railway domain
```
Open the URL, Create Room, hit Share, send your son the link. Fight.

## Three things to tune first (in `sim/src/constants.ts`)
1. **`KB_TO_VEL`** (0.085) — the master knockback knob. Nudge up for earlier,
   flashier KOs; down for longer, grindier matches.
2. **`HITSTOP_BASE`/`HITSTOP_MAX`** — the freeze-frame on hits. Raise for more
   weight and impact.
3. **`MOMENTUM_BONUS`** (0.6) — how much moving fast rewards damage. This is the
   skill-expression dial.

## Known trade-offs (details in README)
- Own-fighter net prediction is **off** by design (fallback rule) — smooth, but
  ~50ms input latency online. Local/keyboard have none.
- Ping readout is approximate; Gamepad support skipped.
