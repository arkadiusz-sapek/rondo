import { expect, test } from 'vitest'
import {
  BID_VALUES,
  buildSkatDeck,
  countPoints,
  gameValue,
  legalPlays,
  matadors,
  nextBidValue,
  settleSkatGame,
  sortSkatHand,
  trickWinner,
  type SkatCard,
  type SkatContract,
} from './skat.js'

const c = (s: string): SkatCard => ({ suit: s[0] as SkatCard['suit'], rank: s.slice(1) as SkatCard['rank'] })
const cs = (...keys: string[]) => keys.map(c)

const clubs: SkatContract = {
  type: 'suit',
  trump: '♣',
  hand: false,
  ouvert: false,
  schneiderAnnounced: false,
  schwarzAnnounced: false,
}
const grand: SkatContract = { ...clubs, type: 'grand', trump: null }
const nullGame: SkatContract = { ...clubs, type: 'null', trump: null }

test('deck has 32 cards worth 120 points', () => {
  const deck = buildSkatDeck()
  expect(deck.length).toBe(32)
  expect(countPoints(deck)).toBe(120)
})

test('bid ladder starts 18,20,22,23,24,27,30,33,35,36', () => {
  expect(BID_VALUES.slice(0, 10)).toEqual([18, 20, 22, 23, 24, 27, 30, 33, 35, 36])
  expect(nextBidValue(null)).toBe(18)
  expect(nextBidValue(18)).toBe(20)
  expect(nextBidValue(48)).toBe(50)
})

test('jack beats the trump ace; ♣J beats ♦J', () => {
  expect(trickWinner(cs('♣A', '♦J', '♣10'), clubs)).toBe(1)
  expect(trickWinner(cs('♦J', '♥J', '♣J'), clubs)).toBe(2)
})

test('a plain suit is won by rank; off-suit cards never win', () => {
  expect(trickWinner(cs('♥K', '♥A', '♠A'), clubs)).toBe(1)
})

test('trump takes a plain lead', () => {
  expect(trickWinner(cs('♥A', '♣7', '♥10'), clubs)).toBe(1)
})

test('null order: jack sits between 10 and queen, no trumps', () => {
  expect(trickWinner(cs('♥10', '♥J', '♥7'), nullGame)).toBe(1)
  expect(trickWinner(cs('♥A', '♣J', '♣A'), nullGame)).toBe(0)
})

test('following: a jack belongs to trump, not its printed suit', () => {
  const hand = cs('♥J', '♥A', '♠7')
  // Hearts led in a clubs game: ♥J is a trump, so only ♥A follows.
  expect(legalPlays(hand, cs('♥K'), clubs)).toEqual(cs('♥A'))
  // Trump led: the jack must be played.
  expect(legalPlays(hand, cs('♣A'), clubs)).toEqual(cs('♥J'))
})

test('matadors: with and without, skat cards extend the run', () => {
  expect(matadors(cs('♣J', '♠J', '♥J', '♣A', '♥7'), clubs)).toEqual({ with: true, count: 3 })
  expect(matadors(cs('♥J', '♦J', '♣A'), clubs)).toEqual({ with: false, count: 2 })
  expect(matadors(cs('♦J', '♥7'), grand)).toEqual({ with: false, count: 3 })
})

test('game value: clubs with 2, hand = 12 × 4 = 48', () => {
  expect(gameValue({ ...clubs, hand: true }, 2, { schneider: false, schwarz: false })).toBe(48)
  expect(gameValue(clubs, 1, { schneider: true, schwarz: false })).toBe(12 * 3)
})

test('declarer needs 61; 60 loses', () => {
  const base = {
    contract: clubs,
    bid: 18,
    declarerCardsWithSkat: cs('♣J', '♠J', '♣A', '♣10'),
    totalTricks: 10,
  }
  const won = settleSkatGame({ ...base, declarerPoints: 61, declarerTricks: 6 })
  expect(won.won).toBe(true)
  expect(won.value).toBe(12 * 3) // with 2 + game
  expect(won.declarerScore).toBe(36 + 50)
  const lost = settleSkatGame({ ...base, declarerPoints: 60, declarerTricks: 6 })
  expect(lost.won).toBe(false)
  expect(lost.declarerScore).toBe(-(2 * 36 + 50))
  expect(lost.defenderScore).toBe(40)
})

test('schneider works in both directions', () => {
  const base = {
    contract: clubs,
    bid: 18,
    declarerCardsWithSkat: cs('♣J', '♠J'),
    totalTricks: 10,
  }
  const big = settleSkatGame({ ...base, declarerPoints: 92, declarerTricks: 9 })
  expect(big.achieved.schneider).toBe(true)
  expect(big.value).toBe(12 * 4) // with 2 + game + schneider
  const crushed = settleSkatGame({ ...base, declarerPoints: 28, declarerTricks: 2 })
  expect(crushed.achieved.schneider).toBe(true)
  expect(crushed.won).toBe(false)
})

test('overbid: bid 30 in clubs worth 24 loses at 36 doubled', () => {
  const result = settleSkatGame({
    contract: clubs,
    bid: 30,
    declarerCardsWithSkat: cs('♣J', '♦J', '♣A'), // with 1 -> value 24
    declarerPoints: 75,
    declarerTricks: 7,
    totalTricks: 10,
  })
  expect(result.overbid).toBe(true)
  expect(result.won).toBe(false)
  expect(result.value).toBe(36)
  expect(result.declarerScore).toBe(-(72 + 50))
})

test('null: any trick loses; values 23/35/46/59', () => {
  const base = { contract: nullGame, bid: 23, declarerCardsWithSkat: [], declarerPoints: 0, totalTricks: 10 }
  expect(settleSkatGame({ ...base, declarerTricks: 0 }).won).toBe(true)
  expect(settleSkatGame({ ...base, declarerTricks: 0 }).declarerScore).toBe(73)
  expect(settleSkatGame({ ...base, declarerTricks: 1 }).won).toBe(false)
  expect(
    gameValue({ ...nullGame, hand: true, ouvert: true }, 0, { schneider: false, schwarz: false }),
  ).toBe(59)
})

test('announced schneider missed = lost at announced value', () => {
  const result = settleSkatGame({
    contract: { ...clubs, hand: true, schneiderAnnounced: true },
    bid: 18,
    declarerCardsWithSkat: cs('♣J', '♠J'),
    declarerPoints: 75, // enough for a plain win, but the announcement fails
    declarerTricks: 7,
    totalTricks: 10,
  })
  expect(result.won).toBe(false)
  // with 2 + game + hand + schneider + announced = 6 levels
  expect(result.value).toBe(12 * 6)
})

test('sorting: jacks lead, trump suit follows', () => {
  const sorted = sortSkatHand(cs('♥A', '♣7', '♦J', '♣J', '♠10'), clubs)
  expect(sorted.map((card) => card.suit + card.rank)).toEqual(['♣J', '♦J', '♣7', '♥A', '♠10'])
})
