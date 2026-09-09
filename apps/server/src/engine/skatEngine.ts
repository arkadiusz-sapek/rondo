import { randomInt } from 'node:crypto'
import {
  buildSkatDeck,
  contractLabel,
  countPoints,
  legalPlays,
  nextBidValue,
  nullValue,
  sameCard,
  settleSkatGame,
  trickWinner,
  matadors,
  GRAND_BASE,
  SUIT_BASE,
  type ServerEvent,
  type SkatBidding,
  type SkatCard,
  type SkatContract,
  type SkatListRow,
  type SkatPhase,
  type SkatResult,
  type SkatState,
  type SkatTotals,
} from '@rondo/protocol'
import type { TableRow } from '../db/schema'
import type { GameEngine, Transport } from './transport'
import { chooseDiscard, choosePlay, evaluateHand, type BotPlan } from './skatBot'

const SERIES_LENGTH = 36
const BOTS = [
  { id: 'bot:fritz', nickname: 'Fritz 🤖' },
  { id: 'bot:greta', nickname: 'Greta 🤖' },
]
const PACE = {
  deal: 1100,
  botMin: 700,
  botSpread: 800,
  trickHold: 1500,
  settled: 12_000,
} as const

interface Seat {
  seat: number
  playerId: string
  nickname: string
  isBot: boolean
  /** A disconnected human's seat — the bot brain plays it until they return. */
  autopilot: boolean
  hand: SkatCard[]
  tricksTaken: number
  pile: SkatCard[]
  botPlan: BotPlan | null
}

/**
 * One Skat table per ISkO: exactly three seats, the first human to join gets
 * seat 0 and two bots fill the rest, so the table is playable solo from the
 * first second. A 36-game series is scored on a Seeger-Fabian list. There is
 * no money at this table — the list is the score.
 */
export class SkatEngine implements GameEngine {
  readonly game = 'skat' as const

  private phase: SkatPhase = 'waiting'
  private seats: Seat[] = []
  private gameNo = 1
  private dealerSeat = 2
  private bidding: SkatBidding | null = null
  private stage: 1 | 2 | 3 = 1
  private declarerSeat: number | null = null
  private bid: number | null = null
  private handGame = false
  private contract: SkatContract | null = null
  private skat: SkatCard[] = []
  private skatPicked = false
  /** Declarer's 10 held cards + the 2 skat cards — the matador base. */
  private matCards: SkatCard[] = []
  private trick: { seat: number; card: SkatCard }[] = []
  private lastTrick: { plays: { seat: number; card: SkatCard }[]; winnerSeat: number } | null = null
  private turnSeat: number | null = null
  private played: SkatCard[] = []
  private result: SkatResult | null = null
  private rows: SkatListRow[] = []
  private humansOnline = new Set<string>()
  private everSeen = new Set<string>()
  private paused = false
  private phaseTimer: NodeJS.Timeout | null = null
  private botTimer: NodeJS.Timeout | null = null

  private sendTo: (playerId: string, event: ServerEvent) => void

  constructor(
    _db: unknown,
    public table: TableRow,
    transport: Transport,
  ) {
    this.sendTo = transport.sendTo
  }

  start() {}

  stop() {
    if (this.phaseTimer) clearTimeout(this.phaseTimer)
    if (this.botTimer) clearTimeout(this.botTimer)
  }

  /* ------------------------------ join / leave ------------------------------ */

  playerSeen(playerId: string, nickname: string) {
    this.everSeen.add(playerId)
    this.humansOnline.add(playerId)
    const seat = this.seats.find((candidate) => candidate.playerId === playerId)
    if (seat) {
      seat.autopilot = false
    } else if (this.seats.length === 0) {
      this.seats = [
        this.makeSeat(0, playerId, nickname, false),
        this.makeSeat(1, BOTS[0].id, BOTS[0].nickname, true),
        this.makeSeat(2, BOTS[1].id, BOTS[1].nickname, true),
      ]
      this.startGame()
      return
    }
    if (this.paused) {
      this.paused = false
      this.advanceGame()
      return
    }
    this.pushState()
  }

  dropPlayer(playerId: string) {
    this.humansOnline.delete(playerId)
    const seat = this.seats.find((candidate) => candidate.playerId === playerId)
    if (!seat || seat.isBot) return
    seat.autopilot = true
    this.scheduleBot()
    this.pushState()
  }

  private makeSeat(seat: number, playerId: string, nickname: string, isBot: boolean): Seat {
    return { seat, playerId, nickname, isBot, autopilot: false, hand: [], tricksTaken: 0, pile: [], botPlan: null }
  }

