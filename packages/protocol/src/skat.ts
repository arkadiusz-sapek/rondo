/**
 * Pure Skat rules per the International Skat Order (ISkO 1998 / PZSkat) —
 * shared by the server engine and the client (legal-move hints, value
 * preview, hand sorting), unit-tested once.
 *
 * 32 cards, three players. Suit games (trumps: 4 jacks + a suit), grand
 * (jacks only) and null (no trumps, declarer must lose every trick).
 * Tournament scoring is Seeger-Fabian for a 3-seat table.
 */

export const SKAT_SUITS = ['♣', '♠', '♥', '♦'] as const
export const SKAT_RANKS = ['A', '10', 'K', 'Q', 'J', '9', '8', '7'] as const

export type SkatSuit = (typeof SKAT_SUITS)[number]
export type SkatRank = (typeof SKAT_RANKS)[number]

export interface SkatCard {
  suit: SkatSuit
  rank: SkatRank
}

export type SkatGameType = 'suit' | 'grand' | 'null'

export interface SkatContract {
  type: SkatGameType
  /** Trump suit — only for type 'suit'. */
  trump: SkatSuit | null
  hand: boolean
  ouvert: boolean
  schneiderAnnounced: boolean
  schwarzAnnounced: boolean
}

const POINTS: Record<SkatRank, number> = { A: 11, '10': 10, K: 4, Q: 3, J: 2, '9': 0, '8': 0, '7': 0 }

export function cardPoints(card: SkatCard): number {
  return POINTS[card.rank]
}

export function countPoints(cards: SkatCard[]): number {
  return cards.reduce((sum, card) => sum + cardPoints(card), 0)
}

export function buildSkatDeck(): SkatCard[] {
  const deck: SkatCard[] = []
  for (const suit of SKAT_SUITS) {
    for (const rank of SKAT_RANKS) deck.push({ suit, rank })
  }
  return deck
}

export function cardKey(card: SkatCard): string {
  return `${card.suit}${card.rank}`
}

export function sameCard(a: SkatCard, b: SkatCard): boolean {
  return a.suit === b.suit && a.rank === b.rank
}

/* --------------------------------- values --------------------------------- */

export const SUIT_BASE: Record<SkatSuit, number> = { '♦': 9, '♥': 10, '♠': 11, '♣': 12 }
export const GRAND_BASE = 24

export function nullValue(contract: Pick<SkatContract, 'hand' | 'ouvert'>): number {
  if (contract.hand && contract.ouvert) return 59
  if (contract.ouvert) return 46
  if (contract.hand) return 35
  return 23
}

/** Every legal bid = some possible game value; the auction walks this list. */
export const BID_VALUES: number[] = (() => {
  const values = new Set<number>([23, 35, 46, 59])
  for (const base of [9, 10, 11, 12]) {
    for (let mult = 2; mult <= 18; mult++) values.add(base * mult)
  }
  for (let mult = 2; mult <= 11; mult++) values.add(GRAND_BASE * mult)
  return [...values].filter((value) => value >= 18).sort((a, b) => a - b)
})()

export function nextBidValue(after: number | null): number {
  const floor = after ?? 0
  return BID_VALUES.find((value) => value > floor) ?? BID_VALUES[BID_VALUES.length - 1]
}

/* ------------------------------- card order ------------------------------- */

/** ♣J is the strongest card of every suit and grand game. */
const JACK_ORDER: Record<SkatSuit, number> = { '♣': 3, '♠': 2, '♥': 1, '♦': 0 }
const PLAIN_ORDER: Record<SkatRank, number> = { A: 7, '10': 6, K: 5, Q: 4, J: 0, '9': 3, '8': 2, '7': 1 }
const NULL_ORDER: Record<SkatRank, number> = { A: 8, K: 7, Q: 6, J: 5, '10': 4, '9': 3, '8': 2, '7': 1 }

