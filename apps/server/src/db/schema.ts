import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * players — guests identified by a bearer token kept in the browser. Everyone
 * joins with the same fun-money bankroll; balance is authoritative here.
 */
export const players = pgTable('players', {
  id: uuid('id').primaryKey().defaultRandom(),
  token: uuid('token').notNull().unique().defaultRandom(),
  nickname: text('nickname').notNull(),
  balance: integer('balance').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** rounds — one row per completed spin; the recent-results strip reads this. */
export const rounds = pgTable('rounds', {
  id: uuid('id').primaryKey(),
  number: integer('number').notNull(),
  settledAt: timestamp('settled_at', { withTimezone: true }).notNull().defaultNow(),
})

/** bets — settled stakes, joined with rounds for the per-player history. */
export const bets = pgTable('bets', {
  id: uuid('id').primaryKey().defaultRandom(),
  roundId: uuid('round_id')
    .notNull()
    .references(() => rounds.id, { onDelete: 'cascade' }),
  playerId: uuid('player_id')
    .notNull()
    .references(() => players.id, { onDelete: 'cascade' }),
  spot: text('spot').notNull(),
  amount: integer('amount').notNull(),
  /** Total returned (stake + winnings); 0 for a losing bet. */
  returned: integer('returned').notNull(),
})

export type PlayerRow = typeof players.$inferSelect
export type RoundRow = typeof rounds.$inferSelect
export type BetRow = typeof bets.$inferSelect
