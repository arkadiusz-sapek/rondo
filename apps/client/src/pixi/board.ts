import { Container, Graphics, Text, type FederatedPointerEvent, type PointData } from 'pixi.js'
import { colorOf, type Bet, type BetSpot } from '@rondo/protocol'
import { chipTierPixi } from '../ui/chipColors'
import { palette } from './palette'

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

const CELL_RED = 0xb63d3d
const CELL_BLACK = 0x1a1d24
const CELL_GLASS = 0x0f231c

/**
 * The betting table. Deliberately uses **event delegation**: there are ~50
 * clickable spots but exactly ONE pointer listener on the container — the tap
 * position is resolved to a spot with a rect lookup. No per-spot handlers.
 */
export class Board {
  readonly view = new Container()
  private chips = new Container()
  private hover = new Graphics()
  private highlight = new Graphics()
  private rects: SpotRect[] = []

  constructor(private onSpot: (spot: BetSpot) => void) {
    this.buildRects()
    this.view.addChild(this.drawTable())
    this.view.addChild(this.hover)
    this.view.addChild(this.highlight)
    this.view.addChild(this.chips)

    this.view.eventMode = 'static'
    this.view.on('pointerdown', (event: FederatedPointerEvent) => {
      const hit = this.spotAt(this.view.toLocal(event.global))
      if (hit) this.onSpot(hit)
    })
    this.view.on('pointermove', (event: FederatedPointerEvent) => {
      this.setHover(this.spotAt(this.view.toLocal(event.global)))
    })
    this.view.on('pointerleave', () => this.setHover(null))
  }

  get width() {
    return GRID_X + CELL_W * 12 + 4 + ZERO_W
  }

  get height() {
    return CELL_H * 3 + 6 + 40 + 6 + 44
  }

  spotAt(point: PointData): BetSpot | null {
    const hit = this.rects.find(
      (rect) =>
        point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h,
    )
    return hit?.spot ?? null
  }

  setHover(spot: BetSpot | null) {
    this.hover.clear()
    if (!spot) return
    const rect = this.rects.find((candidate) => candidate.spot === spot)
    if (!rect) return
    this.hover
      .roundRect(rect.x, rect.y, rect.w, rect.h, 8)
      .fill({ color: 0xffffff, alpha: 0.14 })
      .stroke({ width: 1.5, color: palette.gold, alpha: 0.8 })
  }

  /** My stakes in gold-rimmed chips, everyone else's as translucent ghosts. */
  renderChips(myBets: Bet[], betTotals: Record<string, number>) {
    this.chips.removeChildren()
    const mine = new Map<string, number>()
    for (const bet of myBets) mine.set(bet.spot, (mine.get(bet.spot) ?? 0) + bet.amount)

    for (const [spot, total] of Object.entries(betTotals)) {
      const rect = this.rects.find((candidate) => candidate.spot === spot)
      if (!rect || mine.has(spot)) continue
      this.chips.addChild(chip(rect, total, palette.chipOthers, 0.4))
    }
    for (const [spot, amount] of mine) {
      const rect = this.rects.find((candidate) => candidate.spot === spot)
      // My chips wear the denomination tier color, same as the dock.
      if (rect) this.chips.addChild(chip(rect, amount, chipTierPixi(amount), 1))
    }
  }

  showWinner(num: number | null) {
    this.highlight.clear()
    if (num === null) return
    const rect = this.rects.find((candidate) => candidate.spot === `straight:${num}`)
    if (!rect) return
    this.highlight
      .roundRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2, 8)
      .fill({ color: palette.gold, alpha: 0.18 })
      .stroke({ width: 2.5, color: palette.gold })
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
    const layer = new Container()
    layer.addChild(g)

    for (const rect of this.rects) {
      const style = styleFor(rect.spot)
      g.roundRect(rect.x + 1.5, rect.y + 1.5, rect.w - 3, rect.h - 3, 8)
        .fill({ color: style.fill, alpha: style.alpha })
        .stroke({ width: 1, color: 0xffffff, alpha: 0.1 })
      const label = new Text({
        text: style.label,
        style: {
          fill: style.text,
          fontSize: rect.spot.startsWith('straight:') ? 17 : 13,
          fontFamily: 'Arial',
          fontWeight: '700',
          letterSpacing: rect.spot.startsWith('straight:') ? 0 : 1,
        },
      })
      label.anchor.set(0.5)
      label.position.set(rect.x + rect.w / 2, rect.y + rect.h / 2)
      if (rect.spot === 'straight:0') label.rotation = -Math.PI / 2
      layer.addChild(label)
    }
    return layer
  }
}

function styleFor(spot: BetSpot): { fill: number; alpha: number; text: number; label: string } {
  if (spot.startsWith('straight:')) {
    const num = Number(spot.slice(9))
    if (num === 0) return { fill: palette.green, alpha: 0.75, text: 0xffffff, label: '0' }
    const color = colorOf(num)
    return {
      fill: color === 'red' ? CELL_RED : CELL_BLACK,
      alpha: 0.72,
      text: 0xffffff,
      label: String(num),
    }
  }
  switch (spot) {
    case 'red':
      return { fill: CELL_RED, alpha: 0.72, text: 0xffffff, label: 'RED' }
    case 'black':
      return { fill: CELL_BLACK, alpha: 0.85, text: 0xffffff, label: 'BLACK' }
    case 'even':
      return { fill: CELL_GLASS, alpha: 0.8, text: 0xd8e5dd, label: 'EVEN' }
    case 'odd':
      return { fill: CELL_GLASS, alpha: 0.8, text: 0xd8e5dd, label: 'ODD' }
    case 'low':
      return { fill: CELL_GLASS, alpha: 0.8, text: 0xd8e5dd, label: '1–18' }
    case 'high':
      return { fill: CELL_GLASS, alpha: 0.8, text: 0xd8e5dd, label: '19–36' }
    default: {
      if (spot.startsWith('dozen:')) {
        const dozen = Number(spot.slice(6))
        return {
          fill: CELL_GLASS,
          alpha: 0.8,
          text: 0xd8e5dd,
          label: `${(dozen - 1) * 12 + 1}–${dozen * 12}`,
        }
      }
      return { fill: CELL_GLASS, alpha: 0.8, text: 0xd8e5dd, label: '2:1' }
    }
  }
}

function chip(rect: SpotRect, amount: number, color: number, alpha: number) {
  const container = new Container()
  const g = new Graphics()
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  g.circle(cx, cy + 1.5, 14).fill({ color: 0x000000, alpha: alpha * 0.35 })
  g.circle(cx, cy, 14).fill({ color, alpha })
  g.circle(cx, cy, 14).stroke({ width: 2, color: 0xffffff, alpha: alpha * 0.85 })
  g.circle(cx, cy, 10).stroke({ width: 1, color: 0xffffff, alpha: alpha * 0.4 })
  const label = new Text({
    text: String(amount),
    style: { fill: 0xffffff, fontSize: 11, fontFamily: 'Arial', fontWeight: '800' },
  })
  label.anchor.set(0.5)
  label.position.set(cx, cy)
  label.alpha = alpha
  container.addChild(g, label)
  return container
}