export function isTrump(card: SkatCard, contract: SkatContract): boolean {
  if (contract.type === 'null') return false
  if (card.rank === 'J') return true
  return contract.type === 'suit' && card.suit === contract.trump
}

/** The suit a card belongs to for following purposes (jacks are trumps, not their pips). */
function effectiveSuit(card: SkatCard, contract: SkatContract): SkatSuit | 'trump' {
  return isTrump(card, contract) ? 'trump' : card.suit
}

function strength(card: SkatCard, contract: SkatContract): number {
  if (contract.type === 'null') return NULL_ORDER[card.rank]
  if (card.rank === 'J') return 100 + JACK_ORDER[card.suit]
  if (isTrump(card, contract)) return 50 + PLAIN_ORDER[card.rank]
  return PLAIN_ORDER[card.rank]
}

/** Index (0..plays.length-1, relative to the leader) of the winning card. */
export function trickWinner(plays: SkatCard[], contract: SkatContract): number {
  let winner = 0
  for (let i = 1; i < plays.length; i++) {
    const lead = plays[winner]
    const challenger = plays[i]
    const leadSuit = effectiveSuit(lead, contract)
    const challengerSuit = effectiveSuit(challenger, contract)
    if (challengerSuit === leadSuit) {
      if (strength(challenger, contract) > strength(lead, contract)) winner = i
    } else if (challengerSuit === 'trump') {
      winner = i
    }
  }
  return winner
}

export function legalPlays(hand: SkatCard[], trick: SkatCard[], contract: SkatContract): SkatCard[] {
  if (trick.length === 0) return hand
  const led = effectiveSuit(trick[0], contract)
  const following = hand.filter((card) => effectiveSuit(card, contract) === led)
  return following.length > 0 ? following : hand
}

/* -------------------------------- matadors -------------------------------- */

/**
 * "With n" / "without n": the unbroken run of top trumps starting at ♣J,
 * counted over the declarer's 10 cards PLUS the skat — even in hand games,
 * where the skat is unknown until the deal is over.
 */
export function matadors(
  cards: SkatCard[],
  contract: Pick<SkatContract, 'type' | 'trump'>,
): { with: boolean; count: number } {
  const sequence: string[] = ['♣J', '♠J', '♥J', '♦J']
  if (contract.type === 'suit' && contract.trump) {
    for (const rank of ['A', '10', 'K', 'Q', '9', '8', '7'] as const) {
      sequence.push(`${contract.trump}${rank}`)
    }
  }
  const held = new Set(cards.map(cardKey))
  const withTop = held.has(sequence[0])
  let count = 0
  for (const key of sequence) {
    if (held.has(key) === withTop) count++
    else break
  }
  return { with: withTop, count }
}

/* ------------------------------- game value ------------------------------- */

export interface Achieved {
  schneider: boolean
  schwarz: boolean
}

/** Suit/grand multiplier per ISkO: matadors + game, then one step per level. */
export function gameValue(contract: SkatContract, matadorCount: number, achieved: Achieved): number {
  if (contract.type === 'null') return nullValue(contract)
  const base = contract.type === 'grand' ? GRAND_BASE : SUIT_BASE[contract.trump!]
  let mult = matadorCount + 1
  if (contract.hand) mult++
  if (achieved.schneider || contract.schneiderAnnounced) mult++
  if (contract.schneiderAnnounced) mult++
  if (achieved.schwarz || contract.schwarzAnnounced) mult++
  if (contract.schwarzAnnounced) mult++
  if (contract.ouvert) mult++
  return base * mult
}

/* -------------------------------- settlement ------------------------------- */

export interface SkatSettleInput {
  contract: SkatContract
  bid: number
  /** Declarer's 10 cards + the 2 skat cards (matadors are counted over all 12). */
  declarerCardsWithSkat: SkatCard[]
  /** Card points in the declarer's pile INCLUDING the skat. */
  declarerPoints: number
  declarerTricks: number
  totalTricks: number
}