  /* ------------------------------- game loop -------------------------------- */

  private startGame() {
    this.phase = 'dealing'
    const deck = shuffle(buildSkatDeck())
    for (const seat of this.seats) {
      seat.hand = deck.splice(0, 10)
      seat.tricksTaken = 0
      seat.pile = []
      seat.botPlan = null
    }
    this.skat = deck.splice(0, 2)
    this.skatPicked = false
    this.handGame = false
    this.bidding = null
    this.declarerSeat = null
    this.bid = null
    this.contract = null
    this.matCards = []
    this.trick = []
    this.lastTrick = null
    this.turnSeat = null
    this.played = []
    this.result = null
    this.pushState()
    this.after(PACE.deal, () => this.startBidding())
  }

  private forehand() {
    return (this.dealerSeat + 1) % 3
  }

  private startBidding() {
    this.phase = 'bidding'
    this.stage = 1
    const middle = (this.dealerSeat + 2) % 3
    this.bidding = {
      speakerSeat: middle,
      listenerSeat: this.forehand(),
      level: null,
      awaiting: 'speak',
      lastAction: null,
    }
    this.turnSeat = middle
    this.pushState()
    this.scheduleBot()
  }

  handleBid(playerId: string, action: 'bid' | 'hold' | 'pass') {
    const seat = this.seatOf(playerId)
    if (!seat || this.phase !== 'bidding' || !this.bidding) return
    if (seat.seat !== this.turnSeat) return
    this.applyBid(seat.seat, action)
  }

  private applyBid(actor: number, action: 'bid' | 'hold' | 'pass') {
    const bidding = this.bidding!
    if (bidding.awaiting === 'speak') {
      if (action === 'bid') {
        const value = nextBidValue(bidding.level)
        bidding.level = value
        bidding.lastAction = { seat: actor, action: 'bid', value }
        if (this.stage === 3) return this.finishBidding(actor, value)
        bidding.awaiting = 'answer'
        this.turnSeat = bidding.listenerSeat
      } else {
        bidding.lastAction = { seat: actor, action: 'pass', value: null }
        this.speakerPassed()
      }
    } else {
      if (action === 'hold') {
        bidding.lastAction = { seat: actor, action: 'hold', value: bidding.level }
        bidding.awaiting = 'speak'
        this.turnSeat = bidding.speakerSeat
      } else {
        bidding.lastAction = { seat: actor, action: 'pass', value: null }
        this.listenerPassed()
      }
    }
    this.pushState()
    this.scheduleBot()
  }

  private speakerPassed() {
    const bidding = this.bidding!
    if (this.stage === 1) {
      this.toStageTwo(bidding.listenerSeat)
    } else if (this.stage === 2) {
      if (bidding.level !== null) return this.finishBidding(bidding.listenerSeat, bidding.level)
      this.toStageThree()
    } else {
      this.eingepasst()
    }
  }

  private listenerPassed() {
    const bidding = this.bidding!
    if (this.stage === 1) {
      this.toStageTwo(bidding.speakerSeat)
    } else {
      // Stage 2: the rearhand's bid stands.
      this.finishBidding(bidding.speakerSeat, bidding.level!)
    }
  }

  private toStageTwo(survivor: number) {
    this.stage = 2
    const rear = this.dealerSeat // 3-player table: the dealer is rearhand
    if (rear === survivor) return this.finishBidding(survivor, this.bidding!.level ?? 18)
    this.bidding = {
      speakerSeat: rear,
      listenerSeat: survivor,
      level: this.bidding!.level,
      awaiting: 'speak',
      lastAction: this.bidding!.lastAction,
    }
    this.turnSeat = rear
  }

  private toStageThree() {
    // Everyone passed without a number: forehand may take 18 or throw the deal in.
    this.stage = 3
    const forehand = this.forehand()
    this.bidding = {
      speakerSeat: forehand,
      listenerSeat: forehand,
      level: null,
      awaiting: 'speak',
      lastAction: this.bidding!.lastAction,
    }
    this.turnSeat = forehand
  }

  private finishBidding(declarer: number, level: number) {
    this.declarerSeat = declarer
    this.bid = level
    this.phase = 'skat_decision'
    this.turnSeat = declarer
    this.bidding = null
    this.pushState()
    this.scheduleBot()
  }

