import { z } from 'zod'
import { RANKS, SUITS } from './blackjack.js'
import { SKAT_RANKS, SKAT_SUITS } from './skat.js'

/**
 * The wire protocol. Every frame is JSON `{ type, payload }` — a discriminated
 * union both sides narrow with a single switch. Zod schemas make the boundary
 * safe: the server parses every client command, the client parses every server
 * event, and anything malformed dies at the edge instead of inside game logic.
 */

export const PHASES = ['betting', 'bets_closed', 'spinning', 'result'] as const
export type Phase = (typeof PHASES)[number]

const phaseSchema = z.enum(PHASES)

const betSpotSchema = z.string().regex(
  /^(straight:(\d|[12]\d|3[0-6])|red|black|even|odd|low|high|(dozen|column):[123])$/,
  'unknown bet spot',
)

export const playerPublicSchema = z.object({
  id: z.string(),
  nickname: z.string(),
})

export const betSchema = z.object({
  id: z.string(),
  spot: betSpotSchema,
  amount: z.number().int().positive(),
})

export const recentResultSchema = z.object({
  roundId: z.string(),
  number: z.number().int().min(0).max(36),
  color: z.enum(['red', 'black', 'green']),
})

export const tableMetaSchema = z.object({
  id: z.string(),
  name: z.string(),
  game: z.enum(['roulette', 'blackjack', 'skat']),
  minStake: z.number().int(),
  maxStake: z.number().int(),
})

export const cardSchema = z.object({
  rank: z.enum(RANKS),
  suit: z.enum(SUITS),
})

export const BJ_PHASES = ['betting', 'dealing', 'acting', 'dealer', 'result'] as const

export const bjSeatSchema = z.object({
  playerId: z.string(),
  nickname: z.string(),
  bet: z.number().int(),
  doubled: z.boolean(),
  cards: z.array(cardSchema),
  total: z.number().int(),
  busted: z.boolean(),
  blackjack: z.boolean(),
  done: z.boolean(),
  outcome: z.enum(['blackjack', 'win', 'push', 'lose']).nullable(),
})

export const bjDealerSchema = z.object({
  cards: z.array(cardSchema),
  total: z.number().int(),
  /** True while the hole card is face down — `cards` then holds only the upcard. */
  hiding: z.boolean(),
})

const bjTurnSchema = z.object({ playerId: z.string(), endsAt: z.string() }).nullable()

export const chatMessageSchema = z.object({
  playerId: z.string(),
  nickname: z.string(),
  text: z.string().min(1).max(200),
  at: z.string(),
})

/* ----------------------------------- skat ---------------------------------- */

export const SKAT_PHASES = [
  'waiting',
  'dealing',
  'bidding',
  'skat_decision',
  'discarding',
  'declaring',
  'playing',
  'settled',
  'series_end',
] as const

export const skatCardSchema = z.object({
  suit: z.enum(SKAT_SUITS),
  rank: z.enum(SKAT_RANKS),
})

export const skatSeatSchema = z.object({
  seat: z.number().int().min(0).max(2),
  playerId: z.string(),
  nickname: z.string(),
  isBot: z.boolean(),
  cardCount: z.number().int(),
  tricksTaken: z.number().int(),
})

export const skatContractSchema = z.object({
  type: z.enum(['suit', 'grand', 'null']),
  trump: z.enum(SKAT_SUITS).nullable(),
  hand: z.boolean(),
  ouvert: z.boolean(),
  schneiderAnnounced: z.boolean(),
  schwarzAnnounced: z.boolean(),
})

export const skatBiddingSchema = z.object({
  speakerSeat: z.number().int(),
  listenerSeat: z.number().int(),
  /** Highest value spoken so far; null before the first bid. */
  level: z.number().int().nullable(),
  awaiting: z.enum(['speak', 'answer']),
  lastAction: z
    .object({
      seat: z.number().int(),
      action: z.enum(['bid', 'hold', 'pass']),
      value: z.number().int().nullable(),
    })
    .nullable(),
})

export const skatListRowSchema = z.object({
  n: z.number().int(),
  /** null = all passed (eingepasst). */
  declarerSeat: z.number().int().nullable(),
  label: z.string(),
  value: z.number().int(),
  won: z.boolean().nullable(),
  /** Signed Seeger score for the declarer (value+50 / -(2·value+50)). */
  delta: z.number().int(),
  /** Declarer's cumulative score after this row — the number written on a real list. */
  cumAfter: z.number().int(),
})

export const skatTotalsSchema = z.object({
  cum: z.number().int(),
  won: z.number().int(),
  lost: z.number().int(),
  /** 40 × games lost by the other two players (Seeger-Fabian, 3-seat table). */
  defenderBonus: z.number().int(),
  final: z.number().int(),
})

