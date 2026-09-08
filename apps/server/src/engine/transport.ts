import type { ServerEvent } from '@rondo/protocol'

/** Table-scoped messaging handed to every engine by the table manager. */
export interface Transport {
  broadcast: (event: ServerEvent) => void
  sendTo: (playerId: string, event: ServerEvent) => void
}

export interface GameEngine {
  readonly game: 'roulette' | 'blackjack'
  start(): Promise<void> | void
  stop(): void
  dropPlayer(playerId: string): Promise<void> | void
}