  private eingepasst() {
    this.rows.push({
      n: this.gameNo,
      declarerSeat: null,
      label: '—',
      value: 0,
      won: null,
      delta: 0,
      cumAfter: 0,
    })
    this.phase = 'settled'
    this.turnSeat = null
    this.bidding = null
    this.pushState()
    this.after(4000, () => this.advanceGame())
  }

  /* ------------------------- skat, discard, declare ------------------------- */

  handleSkat(playerId: string, take: boolean) {
    const seat = this.seatOf(playerId)
    if (!seat || this.phase !== 'skat_decision' || seat.seat !== this.declarerSeat) return
    if (take) {
      seat.hand = [...seat.hand, ...this.skat]
      this.skatPicked = true
      this.handGame = false
      this.phase = 'discarding'
    } else {
      this.handGame = true
      this.phase = 'declaring'
    }
    this.pushState()
    this.scheduleBot()
  }

  handleDiscard(playerId: string, cards: SkatCard[]) {
    const seat = this.seatOf(playerId)
    if (!seat || this.phase !== 'discarding' || seat.seat !== this.declarerSeat) return
    if (cards.length !== 2 || sameCard(cards[0], cards[1])) return
    const holds = cards.every((card) => seat.hand.some((held) => sameCard(held, card)))
    if (!holds) return this.reject(playerId, 'You do not hold those cards')
    seat.hand = seat.hand.filter((held) => !cards.some((card) => sameCard(card, held)))
    this.skat = cards
    this.phase = 'declaring'
    this.pushState()
    this.scheduleBot()
  }

  handleDeclare(
    playerId: string,
    input: { type: SkatContract['type']; trump: SkatCard['suit'] | null; ouvert: boolean; schneider: boolean; schwarz: boolean },
  ) {
    const seat = this.seatOf(playerId)
    if (!seat || this.phase !== 'declaring' || seat.seat !== this.declarerSeat) return
    if (input.type === 'suit' && !input.trump) return this.reject(playerId, 'Pick a trump suit')

    const contract: SkatContract = {
      type: input.type,
      trump: input.type === 'suit' ? input.trump : null,
      hand: this.handGame,
      ouvert: input.ouvert,
      schneiderAnnounced: false,
      schwarzAnnounced: false,
    }
    if (input.type === 'null') {
      const value = nullValue(contract)
      if (value < this.bid!) {
        return this.reject(playerId, `You bid ${this.bid} — Null is only worth ${value}`)
      }
    } else {
      if ((input.ouvert || input.schneider || input.schwarz) && !this.handGame) {
        return this.reject(playerId, 'Announcements need a hand game')
      }
      contract.schneiderAnnounced = input.schneider || input.schwarz || input.ouvert
      contract.schwarzAnnounced = input.schwarz || input.ouvert
    }

    this.contract = contract
    this.matCards = [...seat.hand, ...this.skat]
    this.phase = 'playing'
    this.turnSeat = this.forehand()
    this.trick = []
    this.lastTrick = null
    this.pushState()
    this.scheduleBot()
  }

  /* --------------------------------- playing --------------------------------- */

  handlePlay(playerId: string, card: SkatCard) {
    const seat = this.seatOf(playerId)
    if (!seat || this.phase !== 'playing' || seat.seat !== this.turnSeat || !this.contract) return
    if (!seat.hand.some((held) => sameCard(held, card))) return
    const legal = legalPlays(seat.hand, this.trick.map((play) => play.card), this.contract)
    if (!legal.some((candidate) => sameCard(candidate, card))) {
      return this.reject(playerId, 'You must follow suit')
    }
    seat.hand = seat.hand.filter((held) => !sameCard(held, card))
    this.trick.push({ seat: seat.seat, card })
    if (this.trick.length < 3) {
      this.turnSeat = (seat.seat + 1) % 3
      this.pushState()
      this.scheduleBot()
      return
    }
    // Full trick: let it sit on the table, then collect.
    this.turnSeat = null
    this.pushState()
    this.after(PACE.trickHold, () => this.collectTrick())
  }

  private collectTrick() {
    if (!this.contract) return
    const plays = this.trick
    const winnerIdx = trickWinner(plays.map((play) => play.card), this.contract)
    const winnerSeat = plays[winnerIdx].seat
    const winner = this.seats[winnerSeat]
    winner.pile.push(...plays.map((play) => play.card))
    winner.tricksTaken++
    this.played.push(...plays.map((play) => play.card))
    this.lastTrick = { plays, winnerSeat }
    this.trick = []

    const nullBroken = this.contract.type === 'null' && winnerSeat === this.declarerSeat
    const done = this.seats.every((seat) => seat.hand.length === 0)
    if (nullBroken || done) return this.settle()
    this.turnSeat = winnerSeat
    this.pushState()
    this.scheduleBot()
  }