export const skatResultSchema = z.object({
  declarerSeat: z.number().int(),
  contractLabel: z.string(),
  won: z.boolean(),
  overbid: z.boolean(),
  value: z.number().int(),
  bid: z.number().int(),
  declarerPoints: z.number().int(),
  matadorsWith: z.boolean(),
  matadorsCount: z.number().int(),
  /** The skat, revealed to everyone once the deal is over. */
  skat: z.array(skatCardSchema),
})

const trickPlaySchema = z.object({ seat: z.number().int(), card: skatCardSchema })

export const skatStateSchema = z.object({
  phase: z.enum(SKAT_PHASES),
  gameNo: z.number().int(),
  seriesLength: z.number().int(),
  seats: z.array(skatSeatSchema),
  dealerSeat: z.number().int(),
  forehandSeat: z.number().int(),
  turnSeat: z.number().int().nullable(),
  /** Your place at the table; null = spectator. */
  yourSeat: z.number().int().nullable(),
  yourHand: z.array(skatCardSchema),
  bidding: skatBiddingSchema.nullable(),
  declarerSeat: z.number().int().nullable(),
  bid: z.number().int().nullable(),
  /** True once the declarer chose to play without the skat. */
  handGame: z.boolean(),
  contract: skatContractSchema.nullable(),
  /** The two skat cards — sent only to the declarer while discarding. */
  skatForYou: z.array(skatCardSchema).nullable(),
  trick: z.array(trickPlaySchema),
  lastTrick: z.object({ plays: z.array(trickPlaySchema), winnerSeat: z.number().int() }).nullable(),
  /** Declarer's exposed cards in an ouvert game. */
  ouvertCards: z.array(skatCardSchema).nullable(),
  result: skatResultSchema.nullable(),
  list: z.object({ rows: z.array(skatListRowSchema), totals: z.array(skatTotalsSchema) }),
})

const phasePayload = z.object({
  phase: phaseSchema,
  roundId: z.string(),
  /** ISO timestamp; present only while phase === 'betting'. */
  bettingEndsAt: z.string().nullable(),
})

/* ---------------------------------- server → client ---------------------------------- */

export const serverEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('table_snapshot'),
    payload: phasePayload.extend({
      you: z.object({ id: z.string(), nickname: z.string(), balance: z.number().int() }),
      players: z.array(playerPublicSchema),
      myBets: z.array(betSchema),
      betTotals: z.record(z.string(), z.number().int()),
      recentResults: z.array(recentResultSchema),
      lastNumber: z.number().int().min(0).max(36).nullable(),
      chatHistory: z.array(chatMessageSchema),
      table: tableMetaSchema,
    }),
  }),
  z.object({ type: z.literal('chat_message'), payload: chatMessageSchema }),
  z.object({
    type: z.literal('bj_snapshot'),
    payload: z.object({
      table: tableMetaSchema,
      you: z.object({ id: z.string(), nickname: z.string(), balance: z.number().int() }),
      players: z.array(playerPublicSchema),
      chatHistory: z.array(chatMessageSchema),
      phase: z.enum(BJ_PHASES),
      bettingEndsAt: z.string().nullable(),
      seats: z.array(bjSeatSchema),
      dealer: bjDealerSchema,
      turn: bjTurnSchema,
    }),
  }),
  z.object({
    type: z.literal('bj_phase'),
    payload: z.object({ phase: z.enum(BJ_PHASES), bettingEndsAt: z.string().nullable() }),
  }),
  z.object({
    type: z.literal('bj_bet_accepted'),
    payload: z.object({ bet: z.number().int(), balance: z.number().int() }),
  }),
  z.object({
    type: z.literal('bj_deal'),
    payload: z.object({ seats: z.array(bjSeatSchema), dealer: bjDealerSchema }),
  }),
  z.object({
    type: z.literal('bj_card'),
    payload: z.object({
      to: z.string(),
      card: cardSchema,
      total: z.number().int(),
      busted: z.boolean(),
      doubled: z.boolean().optional(),
    }),
  }),
  z.object({ type: z.literal('bj_turn'), payload: bjTurnSchema }),
  z.object({
    type: z.literal('bj_settled'),
    payload: z.object({
      seats: z.array(bjSeatSchema),
      dealer: bjDealerSchema,
      returned: z.number().int(),
      balance: z.number().int(),
    }),
  }),
  z.object({ type: z.literal('phase_changed'), payload: phasePayload }),
  z.object({
    type: z.literal('bet_accepted'),
    payload: z.object({ bet: betSchema, balance: z.number().int() }),
  }),
  z.object({
    type: z.literal('bet_rejected'),
    payload: z.object({ reason: z.string() }),
  }),
  z.object({
    type: z.literal('bets_cleared'),
    payload: z.object({ balance: z.number().int(), myBets: z.array(betSchema) }),
  }),
  z.object({
    type: z.literal('bet_totals'),
    payload: z.object({ betTotals: z.record(z.string(), z.number().int()) }),
  }),
  z.object({ type: z.literal('player_joined'), payload: z.object({ player: playerPublicSchema }) }),
  z.object({ type: z.literal('player_left'), payload: z.object({ playerId: z.string() }) }),
  z.object({
    type: z.literal('spin_result'),
    payload: z.object({
      roundId: z.string(),
      number: z.number().int().min(0).max(36),
      color: z.enum(['red', 'black', 'green']),
    }),
  }),
  z.object({
    type: z.literal('round_settled'),
    payload: z.object({
      roundId: z.string(),
      number: z.number().int().min(0).max(36),
      color: z.enum(['red', 'black', 'green']),
      /** Total returned to *this* player (stakes + winnings) — the frame is personalized. */
      returned: z.number().int(),
      balance: z.number().int(),
      recentResults: z.array(recentResultSchema),
    }),
  }),
  z.object({ type: z.literal('error'), payload: z.object({ message: z.string() }) }),
  z.object({
    type: z.literal('skat_state'),
    payload: skatStateSchema.extend({
      you: z.object({ id: z.string(), nickname: z.string(), balance: z.number().int() }).optional(),
      players: z.array(playerPublicSchema).optional(),
      chatHistory: z.array(chatMessageSchema).optional(),
      table: tableMetaSchema.optional(),
    }),
  }),
])

