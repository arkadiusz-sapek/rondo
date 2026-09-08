/**
 * Pure blackjack rules — shared by the server engine (dealing, settlement)
 * and the client (hand totals, UI hints), unit-tested once.
 * House rules: 6-deck shoe, dealer stands on all 17 (S17), blackjack pays
 * 3:2, double on any first two cards, no splits (yet), no insurance.
 */

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const
export const SUITS = ['♠', '♥', '♦', '♣'] as const

export type Rank = (typeof RANKS)[number]
export type Suit = (typeof SUITS)[number]

export interface Card {
  rank: Rank
  suit: Suit
}

export function cardValue(rank: Rank): number {
  if (rank === 'A') return 11
  if (rank === 'K' || rank === 'Q' || rank === 'J') return 10
  return Number(rank)
}

export interface HandValue {
  total: number
  /** True when an ace still counts as 11 — the hand can't bust on one card. */
  soft: boolean
}

export function handValue(cards: Card[]): HandValue {
  let total = 0
  let aces = 0
  for (const card of cards) {
    total += cardValue(card.rank)
    if (card.rank === 'A') aces++
  }
  while (total > 21 && aces > 0) {
    total -= 10
    aces--
  }
  return { total, soft: aces > 0 }
}

export function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && handValue(cards).total === 21
}

export function isBusted(cards: Card[]): boolean {
  return handValue(cards).total > 21
}

export type BjOutcome = 'blackjack' | 'win' | 'push' | 'lose'

/**
 * Settle one player hand against the dealer.
 * Returns the outcome and the total returned for a 1-unit stake
 * (blackjack 2.5, win 2, push 1, lose 0) — multiply by the actual bet.
 */
export function settleHand(playerCards: Card[], dealerCards: Card[]): { outcome: BjOutcome; multiplier: number } {
  const player = handValue(playerCards)
  const dealer = handValue(dealerCards)
  const playerBj = isBlackjack(playerCards)
  const dealerBj = isBlackjack(dealerCards)

  if (player.total > 21) return { outcome: 'lose', multiplier: 0 }
  if (playerBj && dealerBj) return { outcome: 'push', multiplier: 1 }
  if (playerBj) return { outcome: 'blackjack', multiplier: 2.5 }
  if (dealerBj) return { outcome: 'lose', multiplier: 0 }
  if (dealer.total > 21) return { outcome: 'win', multiplier: 2 }
  if (player.total > dealer.total) return { outcome: 'win', multiplier: 2 }
  if (player.total < dealer.total) return { outcome: 'lose', multiplier: 0 }
  return { outcome: 'push', multiplier: 1 }
}

/** Dealer draws while under 17; stands on all 17s (S17). */
export function dealerShouldDraw(cards: Card[]): boolean {
  return handValue(cards).total < 17
}

export function buildShoe(decks: number): Card[] {
  const shoe: Card[] = []
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) shoe.push({ rank, suit })
    }
  }
  return shoe
}
