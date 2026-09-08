import { randomInt } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import {
  buildShoe,
  dealerShouldDraw,
  handValue,
  isBlackjack,
  settleHand,
  type BjDealer,
  type BjPhase,
  type BjSeat,
  type Card,
  type ServerEvent,
} from '@rondo/protocol'
import type { Db } from '../db/index'
import { bjHands, users, type TableRow } from '../db/schema'
import type { GameEngine, Transport } from './transport'

const DURATIONS = {
  betting: 15_000,
  dealCadence: 380,
  decision: 12_000,
  dealerCadence: 700,
  result: 5_000,
} as const

const MAX_SEATS = 5

interface Seat {
  playerId: string
  nickname: string
  bet: number
  doubled: boolean
  cards: Card[]
  done: boolean
  outcome: BjSeat['outcome']
  returned: number
}

/**
 * Live multiplayer blackjack: one shared dealer, up to five seats per round
 * (placing a bet takes a seat), server-driven turn queue with a decision
 * clock. Money moves atomically in the DB exactly like on the roulette side.
 */
export class BlackjackEngine implements GameEngine {
  readonly game = 'blackjack' as const

  private phase: BjPhase = 'betting'
  private bettingEndsAt: Date | null = null
  private seats: Seat[] = []
  private dealerCards: Card[] = []
  private hidingHole = true
  private turn: { playerId: string; endsAt: Date } | null = null
  private shoe: Card[] = []
  private timer: NodeJS.Timeout | null = null
  private turnTimer: NodeJS.Timeout | null = null

  private broadcast: (event: ServerEvent) => void
  private sendTo: (playerId: string, event: ServerEvent) => void

  constructor(
    private readonly db: Db,
    public table: TableRow,
    transport: Transport,
  ) {
    this.broadcast = transport.broadcast
    this.sendTo = transport.sendTo
  }

  start() {
    this.startBetting()
  }

  stop() {
    if (this.timer) clearTimeout(this.timer)
    if (this.turnTimer) clearTimeout(this.turnTimer)
  }

  snapshot() {
    return {
      phase: this.phase,
      bettingEndsAt: this.bettingEndsAt?.toISOString() ?? null,
      seats: this.seats.map((seat) => this.publicSeat(seat)),
      dealer: this.publicDealer(),
      turn: this.turn ? { playerId: this.turn.playerId, endsAt: this.turn.endsAt.toISOString() } : null,
    }
  }

  /* -------------------------------- commands -------------------------------- */

  async placeBet(playerId: string, nickname: string, amount: number) {
    if (this.phase !== 'betting') return this.reject(playerId, 'Bets are closed')
    let seat = this.seats.find((candidate) => candidate.playerId === playerId)
    if (!seat && this.seats.length >= MAX_SEATS) return this.reject(playerId, 'Table is full')
    const current = seat?.bet ?? 0
    if (current + amount > this.table.maxStake) {
      return this.reject(playerId, `Table limit is $${this.table.maxStake}`)
    }
    if (current + amount < this.table.minStake) {
      return this.reject(playerId, `Minimum bet is $${this.table.minStake}`)
    }

    const balance = await this.debit(playerId, amount)
    if (balance === null) return this.reject(playerId, 'Not enough balance')

    if (!seat) {
      seat = { playerId, nickname, bet: 0, doubled: false, cards: [], done: false, outcome: null, returned: 0 }
      this.seats.push(seat)
    }
    seat.bet += amount
    this.sendTo(playerId, { type: 'bj_bet_accepted', payload: { bet: seat.bet, balance } })
    this.broadcastSeats()
  }

  async clearBet(playerId: string) {
    if (this.phase !== 'betting') return
    const seat = this.seats.find((candidate) => candidate.playerId === playerId)
    if (!seat || seat.bet === 0) return
    const balance = await this.credit(playerId, seat.bet)
    this.seats = this.seats.filter((candidate) => candidate !== seat)
    this.sendTo(playerId, { type: 'bj_bet_accepted', payload: { bet: 0, balance } })
    this.broadcastSeats()
  }

  async hit(playerId: string) {
    const seat = this.currentSeat(playerId)
    if (!seat) return
    this.dealCard(seat)
    const { total } = handValue(seat.cards)
    if (total >= 21) {
      seat.done = true
      this.advanceTurn()
    } else {
      this.armTurnClock(seat)
    }
  }

