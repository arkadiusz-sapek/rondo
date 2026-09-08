# rondo — live multiplayer roulette

A full, working live-casino-style roulette table: one authoritative server
round-loop that every connected player shares (exactly like a live dealer
table), a typed WebSocket protocol, and a PixiJS-rendered wheel and betting
layout. Fun money only — every guest sits down with $100.

> **Provenance note**: this is an independent, from-scratch implementation of
> publicly known live-casino UX patterns (phased rounds, bet spots, result
> history). It contains no proprietary code, assets, protocols or names from
> any employer or commercial product; all graphics are drawn programmatically.

## Architecture

```
packages/protocol   the single source of truth for the wire + game rules
  events.ts         zod discriminated unions: ServerEvent / ClientCommand
  roulette.ts       wheel layout, colors, bet coverage, payout math (unit-tested)

apps/server         NestJS + plain `ws` + Drizzle/Postgres
  engine.service    the authoritative table: betting → bets_closed →
                    spinning → result, on a timer, forever; crypto RNG;
                    balances move atomically in the DB (escrow on bet,
                    refund on undo/clear/disconnect, credit on settle)
  ws.service        transport: token-authenticated sockets, zod-parsed
                    commands, one switch, personalized frames (your
                    settlement is yours; totals are broadcast)
  players.controller REST: guest join ($100), per-player bet history

apps/client         Vite + React 19 + PixiJS v8 + Zustand + TanStack Query
  store/game.ts     ONE reducer for the wire: every ServerEvent lands in a
                    single switch; components read plain state
  pixi/wheel3d.ts   pseudo-3D wheel: every pocket is a quad between two
                    ellipses under a ~55° camera tilt, redrawn per frame —
                    no meshes, no assets, no three.js. The rotor never
                    fully stops (idles like a real table) and the ball
                    lands wherever the winning pocket happens to be, then
                    rides the rotor
  pixi/board.ts     betting grid with EVENT DELEGATION: ~50 clickable spots,
                    exactly one pointer listener — taps AND chip drag-drops
                    are resolved to a spot by rect lookup, no per-spot
                    handlers
  pixi/confetti.ts  particle burst on wins, ticked from the main loop
  ui/*              glass DOM overlays stacked on the fullscreen canvas:
                    HUD, chip dock (click or drag & drop), right rail with
                    chat / players / history drawers, leave-table
```

### The protocol

Every frame in both directions is `{ type, payload }`:

| direction | type | when |
|---|---|---|
| → client | `table_snapshot` | on (re)connect — full resync |
| → client | `phase_changed` | betting / bets_closed / spinning / result |
| → client | `bet_accepted` / `bet_rejected` / `bets_cleared` | replies to your commands |
| → client | `bet_totals` | live table-wide stakes per spot |
| → client | `player_joined` / `player_left` | presence |
| → client | `spin_result` | the number, revealed mid-spin so clients can ease the ball in |
| → client | `round_settled` | personalized: your return + new balance |
| → client | `chat_message` | table chat (ring buffer replayed in the snapshot) |
| → server | `place_bet` / `undo_bet` / `clear_bets` | guarded by phase + balance |
| → server | `chat_send` | rate-limited table chat |

Both ends parse incoming frames with zod (`parseServerEvent` /
`parseClientCommand`) — malformed input dies at the edge, never inside game
logic. Client and server import the same schemas from `@rondo/protocol`, so
they cannot drift apart.

### Why event delegation on the board

A roulette layout has ~50 tappable spots (and 100+ once split/corner bets
land). Attaching a handler per spot means 50 closures to create, keep in sync
with re-renders, and hit-test through the scene graph. Instead the board holds
**one** `pointerdown` listener; the tap position is resolved to a spot with a
rectangle lookup built at draw time. Adding split/corner/street bets is a
resolver change, not 60 new handlers.

## Run it

```
pnpm install
pnpm db:up      # postgres 17 in docker (port 5434)
pnpm db:push    # create tables
pnpm dev        # server :3200 (REST + /ws) and client :5180
```

Open http://localhost:5180 in two browser windows to see the shared table:
both clients ride the same round, see each other in the panel, and watch the
combined stakes appear as ghost chips.

`pnpm test` runs the rules/payout unit tests. `pnpm lint` typechecks all
three packages.

## Honest scope

- Inside bets are straight-only for now; outside bets are complete
  (red/black, even/odd, low/high, dozens, columns). The spot model and the
  delegation hit-test were designed for splits/corners/streets — that's the
  next milestone.
- Guests + bearer token, no accounts. The token in localStorage survives
  refreshes and reconnects (server replays a full `table_snapshot`);
  "leave table" drops the session — a new nickname is a fresh $100 guest.
- The layout is phase-driven: while betting the grid is the hero, during the
  spin the wheel scales up and takes the stage. One fullscreen Pixi scene,
  DOM glass panels on top.
- RNG is `crypto.randomInt` server-side. A provably-fair scheme
  (hash-committed seeds) is on the roadmap.

## Roadmap

- split / corner / street / line bets
- provably-fair seed commitment
- seats & avatars around the table, bet racetrack
- spectator mode polish, sounds, mobile layout
