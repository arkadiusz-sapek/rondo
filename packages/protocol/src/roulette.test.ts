import { describe, expect, it } from 'vitest'
import {
  WHEEL_NUMBERS,
  colorOf,
  parseBetSpot,
  payoutMultiplier,
  settleBet,
  spotCovers,
} from './roulette'

describe('wheel layout', () => {
  it('has all 37 pockets exactly once', () => {
    expect(new Set(WHEEL_NUMBERS).size).toBe(37)
    expect([...WHEEL_NUMBERS].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 37 }, (_, i) => i),
    )
  })

  it('colors match the standard layout', () => {
    expect(colorOf(0)).toBe('green')
    expect(colorOf(1)).toBe('red')
    expect(colorOf(17)).toBe('black')
    expect(colorOf(32)).toBe('red')
    expect(colorOf(26)).toBe('black')
  })
})

describe('parseBetSpot', () => {
  it('accepts every legal spot and rejects garbage', () => {
    expect(parseBetSpot('straight:0')).toBe('straight:0')
    expect(parseBetSpot('straight:36')).toBe('straight:36')
    expect(parseBetSpot('dozen:3')).toBe('dozen:3')
    expect(parseBetSpot('column:1')).toBe('column:1')
    expect(parseBetSpot('red')).toBe('red')
    expect(parseBetSpot('straight:37')).toBeNull()
    expect(parseBetSpot('dozen:4')).toBeNull()
    expect(parseBetSpot('banana')).toBeNull()
  })
})

describe('coverage and payouts', () => {
  it('zero loses every outside bet but pays straight:0', () => {
    for (const spot of ['red', 'black', 'even', 'odd', 'low', 'high', 'dozen:1', 'column:2'] as const) {
      expect(spotCovers(spot, 0)).toBe(false)
    }
    expect(settleBet('straight:0', 10, 0)).toBe(360)
  })

  it('straight pays 35:1 plus stake', () => {
    expect(settleBet('straight:17', 5, 17)).toBe(180)
    expect(settleBet('straight:17', 5, 18)).toBe(0)
  })

  it('even-money spots pay 1:1', () => {
    expect(settleBet('red', 10, 32)).toBe(20)
    expect(settleBet('black', 10, 32)).toBe(0)
    expect(settleBet('odd', 10, 19)).toBe(20)
    expect(settleBet('high', 10, 19)).toBe(20)
    expect(settleBet('low', 10, 19)).toBe(0)
  })

  it('dozens and columns pay 2:1 and partition 1..36', () => {
    expect(settleBet('dozen:2', 10, 13)).toBe(30)
    for (let num = 1; num <= 36; num++) {
      const dozens = (['dozen:1', 'dozen:2', 'dozen:3'] as const).filter((spot) =>
        spotCovers(spot, num),
      )
      const columns = (['column:1', 'column:2', 'column:3'] as const).filter((spot) =>
        spotCovers(spot, num),
      )
      expect(dozens).toHaveLength(1)
      expect(columns).toHaveLength(1)
    }
  })

  it('column layout matches the table: 3-6-9 row logic', () => {
    expect(spotCovers('column:1', 1)).toBe(true)
    expect(spotCovers('column:2', 2)).toBe(true)
    expect(spotCovers('column:3', 3)).toBe(true)
    expect(spotCovers('column:3', 36)).toBe(true)
    expect(payoutMultiplier('column:3')).toBe(2)
  })
})
