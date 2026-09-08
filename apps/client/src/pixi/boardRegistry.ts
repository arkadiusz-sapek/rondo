import type { BetSpot } from '@rondo/protocol'

/**
 * Bridge between the DOM chip dock (drag & drop) and the Pixi board: the
 * stage registers converters from client coordinates to bet spots.
 */
interface BoardBridge {
  spotAtClient: (clientX: number, clientY: number) => BetSpot | null
  hoverAtClient: (clientX: number, clientY: number) => void
  clearHover: () => void
}

let bridge: BoardBridge | null = null

export function registerBoard(next: BoardBridge | null) {
  bridge = next
}

export function boardBridge(): BoardBridge | null {
  return bridge
}
