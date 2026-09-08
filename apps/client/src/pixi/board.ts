import { Container, Graphics, Text, type FederatedPointerEvent } from 'pixi.js'
import { colorOf, type Bet, type BetSpot } from '@rondo/protocol'
import { palette, pocketFill } from './palette'

interface SpotRect {
  spot: BetSpot
  x: number
  y: number
  w: number
  h: number
}

const CELL_W = 62
const CELL_H = 52
const ZERO_W = 44
const GRID_X = ZERO_W + 4

/**
 * The betting table. Deliberately uses **event delegation**: there are ~50
 * clickable spots but exactly ONE pointer listener on the container — the tap
 * position is resolved to a spot with a rect lookup. No per-spot handlers, no
 * per-spot hit areas to keep in sync.
 */
export class Board {
  readonly view = new Container()
  private chips = new Container()
  private highlight = new Graphics()
  private rects: SpotRect[] = []

  constructor(private onSpot: (spot: BetSpot) => void) {
    this.buildRects()
    this.view.addChild(this.drawTable())
    this.view.addChild(this.highlight)
    this.view.addChild(this.chips)

    this.view.eventMode = 'static'
    this.view.on('pointerdown', (event: FederatedPointerEvent) => {
      const point = this.view.toLocal(event.global)
      const hit = this.rects.find(
        (rect) =>
          point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h,
      )
      if (hit) this.onSpot(hit.spot)
    })
  }

  get width() {
    return GRID_X + CELL_W * 12 + 4 + ZERO_W
  }

  /** Re-render chips: my stakes in blue, the table's combined stakes as ghosts. */
  renderChips(myBets: Bet[], betTotals: Record<string, number>) {
    this.chips.removeChildren()
    const mine = new Map<string, number>()
    for (const bet of myBets) mine.set(bet.spot, (mine.get(bet.spot) ?? 0) + bet.amount)

    for (const [spot, total] of Object.entries(betTotals)) {
      const rect = this.rects.find((candidate) => candidate.spot === spot)
      if (!rect || mine.has(spot)) continue
      this.chips.addChild(chip(rect, total, palette.chipOthers, 0.45))
    }
    for (const [spot, amount] of mine) {
      const rect = this.rects.find((candidate) => candidate.spot === spot)
      if (rect) this.chips.addChild(chip(rect, amount, palette.chip, 1))
    }
  }

  /** Flash the winning straight cell during the result phase. */
  showWinner(num: number | null) {
    this.highlight.clear()
    if (num === null) return
    const rect = this.rects.find((candidate) => candidate.spot === `straight:${num}`)
    if (!rect) return
    this.highlight
      .roundRect(rect.x + 2, rect.y + 2, rect.w - 4, rect.h - 4, 6)
      .stroke({ width: 3, color: palette.gold })
  }

  private buildRects() {
    this.rects.push({ spot: 'straight:0', x: 0, y: 0, w: ZERO_W, h: CELL_H * 3 })
    for (let num = 1; num <= 36; num++) {
      const col = Math.floor((num - 1) / 3)
      const row = 2 - ((num - 1) % 3)
      this.rects.push({
        spot: `straight:${num}` as BetSpot,
        x: GRID_X + col * CELL_W,
        y: row * CELL_H,
        w: CELL_W,
        h: CELL_H,
      })
    }
    for (const column of [1, 2, 3] as const) {
      this.rects.push({
        spot: `column:${column}`,
        x: GRID_X + 12 * CELL_W + 4,
        y: (3 - column) * CELL_H,
        w: ZERO_W,
        h: CELL_H,
      })
    }
    const dozenY = CELL_H * 3 + 6
    for (const dozen of [1, 2, 3] as const) {
      this.rects.push({
        spot: `dozen:${dozen}`,
        x: GRID_X + (dozen - 1) * CELL_W * 4,
        y: dozenY,
        w: CELL_W * 4,
        h: 40,
      })
    }
    const outsideY = dozenY + 46
    const outside: BetSpot[] = ['low', 'even', 'red', 'black', 'odd', 'high']
    outside.forEach((spot, index) => {
      this.rects.push({ spot, x: GRID_X + index * CELL_W * 2, y: outsideY, w: CELL_W * 2, h: 44 })
    })
  }

  private drawTable() {
    const g = new Graphics()
    const labels = new Container()
    labels.addChild(g)

    for (const rect of this.rects) {
      const fill = fillFor(rect.spot)
      g.roundRect(rect.x, rect.y, rect.w, rect.h, 5)
        .fill(fill.color)
        .stroke({ width: 1.5, color: palette.feltLine, alpha: 0.9 })
      const label = new Text({
        text: fill.label,
        style: {
          fill: palette.text,
          fontSize: rect.spot.startsWith('straight:') ? 18 : 14,
          fontFamily: 'Arial',
          fontWeight: '700',
        },
      })
      label.anchor.set(0.5)
      label.position.set(rect.x + rect.w / 2, rect.y + rect.h / 2)
      if (rect.spot === 'straight:0') label.rotation = -Math.PI / 2
      labels.addChild(label)
    }
    return labels
  }
}

function fillFor(spot: BetSpot): { color: number; label: string } {
  if (spot.startsWith('straight:')) {
    const num = Number(spot.slice(9))
    return { color: pocketFill(colorOf(num)), label: String(num) }
  }
  switch (spot) {
    case 'red':
      return { color: palette.red, label: 'RED' }
    case 'black':
      return { color: palette.black, label: 'BLACK' }
    case 'even':
      return { color: palette.felt, label: 'EVEN' }
    case 'odd':
      return { color: palette.felt, label: 'ODD' }
    case 'low':
      return { color: palette.felt, label: '1–18' }
    case 'high':
      return { color: palette.felt, label: '19–36' }
    default: {
      if (spot.startsWith('dozen:')) {
        const dozen = Number(spot.slice(6))
        return { color: palette.felt, label: `${(dozen - 1) * 12 + 1}–${dozen * 12}` }
      }
      return { color: palette.felt, label: '2:1' }
    }
  }
}

function chip(rect: SpotRect, amount: number, color: number, alpha: number) {
  const container = new Container()
  const g = new Graphics()
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  g.circle(cx, cy, 14).fill({ color, alpha })
  g.circle(cx, cy, 14).stroke({ width: 2, color: 0xffffff, alpha: alpha * 0.9 })
  const label = new Text({
    text: String(amount),
    style: { fill: 0x111111, fontSize: 11, fontFamily: 'Arial', fontWeight: '800' },
  })
  label.anchor.set(0.5)
  label.position.set(cx, cy)
  label.alpha = alpha
  container.addChild(g, label)
  return container
}
