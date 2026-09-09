import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { Card } from '@rondo/protocol'

/** Accounts. The first registered user becomes the admin (bootstrap). */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  token: uuid('token').notNull().unique().defaultRandom(),
  nickname: text('nickname').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['player', 'admin'] }).notNull().default('player'),
  balance: integer('balance').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Rooms. One live engine runs per open table. */
export const tables = pgTable('tables', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  game: text('game', { enum: ['roulette', 'blackjack', 'skat'] }).notNull(),
  minStake: integer('min_stake').notNull(),
  maxStake: integer('max_stake').notNull(),
  isOpen: boolean('is_open').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Admin-tunable knobs (e.g. defaultBalance for registration and resets). */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

export const rounds = pgTable('rounds', {
  id: uuid('id').primaryKey(),
  tableId: uuid('table_id')
    .notNull()
    .references(() => tables.id, { onDelete: 'cascade' }),
  number: integer('number').notNull(),
  settledAt: timestamp('settled_at', { withTimezone: true }).notNull().defaultNow(),
})

export const bets = pgTable('bets', {
  id: uuid('id').primaryKey().defaultRandom(),
  roundId: uuid('round_id')
    .notNull()
    .references(() => rounds.id, { onDelete: 'cascade' }),
  playerId: uuid('player_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  spot: text('spot').notNull(),
  amount: integer('amount').notNull(),
  returned: integer('returned').notNull(),
})

export const bjHands = pgTable('bj_hands', {
  id: uuid('id').primaryKey().defaultRandom(),
  tableId: uuid('table_id')
    .notNull()
    .references(() => tables.id, { onDelete: 'cascade' }),
  playerId: uuid('player_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  bet: integer('bet').notNull(),
  playerCards: jsonb('player_cards').$type<Card[]>().notNull(),
  dealerCards: jsonb('dealer_cards').$type<Card[]>().notNull(),
  outcome: text('outcome', { enum: ['blackjack', 'win', 'push', 'lose'] }).notNull(),
  returned: integer('returned').notNull(),
  settledAt: timestamp('settled_at', { withTimezone: true }).notNull().defaultNow(),
})

export type UserRow = typeof users.$inferSelect
export type TableRow = typeof tables.$inferSelect
