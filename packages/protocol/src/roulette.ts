/**
 * Pure European-roulette rules: numbers, colors, bet spots, payouts.
 * Shared by server (settlement) and client (grid rendering, potential-win
 * hints) so the two can never disagree.
 */

export const WHEEL_NUMBERS = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14,
  31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
] as const

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36])

export type PocketColor = 'red' | 'black' | 'green'

export function colorOf(num: number): PocketColor {
  if (num === 0) return 'green'
  return RED_NUMBERS.has(num) ? 'red' : 'black'
}

/**
 * A bet spot as a compact string key — stable across the wire, the DB and the
 * grid hit-test. Inside bets beyond straight (split/corner/street) extend this
 * union without touching the protocol events.
 */
export type BetSpot =
  | `straight:${number}`
  | 'red'
  | 'black'
  | 'even'
  | 'odd'
  | 'low'
  | 'high'
  | `dozen:${1 | 2 | 3}`
  | `column:${1 | 2 | 3}`

export function parseBetSpot(raw: string): BetSpot | null {
  if (['red', 'black', 'even', 'odd', 'low', 'high'].includes(raw)) return raw as BetSpot
  const straight = raw.match(/^straight:(\d{1,2})$/)
  if (straight) {
    const num = Number(straight[1])
    return num >= 0 && num <= 36 ? (`straight:${num}` as BetSpot) : null
  }
  const group = raw.match(/^(dozen|column):([123])$/)
  if (group) return raw as BetSpot
  return null
}

/** Does `spot` cover the drawn `num`? Zero loses every outside bet. */
export function spotCovers(spot: BetSpot, num: number): boolean {
  if (spot.startsWith('straight:')) return Number(spot.slice(9)) === num
  if (num === 0) return false
  switch (spot) {
    case 'red':
      return colorOf(num) === 'red'
    case 'black':
      return colorOf(num) === 'black'
    case 'even':
      return num % 2 === 0
    case 'odd':
      return num % 2 === 1
    case 'low':
      return num <= 18
    case 'high':
      return num >= 19
    case 'dozen:1':
      return num <= 12
    case 'dozen:2':
      return num >= 13 && num <= 24
    case 'dozen:3':
      return num >= 25
    case 'column:1':
      return num % 3 === 1
    case 'column:2':
      return num % 3 === 2
    case 'column:3':
      return num % 3 === 0
  }
  return false
}

/** Winnings multiplier (stake excluded): straight 35:1, dozens/columns 2:1, even-money 1:1. */
export function payoutMultiplier(spot: BetSpot): number {
  if (spot.startsWith('straight:')) return 35
  if (spot.startsWith('dozen:') || spot.startsWith('column:')) return 2
  return 1
}

/** Total returned to the player for a winning bet: stake + winnings. */
export function settleBet(spot: BetSpot, amount: number, drawn: number): number {
  return spotCovers(spot, drawn) ? amount * (payoutMultiplier(spot) + 1) : 0
}
