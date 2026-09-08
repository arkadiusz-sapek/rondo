import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { randomInt, randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import {
  colorOf,
  parseBetSpot,
  settleBet,
  type Bet,
  type Phase,
  type RecentResult,
  type ServerEvent,
} from '@rondo/protocol'
import { DB } from '../db/db.module'
import type { Db } from '../db/index'
import { bets, players, rounds } from '../db/schema'

/** Phase lengths in ms — one full cycle ≈ 30s, close to live-table pacing. */
const DURATIONS = {
  betting: 18_000,
  betsClosed: 1_500,
  spinning: 6_000,
  spinRevealAfter: 1_000,
  result: 5_000,
} as const

const MAX_TOTAL_BET = 500

interface PendingBet extends Bet {
  playerId: string
}

/**
 * The authoritative table. Exactly one round loop runs on the server; clients
 * only ever mirror it. Balances move in the DB at bet/refund/settle time so a
 * server restart can never mint or burn money.
 */
@Injectable()
export class EngineService implements OnModuleInit, OnModuleDestroy {
  private phase: Phase = 'betting'
  private roundId = randomUUID()
  private bettingEndsAt: Date | null = null
  private drawnNumber: number | null = null
  private lastNumber: number | null = null
  private pendingBets: PendingBet[] = []
  private recentResults: RecentResult[] = []
  private timer: NodeJS.Timeout | null = null

  private broadcast: (event: ServerEvent) => void = () => {}
  private sendTo: (playerId: string, event: ServerEvent) => void = () => {}

  constructor(@Inject(DB) private readonly db: Db) {}

  /** WsService plugs the transport in before the first tick needs it. */
  setTransport(transport: {
    broadcast: (event: ServerEvent) => void
    sendTo: (playerId: string, event: ServerEvent) => void
  }) {
    this.broadcast = transport.broadcast
    this.sendTo = transport.sendTo
  }

  async onModuleInit() {
    const recent = await this.db
      .select()
      .from(rounds)
      .orderBy(sql`${rounds.settledAt} desc`)
      .limit(12)
    this.recentResults = recent.map((round) => ({
      roundId: round.id,
      number: round.number,
      color: colorOf(round.number),
    }))
    this.lastNumber = this.recentResults[0]?.number ?? null
    this.startBetting()
  }

  onModuleDestroy() {
    if (this.timer) clearTimeout(this.timer)
  }

  snapshotFor(you: { id: string; nickname: string; balance: number }) {
    return {
      phase: this.phase,
      roundId: this.roundId,
      bettingEndsAt: this.bettingEndsAt?.toISOString() ?? null,
      you,
      myBets: this.pendingBets
        .filter((bet) => bet.playerId === you.id)
        .map(({ id, spot, amount }) => ({ id, spot, amount })),
      betTotals: this.betTotals(),
      recentResults: this.recentResults,
      lastNumber: this.lastNumber,
    }
  }

  /* ------------------------------- commands ------------------------------- */

  async placeBet(playerId: string, rawSpot: string, amount: number) {
    if (this.phase !== 'betting') {
      return this.sendTo(playerId, reject('Bets are closed'))
    }
    const spot = parseBetSpot(rawSpot)
    if (!spot) return this.sendTo(playerId, reject('Unknown bet spot'))

    const myTotal = this.pendingBets
      .filter((bet) => bet.playerId === playerId)
      .reduce((sum, bet) => sum + bet.amount, 0)
    if (myTotal + amount > MAX_TOTAL_BET) {
      return this.sendTo(playerId, reject(`Table limit is $${MAX_TOTAL_BET} per round`))
    }

    // Atomic escrow: only succeeds when the balance actually covers the stake.
    const [updated] = await this.db
      .update(players)
      .set({ balance: sql`${players.balance} - ${amount}` })
      .where(sql`${players.id} = ${playerId} and ${players.balance} >= ${amount}`)
      .returning({ balance: players.balance })
    if (!updated) return this.sendTo(playerId, reject('Not enough balance'))

    const bet: PendingBet = { id: randomUUID(), playerId, spot, amount }
    this.pendingBets.push(bet)
    this.sendTo(playerId, {
      type: 'bet_accepted',
      payload: { bet: { id: bet.id, spot: bet.spot, amount: bet.amount }, balance: updated.balance },
    })
    this.broadcast({ type: 'bet_totals', payload: { betTotals: this.betTotals() } })
  }

  async undoBet(playerId: string) {
    if (this.phase !== 'betting') return
    const index = this.pendingBets.findLastIndex((bet) => bet.playerId === playerId)
    if (index === -1) return
    const [removed] = this.pendingBets.splice(index, 1)
    await this.refund(playerId, removed.amount)
  }

  async clearBets(playerId: string) {
    if (this.phase !== 'betting') return
    const mine = this.pendingBets.filter((bet) => bet.playerId === playerId)
    if (mine.length === 0) return
    this.pendingBets = this.pendingBets.filter((bet) => bet.playerId !== playerId)
    await this.refund(playerId, mine.reduce((sum, bet) => sum + bet.amount, 0))
  }

  /** Refund a disconnecting player's open bets so money never leaks mid-round. */
  async dropPlayer(playerId: string) {
    if (this.phase === 'betting') await this.clearBets(playerId)
  }

  private async refund(playerId: string, amount: number) {
    const [updated] = await this.db
      .update(players)
      .set({ balance: sql`${players.balance} + ${amount}` })
      .where(eq(players.id, playerId))
      .returning({ balance: players.balance })
    if (updated) {
      const myBets = this.pendingBets
        .filter((bet) => bet.playerId === playerId)
        .map(({ id, spot, amount }) => ({ id, spot, amount }))
      this.sendTo(playerId, { type: 'bets_cleared', payload: { balance: updated.balance, myBets } })
    }
    this.broadcast({ type: 'bet_totals', payload: { betTotals: this.betTotals() } })
  }

  /* ------------------------------- round loop ------------------------------- */

  private startBetting() {
    this.phase = 'betting'
    this.roundId = randomUUID()
    this.drawnNumber = null
    this.pendingBets = []
    this.bettingEndsAt = new Date(Date.now() + DURATIONS.betting)
    this.emitPhase()
    this.after(DURATIONS.betting, () => this.closeBets())
  }

  private closeBets() {
    this.phase = 'bets_closed'
    this.bettingEndsAt = null
    this.emitPhase()
    this.after(DURATIONS.betsClosed, () => this.spin())
  }

  private spin() {
    this.phase = 'spinning'
    this.drawnNumber = randomInt(0, 37)
    this.emitPhase()
    // The result is revealed shortly after the wheel starts, so every client
    // has time to ease the ball into the winning pocket before settlement.
    this.after(DURATIONS.spinRevealAfter, () => {
      this.broadcast({
        type: 'spin_result',
        payload: {
          roundId: this.roundId,
          number: this.drawnNumber!,
          color: colorOf(this.drawnNumber!),
        },
      })
      this.after(DURATIONS.spinning - DURATIONS.spinRevealAfter, () => this.settle())
    })
  }

  private async settle() {
    const number = this.drawnNumber!
    const roundId = this.roundId
    const color = colorOf(number)
    this.phase = 'result'
    this.lastNumber = number

    this.recentResults = [{ roundId, number, color }, ...this.recentResults].slice(0, 12)

    await this.db.insert(rounds).values({ id: roundId, number })
    if (this.pendingBets.length > 0) {
      await this.db.insert(bets).values(
        this.pendingBets.map((bet) => ({
          id: bet.id,
          roundId,
          playerId: bet.playerId,
          spot: bet.spot,
          amount: bet.amount,
          returned: settleBet(bet.spot as never, bet.amount, number),
        })),
      )
    }

    const byPlayer = new Map<string, number>()
    for (const bet of this.pendingBets) {
      const returned = settleBet(bet.spot as never, bet.amount, number)
      byPlayer.set(bet.playerId, (byPlayer.get(bet.playerId) ?? 0) + returned)
    }

    for (const [playerId, returned] of byPlayer) {
      const [updated] = await this.db
        .update(players)
        .set({ balance: sql`${players.balance} + ${returned}` })
        .where(eq(players.id, playerId))
        .returning({ balance: players.balance })
      this.sendTo(playerId, {
        type: 'round_settled',
        payload: {
          roundId,
          number,
          color,
          returned,
          balance: updated?.balance ?? 0,
          recentResults: this.recentResults,
        },
      })
    }
    // Spectators still need the result strip and the phase flip.
    this.broadcast({
      type: 'phase_changed',
      payload: { phase: 'result', roundId, bettingEndsAt: null },
    })

    this.after(DURATIONS.result, () => this.startBetting())
  }

  private emitPhase() {
    this.broadcast({
      type: 'phase_changed',
      payload: {
        phase: this.phase,
        roundId: this.roundId,
        bettingEndsAt: this.bettingEndsAt?.toISOString() ?? null,
      },
    })
  }

  private betTotals(): Record<string, number> {
    const totals: Record<string, number> = {}
    for (const bet of this.pendingBets) {
      totals[bet.spot] = (totals[bet.spot] ?? 0) + bet.amount
    }
    return totals
  }

  private after(ms: number, fn: () => void) {
    this.timer = setTimeout(fn, ms)
  }
}

function reject(reason: string): ServerEvent {
  return { type: 'bet_rejected', payload: { reason } }
}