  private settle() {
    const declarer = this.seats[this.declarerSeat!]
    const settle = settleSkatGame({
      contract: this.contract!,
      bid: this.bid!,
      declarerCardsWithSkat: this.matCards,
      declarerPoints: countPoints(declarer.pile) + countPoints(this.skat),
      declarerTricks: declarer.tricksTaken,
      totalTricks: 10,
    })
    const label = contractLabel(this.contract!)
    const cumBefore = this.rows
      .filter((row) => row.declarerSeat === declarer.seat)
      .reduce((sum, row) => sum + row.delta, 0)
    this.rows.push({
      n: this.gameNo,
      declarerSeat: declarer.seat,
      label,
      value: settle.value,
      won: settle.won,
      delta: settle.declarerScore,
      cumAfter: cumBefore + settle.declarerScore,
    })
    this.result = {
      declarerSeat: declarer.seat,
      contractLabel: label,
      won: settle.won,
      overbid: settle.overbid,
      value: settle.value,
      bid: this.bid!,
      declarerPoints: countPoints(declarer.pile) + countPoints(this.skat),
      matadorsWith: settle.matadors.with,
      matadorsCount: settle.matadors.count,
      skat: this.skat,
    }
    this.phase = 'settled'
    this.turnSeat = null
    this.pushState()
    this.after(PACE.settled, () => this.advanceGame())
  }

  handleNext(playerId: string) {
    const seat = this.seatOf(playerId)
    if (!seat) return
    if (this.phase === 'settled') {
      if (this.phaseTimer) clearTimeout(this.phaseTimer)
      this.advanceGame()
    } else if (this.phase === 'series_end') {
      this.rows = []
      this.gameNo = 1
      this.dealerSeat = (this.dealerSeat + 1) % 3
      this.startGame()
    }
  }

  private advanceGame() {
    if (this.humansOnline.size === 0) {
      // Nobody is watching — hold the table instead of grinding bot games.
      this.paused = true
      return
    }
    if (this.gameNo >= SERIES_LENGTH) {
      this.phase = 'series_end'
      this.turnSeat = null
      this.pushState()
      return
    }
    this.gameNo++
    this.dealerSeat = (this.dealerSeat + 1) % 3
    this.startGame()
  }

  /* ----------------------------------- bots ---------------------------------- */

  private scheduleBot() {
    if (this.botTimer) clearTimeout(this.botTimer)
    if (this.turnSeat === null) return
    const seat = this.seats[this.turnSeat]
    if (!seat || (!seat.isBot && !seat.autopilot)) return
    const delay = PACE.botMin + randomInt(0, PACE.botSpread)
    this.botTimer = setTimeout(() => this.botAct(seat), delay)
  }

  private botAct(seat: Seat) {
    if (this.turnSeat !== seat.seat || (!seat.isBot && !seat.autopilot)) return
    switch (this.phase) {
      case 'bidding': {
        const bidding = this.bidding!
        const plan = evaluateHand(seat.hand)
        seat.botPlan = plan
        if (bidding.awaiting === 'speak') {
          const value = nextBidValue(bidding.level)
          this.applyBid(seat.seat, value <= plan.maxBid ? 'bid' : 'pass')
        } else {
          this.applyBid(seat.seat, (bidding.level ?? 0) <= plan.maxBid ? 'hold' : 'pass')
        }
        return
      }
      case 'skat_decision':
        return this.handleSkat(seat.playerId, true)
      case 'discarding': {
        const plan = evaluateHand(seat.hand)
        seat.botPlan = plan.maxBid > 0 ? plan : (seat.botPlan ?? plan)
        return this.handleDiscard(seat.playerId, chooseDiscard(seat.hand, seat.botPlan!))
      }
      case 'declaring': {
        const plan = seat.botPlan ?? evaluateHand(seat.hand)
        const pick = this.botContractCoveringBid(seat, plan)
        return this.handleDeclare(seat.playerId, {
          type: pick.type,
          trump: pick.trump,
          ouvert: false,
          schneider: false,
          schwarz: false,
        })
      }
      case 'playing': {
        const card = choosePlay({
          hand: seat.hand,
          trick: this.trick,
          contract: this.contract!,
          mySeat: seat.seat,
          declarerSeat: this.declarerSeat!,
          played: this.played,
        })
        return this.handlePlay(seat.playerId, card)
      }
    }
  }

