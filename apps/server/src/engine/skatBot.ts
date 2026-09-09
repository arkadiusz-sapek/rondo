import {
  BID_VALUES,
  GRAND_BASE,
  SUIT_BASE,
  cardKey,
  cardPoints,
  isTrump,
  legalPlays,
  matadors,
  nullValue,
  trickWinner,
  type SkatCard,
  type SkatContract,
  type SkatGameType,
  type SkatSuit,
} from '@rondo/protocol'

/**
 * Club-level heuristics, not a solver. The bots are fair: they see their own
 * hand plus every card already played, never the hidden hands or the skat.
 */

export interface BotPlan {
  type: SkatGameType
  trump: SkatSuit | null
  maxBid: number
}

const SUITS: SkatSuit[] = ['♣', '♠', '♥', '♦']

const jacks = (hand: SkatCard[]) => hand.filter((card) => card.rank === 'J')
const ofSuit = (hand: SkatCard[], suit: SkatSuit) =>
  hand.filter((card) => card.suit === suit && card.rank !== 'J')

/** Evaluate a hand (10 or 12 cards) into the most promising contract + a bid cap. */
export function evaluateHand(hand: SkatCard[]): BotPlan {
  const jackCount = jacks(hand).length
  const aces = hand.filter((card) => card.rank === 'A').length
  let best: BotPlan = { type: 'suit', trump: null, maxBid: 0 }

  for (const suit of SUITS) {
    const trumps = jackCount + ofSuit(hand, suit).length
    const playable =
      trumps >= 5 || (trumps === 4 && jackCount >= 2 && aces >= 2)
    if (!playable) continue
    const spitzen = matadors(hand, { type: 'suit', trump: suit })
    // "Without n" can shrink when the skat holds a missing jack — bid one level shy.
    const assumed = spitzen.with ? spitzen.count : Math.max(1, spitzen.count - 1)
    const maxBid = SUIT_BASE[suit] * (assumed + 1)
    if (maxBid > best.maxBid) best = { type: 'suit', trump: suit, maxBid }
  }

  const grandFit = jackCount >= 3 || (jackCount === 2 && jacks(hand).some((j) => j.suit === '♣') && aces >= 3)
  if (grandFit) {
    const spitzen = matadors(hand, { type: 'grand', trump: null })
    const assumed = spitzen.with ? spitzen.count : Math.max(1, spitzen.count - 1)
    const maxBid = GRAND_BASE * (assumed + 1)
    if (maxBid > best.maxBid) best = { type: 'grand', trump: null, maxBid }
  }

  if (best.maxBid === 0 && isNullSafe(hand)) {
    best = { type: 'null', trump: null, maxBid: 23 }
  }
  if (best.type === 'suit' && best.trump === null) {
    // Nothing playable, but the bot may still have won the auction — fall back
    // to its longest suit so downstream code always has a real trump.
    let fallback: SkatSuit = '♣'
    let most = -1
    for (const suit of SUITS) {
      const count = jackCount + ofSuit(hand, suit).length
      if (count > most) {
        most = count
        fallback = suit
      }
    }
    best = { ...best, trump: fallback }
  }
  return best
}

function isNullSafe(hand: SkatCard[]): boolean {
  const NULL_LOW: Record<string, number> = { '7': 1, '8': 2, '9': 3, '10': 4, J: 5, Q: 6, K: 7, A: 8 }
  let risky = 0
  for (const suit of SUITS) {
    const cards = hand.filter((card) => card.suit === suit)
    if (cards.length === 0) continue
    const low = Math.min(...cards.map((card) => NULL_LOW[card.rank]))
    if (low >= 3) risky += 2
    else if (low === 2 && cards.length > 2) risky += 1
  }
  return risky === 0
}

