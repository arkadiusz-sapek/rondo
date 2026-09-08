import { describe, expect, it } from 'vitest'
import {
  buildShoe,
  dealerShouldDraw,
  handValue,
  isBlackjack,
  settleHand,
  type Card,
} from './blackjack'

const c = (rank: Card['rank']): Card => ({ rank, suit: '♠' })

describe('hand values', () => {
  it('counts soft and hard aces', () => {
    expect(handValue([c('A'), c('6')])).toEqual({ total: 17, soft: true })
    expect(handValue([c('A'), c('6'), c('9')])).toEqual({ total: 16, soft: false })
    expect(handValue([c('A'), c('A'), c('9')])).toEqual({ total: 21, soft: true })
    expect(handValue([c('A'), c('A'), c('A'), c('K')])).toEqual({ total: 13, soft: false })
  })

  it('face cards are ten', () => {
    expect(handValue([c('K'), c('Q'), c('J')]).total).toBe(30)
  })

  it('detects blackjack only on two cards', () => {
    expect(isBlackjack([c('A'), c('K')])).toBe(true)
    expect(isBlackjack([c('7'), c('7'), c('7')])).toBe(false)
  })
})

describe('dealer S17', () => {
  it('draws under 17, stands on soft 17', () => {
    expect(dealerShouldDraw([c('10'), c('6')])).toBe(true)
    expect(dealerShouldDraw([c('10'), c('7')])).toBe(false)
    expect(dealerShouldDraw([c('A'), c('6')])).toBe(false)
  })
})

describe('settlement', () => {
  it('blackjack pays 3:2, dealer blackjack pushes it', () => {
    expect(settleHand([c('A'), c('K')], [c('10'), c('9')])).toEqual({ outcome: 'blackjack', multiplier: 2.5 })
    expect(settleHand([c('A'), c('K')], [c('A'), c('Q')])).toEqual({ outcome: 'push', multiplier: 1 })
  })

  it('busted player loses even against dealer bust', () => {
    expect(settleHand([c('K'), c('9'), c('5')], [c('K'), c('9'), c('5')]).outcome).toBe('lose')
  })

  it('dealer bust pays the standing player', () => {
    expect(settleHand([c('10'), c('8')], [c('10'), c('6'), c('K')])).toEqual({ outcome: 'win', multiplier: 2 })
  })

  it('higher total wins, equal pushes, 21-in-three beats dealer 20 but not dealer blackjack', () => {
    expect(settleHand([c('10'), c('9')], [c('10'), c('8')]).outcome).toBe('win')
    expect(settleHand([c('10'), c('9')], [c('10'), c('9')]).outcome).toBe('push')
    expect(settleHand([c('7'), c('7'), c('7')], [c('10'), c('K')]).outcome).toBe('win')
    expect(settleHand([c('7'), c('7'), c('7')], [c('A'), c('K')]).outcome).toBe('lose')
  })
})

describe('shoe', () => {
  it('6 decks = 312 cards, 24 aces', () => {
    const shoe = buildShoe(6)
    expect(shoe).toHaveLength(312)
    expect(shoe.filter((card) => card.rank === 'A')).toHaveLength(24)
  })
})