  async stand(playerId: string) {
    const seat = this.currentSeat(playerId)
    if (!seat) return
    seat.done = true
    this.advanceTurn()
  }

  async double(playerId: string) {
    const seat = this.currentSeat(playerId)
    if (!seat) return
    if (seat.cards.length !== 2 || seat.doubled) return this.reject(playerId, 'Double only on the first two cards')
    const balance = await this.debit(playerId, seat.bet)
    if (balance === null) return this.reject(playerId, 'Not enough balance to double')
    seat.bet *= 2
    seat.doubled = true
    this.dealCard(seat, true)
    seat.done = true
    this.sendTo(playerId, { type: 'bj_bet_accepted', payload: { bet: seat.bet, balance } })
    this.advanceTurn()
  }

  async dropPlayer(playerId: string) {
    if (this.phase === 'betting') await this.clearBet(playerId)
    // Mid-round the seat keeps playing; their turn will auto-stand on timeout.
  }

  /* ------------------------------- round loop ------------------------------- */

  private startBetting() {
    this.phase = 'betting'
    this.seats = []
    this.dealerCards = []
    this.hidingHole = true
    this.turn = null
    this.bettingEndsAt = new Date(Date.now() + DURATIONS.betting)
    this.emitPhase()
    this.after(DURATIONS.betting, () => this.deal())
  }

  private deal() {
    this.bettingEndsAt = null
    if (this.seats.length === 0) return this.startBetting()

    this.phase = 'dealing'
    this.emitPhase()
    if (this.shoe.length < 60) this.shoe = shuffle(buildShoe(6))

    // Card-by-card cadence: seat 1..n, dealer upcard, seat 1..n, silent hole.
    const sequence: (() => void)[] = []
    for (const seat of this.seats) sequence.push(() => this.dealCard(seat))
    sequence.push(() => {
      this.dealerCards.push(this.draw())
      this.broadcast({
        type: 'bj_card',
        payload: { to: 'dealer', card: this.dealerCards[0], total: handValue(this.dealerCards).total, busted: false },
      })
    })
    for (const seat of this.seats) sequence.push(() => this.dealCard(seat))
    sequence.push(() => {
      this.dealerCards.push(this.draw())
    })

    this.broadcast({
      type: 'bj_deal',
      payload: { seats: this.seats.map((seat) => this.publicSeat(seat)), dealer: this.publicDealer() },
    })
    const step = (index: number) => {
      if (index < sequence.length) {
        sequence[index]()
        this.after(DURATIONS.dealCadence, () => step(index + 1))
      } else {
        this.startActing()
      }
    }
    this.after(DURATIONS.dealCadence, () => step(0))
  }

  private startActing() {
    this.phase = 'acting'
    for (const seat of this.seats) {
      if (isBlackjack(seat.cards)) seat.done = true
    }
    this.emitPhase()
    this.advanceTurn()
  }

  private advanceTurn() {
    if (this.turnTimer) clearTimeout(this.turnTimer)
    const next = this.seats.find((seat) => !seat.done)
    if (!next) return this.playDealer()
    this.armTurnClock(next)
  }

  private armTurnClock(seat: Seat) {
    if (this.turnTimer) clearTimeout(this.turnTimer)
    this.turn = { playerId: seat.playerId, endsAt: new Date(Date.now() + DURATIONS.decision) }
    this.broadcast({
      type: 'bj_turn',
      payload: { playerId: seat.playerId, endsAt: this.turn.endsAt.toISOString() },
    })
    this.turnTimer = setTimeout(() => {
      seat.done = true
      this.advanceTurn()
    }, DURATIONS.decision)
  }

  private playDealer() {
    if (this.turnTimer) clearTimeout(this.turnTimer)
    this.turn = null
    this.phase = 'dealer'
    this.hidingHole = false
    this.emitPhase()
    this.broadcast({
      type: 'bj_deal',
      payload: { seats: this.seats.map((seat) => this.publicSeat(seat)), dealer: this.publicDealer() },
    })

    const anyoneStanding = this.seats.some((seat) => handValue(seat.cards).total <= 21)
    const drawNext = () => {
      if (anyoneStanding && dealerShouldDraw(this.dealerCards)) {
        const card = this.draw()
        this.dealerCards.push(card)
        const { total } = handValue(this.dealerCards)
        this.broadcast({ type: 'bj_card', payload: { to: 'dealer', card, total, busted: total > 21 } })
        this.after(DURATIONS.dealerCadence, drawNext)
      } else {
        this.after(600, () => void this.settle())
      }
    }
    this.after(DURATIONS.dealerCadence, drawNext)
  }

