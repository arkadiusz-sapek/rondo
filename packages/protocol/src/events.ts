import { z } from 'zod'

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
])

export type ServerEvent = z.infer<typeof serverEventSchema>
export type ServerEventType = ServerEvent['type']
export type TableSnapshot = Extract<ServerEvent, { type: 'table_snapshot' }>['payload']
export type Bet = z.infer<typeof betSchema>
export type RecentResult = z.infer<typeof recentResultSchema>
export type PlayerPublic = z.infer<typeof playerPublicSchema>

/* ---------------------------------- client → server ---------------------------------- */

export const clientCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('place_bet'),
    payload: z.object({ spot: betSpotSchema, amount: z.number().int().positive().max(1000) }),
  }),
  z.object({ type: z.literal('undo_bet'), payload: z.object({}).default({}) }),
  z.object({ type: z.literal('clear_bets'), payload: z.object({}).default({}) }),
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