/** Discard two from twelve: bank points from short side suits, keep the engine room. */
export function chooseDiscard(cards: SkatCard[], plan: BotPlan): SkatCard[] {
  const contract: SkatContract = {
    type: plan.type,
    trump: plan.trump,
    hand: false,
    ouvert: false,
    schneiderAnnounced: false,
    schwarzAnnounced: false,
  }
  const suitCount = new Map<SkatSuit, number>()
  for (const suit of SUITS) {
    suitCount.set(suit, cards.filter((card) => card.suit === suit && !isTrump(card, contract)).length)
  }
  const hasAce = new Set(cards.filter((card) => card.rank === 'A').map((card) => card.suit))
  const score = (card: SkatCard): number => {
    if (isTrump(card, contract)) return -100
    if (plan.type !== 'null' && card.rank === 'A') return -50
    let value = (4 - (suitCount.get(card.suit) ?? 4)) * 12 + cardPoints(card)
    // A 10 behind its own ace is safe in the hand — better kept than banked.
    if (plan.type !== 'null' && card.rank === '10' && hasAce.has(card.suit)) value -= 14
    // Null wants to shed high cards, points are irrelevant.
    if (plan.type === 'null') value = (4 - (suitCount.get(card.suit) ?? 4)) * 4 + cardPoints(card)
    return value
  }
  return [...cards].sort((a, b) => score(b) - score(a)).slice(0, 2)
}

export interface PlayContext {
  hand: SkatCard[]
  trick: { seat: number; card: SkatCard }[]
  contract: SkatContract
  mySeat: number
  declarerSeat: number
  /** Every card already out of play (completed tricks) — public knowledge. */
  played: SkatCard[]
}

export function choosePlay(ctx: PlayContext): SkatCard {
  const { contract } = ctx
  const trickCards = ctx.trick.map((play) => play.card)
  const legal = legalPlays(ctx.hand, trickCards, contract)
  if (legal.length === 1) return legal[0]
  return contract.type === 'null' ? playNull(ctx, legal) : playTrickGame(ctx, legal)
}

/* ------------------------------- suit / grand ------------------------------- */

const ORDER: Record<string, number> = { A: 7, '10': 6, K: 5, Q: 4, '9': 3, '8': 2, '7': 1, J: 0 }
const JACKS: Record<string, number> = { '♣': 4, '♠': 3, '♥': 2, '♦': 1 }
const power = (card: SkatCard, contract: SkatContract) =>
  card.rank === 'J' ? 100 + JACKS[card.suit] : (isTrump(card, contract) ? 50 : 0) + ORDER[card.rank]

function playTrickGame(ctx: PlayContext, legal: SkatCard[]): SkatCard {
  const { contract } = ctx
  const iAmDeclarer = ctx.mySeat === ctx.declarerSeat
  const byPower = [...legal].sort((a, b) => power(a, contract) - power(b, contract))
  const byPoints = [...legal].sort((a, b) => cardPoints(a) - cardPoints(b))
  const lowest = byPoints[0]

  if (ctx.trick.length === 0) {
    return iAmDeclarer ? declarerLead(ctx, legal, byPower) : defenderLead(ctx, legal)
  }

  const trickCards = ctx.trick.map((play) => play.card)
  const winnerIdx = trickWinner(trickCards, contract)
  const winnerSeat = ctx.trick[winnerIdx].seat
  const trickPoints = trickCards.reduce((sum, card) => sum + cardPoints(card), 0)
  const winning = (card: SkatCard) => trickWinner([...trickCards, card], contract) === trickCards.length
  const winners = byPower.filter(winning)
  const cheapestWin = winners[0]
  const last = ctx.trick.length === 2

  if (iAmDeclarer) {
    if (cheapestWin && (trickPoints >= 4 || last)) return cheapestWin
    return lowest
  }
  const partnerWinning = winnerSeat !== ctx.declarerSeat
  if (partnerWinning && last) {
    // Schmieren: pile points onto the partner's trick.
    return byPoints[byPoints.length - 1]
  }
  if (!partnerWinning && cheapestWin && (trickPoints >= 4 || last)) return cheapestWin
  return lowest
}

function declarerLead(ctx: PlayContext, legal: SkatCard[], byPower: SkatCard[]): SkatCard {
  const { contract } = ctx
  const gone = new Set(ctx.played.map(cardKey))
  const mine = new Set(ctx.hand.map(cardKey))
  const outstandingTrumps = countOutstandingTrumps(contract, gone, mine)
  const myTrumps = legal.filter((card) => isTrump(card, contract))
  if (outstandingTrumps > 0 && myTrumps.length > 0) {
    const topTrump = byPower[byPower.length - 1]
    if (isTrump(topTrump, contract) && isHighestOutstanding(topTrump, contract, gone, mine)) {
      return topTrump
    }
  }
  const sideAce = legal.find((card) => card.rank === 'A' && !isTrump(card, contract))
  if (sideAce) return sideAce
  if (myTrumps.length > 0 && outstandingTrumps === 0) {
    const side = legal.filter((card) => !isTrump(card, contract))
    if (side.length === 0) return myTrumps[0]
  }
  return [...legal].sort((a, b) => cardPoints(a) - cardPoints(b))[0]
}

