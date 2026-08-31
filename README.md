# FLICK FIGHT

A 2D side-view online brawler for 2–4 players (bots fill empty slots), playable
in a mobile browser from a shared link. Everyone plays the same universal stick
figure. Two invisible thumb-sticks: left moves, right *flicks* to attack.
Smash-style knockback and ring-outs, a Strike/Grab/Block triangle, momentum-
scaled damage, parries, directional influence, wall-teching, and one
destructible stage — **The Foundry**.

Authoritative Node server (runs the sim headlessly, broadcasts snapshots over
WebSockets, rooms as `Map<code, Room>`), TypeScript everywhere, Canvas 2D, no
art assets, no accounts. Monorepo: `sim/` (shared simulation) · `server/` ·
`client/`.

---

## Run it locally (Windows / PowerShell)

```powershell
npm install
npm run dev
```

- `npm run dev` runs the **server** (`http://localhost:8080`) and the **Vite
  client** (`http://localhost:5173`) together with hot-reload.
- Open **http://localhost:5173** to play. Constant changes in
  `sim/src/constants.ts` and `sim/src/moves.ts` hot-reload in the client.

### Quick modes (no menus)
- `http://localhost:5173/?local=1` — **two players on one keyboard** + 2 bots.
  The fastest way to test alone. No server needed for the fighting.
- `http://localhost:5173/?solo=1` — you vs 3 bots, offline.
- `http://localhost:5173/?room=CODE` — jump straight to joining a room.

### Test on your phone (same wifi)
1. `npm run dev` (Vite is started with `--host`).
2. On your phone's browser open `http://<your-PC-IP>:5173/` — the server log
   prints the LAN address on start. (For real online play across networks, use
   the deployed URL below.)

### Production build + run (single process, one URL)
```powershell
npm run build     # builds the client into client/dist
npm start         # serves client + WebSocket on PORT (default 8080)
```
Then open `http://localhost:8080`.

---

## Controls

### Touch (phones)
The screen splits in half. Sticks are **floating** — they spawn wherever your
thumb lands.

- **Left thumb = move.** Push to walk/run. **Flick up** = jump (again in air =
  double jump). **Flick sideways** = dash / air-dash. **Flick down** in air =
  fast-fall. Hold down = crouch (drop through platforms).
- **Right thumb = fight.** **Tap** = jab (tap again to link Jab 1→2→3). **Flick**
  = heavy attack in that direction (up / forward / back / down). **Hold** =
  block. **Hold then flick** = special.
- **Grab** = hold block (right) and **flick the left stick toward the opponent**
  ("block and step in"). Grabs beat blocks.

### Keyboard (desktop testing — fully supported)
- `A`/`D` walk, `Shift` run, `W` jump/double-jump, `S` crouch/fast-fall,
  `Q`/`E` dash left/right.
- **Arrow keys** = heavy attack in that direction.
- `J` = jab, hold `K` = block, `K`+arrow = special, `K`+`A`/`D` = grab.
- `Esc` pause (menu only — the match never pauses), `F3` debug overlay,
  `H` hitboxes.
- **Two players on one keyboard** (`?local=1`): P2 uses the numpad
  (`8/4/5/6` move, `0` jab, `.` block, `7` run, `1/3` dash) and `I/J/K/L` for
  attacks.

---

## The triangle (the whole tutorial)
- **Strike beats Grab** — a strike during the grab's startup interrupts it.
- **Grab beats Block** — grabs ignore block.
- **Block beats Strike** — blocked strikes do no damage; the attacker eats
  block-stun, the defender comes out ahead.

## Advanced tech
- **Momentum** — moving fast makes heavies and specials hit *harder* (up to
  ~1.9×). This is the main skill lever. Dash in, then kick.
- **Parry** — block in the **first 6 frames** as a strike lands: the attacker
  stumbles for 24 frames and you get a free hit. Parry the first hit of a combo
  and the combo's over.
- **Directional Influence (DI)** — during hitstun, hold the movement stick to
  bend your launch angle up to ±15°. Survive kills by DI-ing toward the stage.
- **Tech** — flick the movement stick toward a wall/floor just before impact to
  land safely instead of wall-splatting. Wall-tech gives a free wall-jump.
- **Spike through the floor** — a **Dive Kick** onto a destructible floor tile
  breaks it instantly (3 damage) and drops whoever's standing there into the
  pit *with* the tile. The signature play.