  /** The bot knows its 10 cards + the discarded skat — pick a game that covers the bid. */
  private botContractCoveringBid(seat: Seat, plan: BotPlan): BotPlan {
    const bid = this.bid ?? 18
    const withSkat = [...seat.hand, ...this.skat]
    const valueOf = (type: 'suit' | 'grand', trump: SkatCard['suit'] | null) => {
      const spitzen = matadors(withSkat, { type, trump })
      const base = type === 'grand' ? GRAND_BASE : SUIT_BASE[trump!]
      return base * (spitzen.count + 1 + (this.handGame ? 1 : 0))
    }
    if (plan.type === 'null') {
      if (nullValue({ hand: this.handGame, ouvert: false }) >= bid) return plan
    } else if (valueOf(plan.type, plan.trump) >= bid) {
      return plan
    }
    // The planned game would overbid — look for any contract that covers the bid.
    const options: BotPlan[] = (['♣', '♠', '♥', '♦'] as const)
      .map<BotPlan>((trump) => ({ type: 'suit', trump, maxBid: valueOf('suit', trump) }))
      .concat([{ type: 'grand', trump: null, maxBid: valueOf('grand', null) }])
      .filter((option) => option.maxBid >= bid)
      .sort((a, b) => {
        const strength = (option: BotPlan) =>
          seat.hand.filter((card) => card.rank === 'J' || card.suit === option.trump).length
        return strength(b) - strength(a)
      })
    return options[0] ?? plan
  }

  /* --------------------------------- snapshot --------------------------------- */

  snapshotFor(playerId: string): SkatState {
    const seat = this.seats.find((candidate) => candidate.playerId === playerId)
    const isDeclarer = seat && seat.seat === this.declarerSeat
    const declarer = this.declarerSeat !== null ? this.seats[this.declarerSeat] : null
    return {
      phase: this.phase,
      gameNo: this.gameNo,
      seriesLength: SERIES_LENGTH,
      seats: this.seats.map((entry) => ({
        seat: entry.seat,
        playerId: entry.playerId,
        nickname: entry.nickname,
        isBot: entry.isBot,
        cardCount: entry.hand.length,
        tricksTaken: entry.tricksTaken,
      })),
      dealerSeat: this.dealerSeat,
      forehandSeat: this.forehand(),
      turnSeat: this.turnSeat,
      yourSeat: seat?.seat ?? null,
      yourHand: seat?.hand ?? [],
      bidding: this.bidding,
      declarerSeat: this.declarerSeat,
      bid: this.bid,
      handGame: this.handGame,
      contract: this.contract,
      skatForYou: isDeclarer && this.phase === 'discarding' ? this.skat : null,
      trick: this.trick,
      lastTrick: this.lastTrick,
      ouvertCards: this.contract?.ouvert && declarer && this.phase === 'playing' ? declarer.hand : null,
      result: this.result,
      list: { rows: this.rows, totals: this.totals() },
    }
  }

  private totals(): SkatTotals[] {
    return [0, 1, 2].map((seat) => {
      const mine = this.rows.filter((row) => row.declarerSeat === seat)
      const cum = mine.reduce((sum, row) => sum + row.delta, 0)
      const won = mine.filter((row) => row.won === true).length
      const lost = mine.filter((row) => row.won === false).length
      const othersLost = this.rows.filter(
        (row) => row.declarerSeat !== null && row.declarerSeat !== seat && row.won === false,
      ).length
      return { cum, won, lost, defenderBonus: 40 * othersLost, final: cum + 40 * othersLost }
    })
  }

  private pushState() {
    for (const playerId of this.everSeen) {
      this.sendTo(playerId, { type: 'skat_state', payload: this.snapshotFor(playerId) })
    }
  }

  /* --------------------------------- helpers --------------------------------- */

  private seatOf(playerId: string): Seat | undefined {
    return this.seats.find((candidate) => candidate.playerId === playerId)
  }

  private reject(playerId: string, message: string) {
    this.sendTo(playerId, { type: 'error', payload: { message } })
  }

  private after(ms: number, fn: () => void) {
    if (this.phaseTimer) clearTimeout(this.phaseTimer)
    this.phaseTimer = setTimeout(fn, ms)
  }
}

function shuffle(cards: SkatCard[]): SkatCard[] {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1)
    ;[cards[i], cards[j]] = [cards[j], cards[i]]
  }
  return cards
}