function defenderLead(ctx: PlayContext, legal: SkatCard[]): SkatCard {
  const { contract } = ctx
  const sideAce = legal.find((card) => card.rank === 'A' && !isTrump(card, contract))
  if (sideAce) return sideAce
  const side = legal.filter((card) => !isTrump(card, contract))
  const pool = side.length > 0 ? side : legal
  const bySuitLength = new Map<SkatSuit, number>()
  for (const card of pool) bySuitLength.set(card.suit, (bySuitLength.get(card.suit) ?? 0) + 1)
  return [...pool].sort((a, b) => {
    const lenDiff = (bySuitLength.get(b.suit) ?? 0) - (bySuitLength.get(a.suit) ?? 0)
    return lenDiff !== 0 ? lenDiff : cardPoints(a) - cardPoints(b)
  })[0]
}

function countOutstandingTrumps(contract: SkatContract, gone: Set<string>, mine: Set<string>): number {
  let count = 0
  for (const suit of SUITS) {
    const key = `${suit}J`
    if (!gone.has(key) && !mine.has(key)) count++
  }
  if (contract.type === 'suit' && contract.trump) {
    for (const rank of ['A', '10', 'K', 'Q', '9', '8', '7']) {
      const key = `${contract.trump}${rank}`
      if (!gone.has(key) && !mine.has(key)) count++
    }
  }
  return count
}

function isHighestOutstanding(
  card: SkatCard,
  contract: SkatContract,
  gone: Set<string>,
  mine: Set<string>,
): boolean {
  const ladder: string[] = ['♣J', '♠J', '♥J', '♦J']
  if (contract.type === 'suit' && contract.trump) {
    for (const rank of ['A', '10', 'K', 'Q', '9', '8', '7']) ladder.push(`${contract.trump}${rank}`)
  }
  for (const key of ladder) {
    if (key === cardKey(card)) return true
    if (!gone.has(key) && !mine.has(key)) return false
  }
  return false
}

/* ----------------------------------- null ----------------------------------- */

const NULL_ORDER: Record<string, number> = { A: 8, K: 7, Q: 6, J: 5, '10': 4, '9': 3, '8': 2, '7': 1 }

function playNull(ctx: PlayContext, legal: SkatCard[]): SkatCard {
  const iAmDeclarer = ctx.mySeat === ctx.declarerSeat
  const asc = [...legal].sort((a, b) => NULL_ORDER[a.rank] - NULL_ORDER[b.rank])
  if (iAmDeclarer) {
    if (ctx.trick.length === 0) return asc[0]
    const trickCards = ctx.trick.map((play) => play.card)
    // Highest card that still ducks the trick; forced to win -> shed the biggest liability.
    const ducks = asc.filter(
      (card) => trickWinner([...trickCards, card], ctx.contract) !== trickCards.length,
    )
    return ducks.length > 0 ? ducks[ducks.length - 1] : asc[asc.length - 1]
  }
  const declarerPlay = ctx.trick.find((play) => play.seat === ctx.declarerSeat)
  if (!declarerPlay) return asc[0] // play low, squeeze the declarer under it
  const trickCards = ctx.trick.map((play) => play.card)
  const declarerWinning =
    ctx.trick[trickWinner(trickCards, ctx.contract)].seat === ctx.declarerSeat
  if (declarerWinning) {
    // Keep the declarer on top: slip the highest card that stays under.
    const under = asc.filter(
      (card) => trickWinner([...trickCards, card], ctx.contract) !== trickCards.length,
    )
    if (under.length > 0) return under[under.length - 1]
  }
  // Can't feed the trick to the declarer — dump the most dangerous card.
  return asc[asc.length - 1]
}

/* --------------------------------- bidding --------------------------------- */

export function botShouldBid(plan: BotPlan, value: number): boolean {
  return BID_VALUES.includes(value) && value <= plan.maxBid
}

export function nullValueFor(hand: boolean, ouvert: boolean): number {
  return nullValue({ hand, ouvert })
}