- **Blink** (back special) teleports you out of trouble on a 1.5s cooldown.

## The Foundry
40×22 stage, wide-open sides (ring-outs left/right). 12 destructible floor tiles
over a molten pit (dive-break them), two breakable pillars whose side platforms
drop when they fall, a **Bell** pickup (20s in) that buffs damage +30% but
lights you up for everyone, and a **Furnace Surge** every 45s that drops a
3-tile section for 6 seconds.

---

## Tuning guide — everything lives in two files

**`sim/src/constants.ts`** — all tunables, each with a one-line note. The big ones:
- `KB_TO_VEL` (0.085) — launch speed per knockback point. **The #1 feel knob.**
  Higher = fighters fly further = earlier KOs. (Started at the brief's 0.35,
  which instant-killed at 0% — see Decisions below.)
- `HITSTUN_PER_KB` (0.5) — how long you're stuck after a hit; higher = longer
  combos.
- `HITSTOP_BASE` / `HITSTOP_MAX` — the freeze-frame on impact. Raise for a
  weightier, more brutal feel.
- `MOMENTUM_BONUS` (0.6) — how much speed boosts damage.
- `GRAVITY`, `JUMP_VEL`, `RUN_SPEED`, `AIR_MAX` — movement.
- `START_STOCKS` (3), `MATCH_SECONDS` (180), respawn/invuln frames.
- Stage: `TILE_HP`, `TILE_REGEN_S`, `PILLAR_HP`, `FURNACE_EVERY_S`, bell timings.

**`sim/src/moves.ts`** — the frame-data table: startup / active / recovery /
damage / base knockback / growth / angle / hitbox for every move. Tweak a
number, restart `npm run dev`, feel it.

---

## Deploying to Railway (do this in the morning — ~2 minutes)

The repo is ready: `railway.json` builds with `npm run build` and starts with
`npm start`; the server reads `PORT` from the environment and serves the client
+ WebSocket on one port; `/health` is wired for Railway's healthcheck.

**With the Railway CLI:**
```powershell
npm i -g @railway/cli
railway login            # opens the browser once
railway init             # create a new project (pick a name), or `railway link` to an existing one
railway up               # build + deploy
railway domain           # generate a public URL
```
Open the URL it prints — that's the link to share. Create a room, send the
`?room=CODE` link (the **Share** button does this), fight.

**Or via the Railway dashboard:** New Project → Deploy from GitHub →
`richburg12/flickfight`. Railway auto-detects Node, runs `npm run build` then
`npm start`. Add a domain under Settings → Networking.

No environment variables are required.

---

## Testing
```powershell
npm test        # headless sim soak: 40,000 ticks, asserts no NaNs / no fighters
                # stuck in geometry / no crashes. Run before committing.
```
The sim was also verified with scripted-input checks for the triangle (block
negates damage, grab beats block, strike interrupts grab), parry timing, jab
links, launcher, and dive-through-tile; and the netcode with a two-client
WebSocket smoke test.

---

## Decisions made during build
- **Knockback tuned from 0.35 → 0.085** (`KB_TO_VEL`). At the brief's starting
  0.35 a fresh hit launched ~3.5 units/frame and crossed the open stage in a
  few frames — every clean hit was an instant KO with no percent buildup. 0.085
  gives Smash-style pacing (fresh hits pop, ~120% hits threaten the blast zone).
  Everything's in `constants.ts` to re-tune.
- **`?solo=1` runs offline** (local bots) rather than spinning up a server room,
  so it always works for quick phone testing even before deploy.
- Aerial moves keep their hitbox live on the landing frame so the dive's
  tile-break resolves (it's applied after all fighters advance each tick).

## Known issues / cut cleanly
- **Client-side prediction is off.** Per the brief's fallback rule, own-fighter
  prediction/reconciliation is disabled; the client interpolates *all* fighters
  (own at 50 ms, remote at 100 ms). This removes reconciliation jitter and is
  smooth for friends in one region; the trade-off is ~50 ms of input latency on
  your own fighter online (local/keyboard modes have none). Re-enabling
  prediction is the first netcode upgrade to try.
- **Ping readout is approximate** (derived from snapshot cadence, not an RTT
  echo).
- **Gamepad support** was skipped (keyboard + touch cover testing and play).
- Face doodles are drawn inside the head in-game; very intricate doodles read as
  a blob at fighter size — that's expected at this scale.
