# rondo — a tiny live casino
<img width="2549" height="1361" alt="image" src="https://github.com/user-attachments/assets/ce699738-77ef-4f39-b7bf-999994b8fb28" />

# rondo

A small multiplayer casino, built with AI assistance to practise a different tech stack.
Roulette, blackjack and skat over one typed WebSocket protocol. Graphics in PixiJS.

## Stack

TypeScript · NestJS · ws · Drizzle · PostgreSQL · zod · React 19 · Vite ·
PixiJS v8 · Zustand · TanStack Query · Vitest · pnpm workspaces · Docker

## What's in it

- accounts, a lobby of rooms, admin backoffice, one engine instance per open room
- roulette: phased round loop, crypto RNG, balances escrowed and settled in the DB
- blackjack: 6-deck shoe, up to five seats, 12s decision clock
- skat: full auction, matadors through the skat, Seeger-Fabian list, two bots

## Run it

```
pnpm install
pnpm db:up      # postgres in docker
pnpm db:push
pnpm dev        # server :3200, client :5180
```