  private async settle() {
    this.phase = 'result'
    for (const seat of this.seats) {
      const { outcome, multiplier } = settleHand(seat.cards, this.dealerCards)
      seat.outcome = outcome
      seat.returned = Math.floor(seat.bet * multiplier)
    }

    await this.db.insert(bjHands).values(
      this.seats.map((seat) => ({
        tableId: this.table.id,
        playerId: seat.playerId,
        bet: seat.bet,
        playerCards: seat.cards,
        dealerCards: this.dealerCards,
        outcome: seat.outcome!,
        returned: seat.returned,
      })),
    )

    for (const seat of this.seats) {
      const balance = seat.returned > 0 ? await this.credit(seat.playerId, seat.returned) : await this.balanceOf(seat.playerId)
      this.sendTo(seat.playerId, {
        type: 'bj_settled',
        payload: {
          seats: this.seats.map((candidate) => this.publicSeat(candidate)),
          dealer: this.publicDealer(),
          returned: seat.returned,
          balance,
        },
      })
    }
    // Spectators still see the table resolve.
    this.broadcast({
      type: 'bj_deal',
      payload: { seats: this.seats.map((seat) => this.publicSeat(seat)), dealer: this.publicDealer() },
    })
    this.after(DURATIONS.result, () => this.startBetting())
  }

  /* --------------------------------- helpers --------------------------------- */

  private currentSeat(playerId: string): Seat | null {
    if (this.phase !== 'acting' || this.turn?.playerId !== playerId) return null
    const seat = this.seats.find((candidate) => candidate.playerId === playerId)
    return seat && !seat.done ? seat : null
  }

  private dealCard(seat: Seat, doubled = false) {
    const card = this.draw()
    seat.cards.push(card)
    const { total } = handValue(seat.cards)
    this.broadcast({
      type: 'bj_card',
      payload: { to: seat.playerId, card, total, busted: total > 21, doubled },
    })
  }

  private draw(): Card {
    return this.shoe.pop()!
  }

  private publicSeat(seat: Seat): BjSeat {
    const { total } = handValue(seat.cards)
    return {
      playerId: seat.playerId,
      nickname: seat.nickname,
      bet: seat.bet,
      doubled: seat.doubled,
      cards: seat.cards,
      total,
      busted: total > 21,
      blackjack: isBlackjack(seat.cards),
      done: seat.done,
      outcome: seat.outcome,
    }
  }

  private publicDealer(): BjDealer {
    const cards = this.hidingHole ? this.dealerCards.slice(0, 1) : this.dealerCards
    return { cards, total: handValue(cards).total, hiding: this.hidingHole }
  }

  private broadcastSeats() {
    this.broadcast({
      type: 'bj_deal',
      payload: { seats: this.seats.map((seat) => this.publicSeat(seat)), dealer: this.publicDealer() },
    })
  }

  private emitPhase() {
    this.broadcast({
      type: 'bj_phase',
      payload: { phase: this.phase, bettingEndsAt: this.bettingEndsAt?.toISOString() ?? null },
    })
  }

  private reject(playerId: string, reason: string) {
    this.sendTo(playerId, { type: 'bet_rejected', payload: { reason } })
  }

  private async debit(playerId: string, amount: number): Promise<number | null> {
    const [updated] = await this.db
      .update(users)
      .set({ balance: sql`${users.balance} - ${amount}` })
      .where(sql`${users.id} = ${playerId} and ${users.balance} >= ${amount}`)
      .returning({ balance: users.balance })
    return updated?.balance ?? null
  }

  private async credit(playerId: string, amount: number): Promise<number> {
    const [updated] = await this.db
      .update(users)
      .set({ balance: sql`${users.balance} + ${amount}` })
      .where(eq(users.id, playerId))
      .returning({ balance: users.balance })
    return updated?.balance ?? 0
  }

  private async balanceOf(playerId: string): Promise<number> {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, playerId) })
    return user?.balance ?? 0
  }

  private after(ms: number, fn: () => void) {
    this.timer = setTimeout(fn, ms)
  }
}

function shuffle(cards: Card[]): Card[] {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1)
    ;[cards[i], cards[j]] = [cards[j], cards[i]]
  }
  return cards
}