export type ServerEvent = z.infer<typeof serverEventSchema>
export type ServerEventType = ServerEvent['type']
export type TableSnapshot = Extract<ServerEvent, { type: 'table_snapshot' }>['payload']
export type Bet = z.infer<typeof betSchema>
export type RecentResult = z.infer<typeof recentResultSchema>
export type PlayerPublic = z.infer<typeof playerPublicSchema>
export type ChatMessage = z.infer<typeof chatMessageSchema>
export type TableMeta = z.infer<typeof tableMetaSchema>
export type BjPhase = (typeof BJ_PHASES)[number]
export type BjSeat = z.infer<typeof bjSeatSchema>
export type BjDealer = z.infer<typeof bjDealerSchema>
export type BjSnapshot = Extract<ServerEvent, { type: 'bj_snapshot' }>['payload']
export type SkatPhase = (typeof SKAT_PHASES)[number]
export type SkatSeatPublic = z.infer<typeof skatSeatSchema>
export type SkatBidding = z.infer<typeof skatBiddingSchema>
export type SkatListRow = z.infer<typeof skatListRowSchema>
export type SkatTotals = z.infer<typeof skatTotalsSchema>
export type SkatResult = z.infer<typeof skatResultSchema>
export type SkatState = z.infer<typeof skatStateSchema>
export type SkatSnapshot = Extract<ServerEvent, { type: 'skat_state' }>['payload']

/* ---------------------------------- client → server ---------------------------------- */

export const clientCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('place_bet'),
    payload: z.object({ spot: betSpotSchema, amount: z.number().int().positive().max(1000) }),
  }),
  z.object({ type: z.literal('undo_bet'), payload: z.object({}).default({}) }),
  z.object({ type: z.literal('clear_bets'), payload: z.object({}).default({}) }),
  z.object({
    type: z.literal('chat_send'),
    payload: z.object({ text: z.string().trim().min(1).max(200) }),
  }),
  z.object({
    type: z.literal('bj_bet'),
    payload: z.object({ amount: z.number().int().positive().max(1000) }),
  }),
  z.object({ type: z.literal('bj_clear'), payload: z.object({}).default({}) }),
  z.object({ type: z.literal('bj_hit'), payload: z.object({}).default({}) }),
  z.object({ type: z.literal('bj_stand'), payload: z.object({}).default({}) }),
  z.object({ type: z.literal('bj_double'), payload: z.object({}).default({}) }),
  z.object({
    type: z.literal('skat_bid'),
    payload: z.object({ action: z.enum(['bid', 'hold', 'pass']) }),
  }),
  z.object({ type: z.literal('skat_skat'), payload: z.object({ take: z.boolean() }) }),
  z.object({
    type: z.literal('skat_discard'),
    payload: z.object({ cards: z.array(skatCardSchema).length(2) }),
  }),
  z.object({
    type: z.literal('skat_declare'),
    payload: z.object({
      type: z.enum(['suit', 'grand', 'null']),
      trump: z.enum(SKAT_SUITS).nullable(),
      ouvert: z.boolean(),
      schneider: z.boolean(),
      schwarz: z.boolean(),
    }),
  }),
  z.object({ type: z.literal('skat_play'), payload: z.object({ card: skatCardSchema }) }),
  z.object({ type: z.literal('skat_next'), payload: z.object({}).default({}) }),
])

export type ClientCommand = z.infer<typeof clientCommandSchema>

/** Parse helpers — both return null on garbage instead of throwing mid-frame. */
export function parseServerEvent(raw: unknown): ServerEvent | null {
  const result = serverEventSchema.safeParse(raw)
  return result.success ? result.data : null
}

export function parseClientCommand(raw: unknown): ClientCommand | null {
  const result = clientCommandSchema.safeParse(raw)
  return result.success ? result.data : null
}