export interface SkatSettleResult {
  won: boolean
  overbid: boolean
  /** Final game value (overbid games are raised to cover the bid). */
  value: number
  matadors: { with: boolean; count: number }
  achieved: Achieved
  /** Seeger-Fabian, 3-seat table: declarer ±(value+50)... defenders +40 on a loss. */
  declarerScore: number
  defenderScore: number
}

export function settleSkatGame(input: SkatSettleInput): SkatSettleResult {
  const { contract, bid } = input
  const spitzen = matadors(input.declarerCardsWithSkat, contract)

  if (contract.type === 'null') {
    const value = nullValue(contract)
    const won = input.declarerTricks === 0 && value >= bid
    return {
      won,
      overbid: value < bid,
      value,
      matadors: spitzen,
      achieved: { schneider: false, schwarz: false },
      declarerScore: won ? value + 50 : -(2 * value + 50),
      defenderScore: won ? 0 : 40,
    }
  }

  const achieved: Achieved = {
    schneider: input.declarerPoints >= 90 || input.declarerPoints <= 30,
    schwarz: input.declarerTricks === input.totalTricks || input.declarerTricks === 0,
  }
  let value = gameValue(contract, spitzen.count, achieved)
  const overbid = value < bid
  let won =
    !overbid &&
    input.declarerPoints >= 61 &&
    (!contract.schneiderAnnounced || input.declarerPoints >= 90) &&
    (!contract.schwarzAnnounced || input.declarerTricks === input.totalTricks) &&
    (!contract.ouvert || input.declarerTricks === input.totalTricks)
  if (overbid) {
    // Lost at the smallest multiple of the base that covers the bid.
    const base = contract.type === 'grand' ? GRAND_BASE : SUIT_BASE[contract.trump!]
    value = Math.ceil(bid / base) * base
    won = false
  }
  return {
    won,
    overbid,
    value,
    matadors: spitzen,
    achieved,
    declarerScore: won ? value + 50 : -(2 * value + 50),
    defenderScore: won ? 0 : 40,
  }
}

/* --------------------------------- display --------------------------------- */

/** Sort a hand for display: jacks first, then suits (trump first), null = natural. */
export function sortSkatHand(hand: SkatCard[], contract: SkatContract | null): SkatCard[] {
  const suitLoop: SkatSuit[] = ['♣', '♥', '♠', '♦']
  if (contract?.type === 'null') {
    return [...hand].sort((a, b) => {
      const suitDiff = suitLoop.indexOf(a.suit) - suitLoop.indexOf(b.suit)
      return suitDiff !== 0 ? suitDiff : NULL_ORDER[b.rank] - NULL_ORDER[a.rank]
    })
  }
  const trump = contract?.type === 'suit' ? contract.trump : null
  const suits = trump ? [trump, ...suitLoop.filter((suit) => suit !== trump)] : suitLoop
  return [...hand].sort((a, b) => {
    const aJack = a.rank === 'J' ? 1 : 0
    const bJack = b.rank === 'J' ? 1 : 0
    if (aJack !== bJack) return bJack - aJack
    if (aJack) return JACK_ORDER[b.suit] - JACK_ORDER[a.suit]
    const suitDiff = suits.indexOf(a.suit) - suits.indexOf(b.suit)
    return suitDiff !== 0 ? suitDiff : PLAIN_ORDER[b.rank] - PLAIN_ORDER[a.rank]
  })
}

export function contractLabel(contract: SkatContract): string {
  const name =
    contract.type === 'grand' ? 'Grand' : contract.type === 'null' ? 'Null' : contract.trump!
  const extras = [
    contract.hand ? 'Hand' : '',
    contract.ouvert ? 'Ouvert' : '',
    contract.schwarzAnnounced && !contract.ouvert ? 'Schwarz' : '',
    contract.schneiderAnnounced && !contract.schwarzAnnounced ? 'Schneider' : '',
  ].filter(Boolean)
  return extras.length > 0 ? `${name} ${extras.join(' ')}` : name
}
