import { Application, Container, Graphics, Text } from 'pixi.js'
import { useEffect, useRef } from 'react'
import { handValue, type BjSeat, type Card } from '@rondo/protocol'
import { useGame } from '../store/game'
import { palette } from './palette'
import { Confetti } from './confetti'

const CARD_W = 52
const CARD_H = 74

/* ------------------------------ card sprites ------------------------------ */

function drawCardFace(card: Card): Container {
  const view = new Container()
  const g = new Graphics()
  g.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 7)
    .fill(0xf7f5ee)
    .stroke({ width: 1.5, color: 0x2a2d35, alpha: 0.6 })
  view.addChild(g)
  const red = card.suit === '♥' || card.suit === '♦'
  const color = red ? 0xc22f2f : 0x1c1f26
  const corner = new Text({
    text: `${card.rank}\n${card.suit}`,
    style: { fill: color, fontSize: 13, fontFamily: 'Arial', fontWeight: '800', align: 'center', lineHeight: 13 },
  })
  corner.position.set(-CARD_W / 2 + 5, -CARD_H / 2 + 4)
  const pip = new Text({
    text: card.suit,
    style: { fill: color, fontSize: 26, fontFamily: 'Arial' },
  })
  pip.anchor.set(0.5)
  pip.position.set(4, 8)
  view.addChild(corner, pip)
  return view
}

function drawCardBack(): Container {
  const view = new Container()
  const g = new Graphics()
  g.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 7)
    .fill(0x24314d)
    .stroke({ width: 1.5, color: 0x0e1524 })
  g.roundRect(-CARD_W / 2 + 5, -CARD_H / 2 + 5, CARD_W - 10, CARD_H - 10, 5).stroke({
    width: 1.5,
    color: 0x5a79b8,
    alpha: 0.7,
  })
  for (let y = -CARD_H / 2 + 12; y < CARD_H / 2 - 8; y += 9) {
    g.moveTo(-CARD_W / 2 + 9, y).lineTo(CARD_W / 2 - 9, y + 4).stroke({ width: 1, color: 0x5a79b8, alpha: 0.35 })
  }
  view.addChild(g)
  return view
}

interface Tween {
  view: Container
  fromX: number
  fromY: number
  toX: number
  toY: number
  start: number
  duration: number
  flip?: { halfway: () => void; done: boolean }
}

/**
 * Blackjack scene: dealer top-center, up to five seats on an arc, cards fly
 * in from the shoe and the hole card flips on reveal. Fully store-driven —
 * the ticker diffs the bj slice each frame and animates the difference.
 */
export function BjStage() {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let app: Application | undefined
    let destroyed = false

    const setup = async () => {
      app = new Application()
      await app.init({ resizeTo: window, backgroundAlpha: 0, antialias: true })
      if (destroyed || !hostRef.current) {
        app.destroy(true)
        return
      }
      hostRef.current.appendChild(app.canvas)

      const felt = new Graphics()
      const dealerArea = new Container()
      const seatsArea = new Container()
      const fx = new Confetti()
      app.stage.addChild(felt, dealerArea, seatsArea, fx.view)

      const tweens: Tween[] = []
      /** Fly a card from the shoe (screen top-right) into its container-local slot. */
      const fly = (view: Container, origin: { x: number; y: number }, toX: number, toY: number, now: number) => {
        const W = app!.screen.width
        tweens.push({
          view,
          fromX: W - 70 - origin.x,
          fromY: 90 - origin.y,
          toX,
          toY,
          start: now,
          duration: 420,
        })
      }

      interface SeatView {
        root: Container
        cardsBox: Container
        rendered: number
        label: Text
        info: Text
        ring: Graphics
        chip: Container | null
        playerId: string
      }
      let seatViews: SeatView[] = []
      let dealerCardsRendered = 0
      let dealerHole: Container | null = null
      let holeRevealed = false
      let lastPhase = ''
      let lastReturnedSeen: number | null = null
      let lastW = 0
      let lastH = 0

      const seatPos = (index: number, count: number, W: number, H: number) => {
        const spread = Math.min(0.72, 0.2 + count * 0.13)
        const angle = Math.PI / 2 + (index - (count - 1) / 2) * spread
        return {
          x: W / 2 + Math.cos(angle) * W * 0.32 * -1,
          y: H * 0.18 + Math.sin(angle) * H * 0.52,
        }
      }

      const drawFelt = (W: number, H: number) => {
        felt.clear()
        felt.ellipse(W / 2, H * 0.05, W * 0.46, H * 0.72).stroke({ width: 3, color: palette.gold, alpha: 0.35 })
        felt.ellipse(W / 2, H * 0.05, W * 0.42, H * 0.66).stroke({ width: 1.5, color: palette.gold, alpha: 0.2 })
      }

      const rebuildSeats = (seats: BjSeat[], W: number, H: number, now: number) => {
        for (const view of seatViews) view.root.destroy()
        seatViews = seats.map((seat, index) => {
          const root = new Container()
          const pos = seatPos(index, seats.length, W, H)
          root.position.set(pos.x, pos.y)
          const ring = new Graphics()
          const cardsBox = new Container()
          const label = new Text({
            text: seat.nickname,
            style: { fill: 0xcfe3d8, fontSize: 13, fontFamily: 'Arial', fontWeight: '700' },
          })
          label.anchor.set(0.5)
          label.position.set(0, 56)
          const info = new Text({
            text: '',
            style: { fill: palette.gold, fontSize: 13, fontFamily: 'Arial', fontWeight: '800' },
          })
          info.anchor.set(0.5)
          info.position.set(0, 74)
          root.addChild(ring, cardsBox, label, info)
          seatsArea.addChild(root)
          const view: SeatView = { root, cardsBox, rendered: 0, label, info, ring, chip: null, playerId: seat.playerId }
          syncSeat(view, seat, now)
          return view
        })
      }

      const syncSeat = (view: SeatView, seat: BjSeat, now: number) => {
        while (view.rendered < seat.cards.length) {
          const card = seat.cards[view.rendered]
          const sprite = drawCardFace(card)
          sprite.rotation = (view.rendered - 1) * 0.09
          view.cardsBox.addChild(sprite)
          fly(sprite, view.root.position, view.rendered * 20 - 10, view.rendered * -4, now)
          view.rendered++
        }
        const { total } = handValue(seat.cards)
        const status = seat.outcome
          ? { blackjack: 'BLACKJACK', win: 'WIN', push: 'PUSH', lose: '—' }[seat.outcome]
          : seat.busted
            ? 'BUST'
            : seat.cards.length > 0
              ? String(total)
              : ''
        view.info.text = seat.bet > 0 ? `$${seat.bet}${status ? ` · ${status}` : ''}` : status
        view.info.style.fill = seat.outcome === 'lose' || seat.busted ? 0xff8b8b : palette.gold
      }

      app.ticker.add((ticker) => {
        const now = performance.now()
        const state = useGame.getState()
        const bj = state.bj
        if (app!.renderer.width !== window.innerWidth || app!.renderer.height !== window.innerHeight) {
          app!.renderer.resize(window.innerWidth, window.innerHeight)
        }
        const W = app!.screen.width
        const H = app!.screen.height
        if (W !== lastW || H !== lastH) {
          drawFelt(W, H)
          dealerArea.position.set(W / 2, H * 0.24)
          lastW = W
          lastH = H
        }

        // New round: wipe the table.
        if (bj.phase !== lastPhase) {
          if (bj.phase === 'betting') {
            dealerArea.removeChildren()
            dealerCardsRendered = 0
            dealerHole = null
            holeRevealed = false
            rebuildSeats([], W, H, now)
          }
          lastPhase = bj.phase
        }

        // Seat set changed (bets placed / new deal).
        if (seatViews.length !== bj.seats.length || seatViews.some((view, i) => view.playerId !== bj.seats[i]?.playerId)) {
          rebuildSeats(bj.seats, W, H, now)
        } else {
          bj.seats.forEach((seat, index) => syncSeat(seatViews[index], seat, now))
        }

        // Turn ring.
        seatViews.forEach((view, index) => {
          const seat = bj.seats[index]
          view.ring.clear()
          if (bj.turn && seat && bj.turn.playerId === seat.playerId) {
            const pulse = 0.55 + 0.45 * Math.sin(now * 0.006)
            view.ring.roundRect(-46, -52, 92, 118, 14).stroke({ width: 3, color: palette.gold, alpha: pulse })
          }
        })

        // Dealer cards.
        while (dealerCardsRendered < bj.dealer.cards.length) {
          const card = bj.dealer.cards[dealerCardsRendered]
          const sprite = drawCardFace(card)
          dealerArea.addChild(sprite)
          fly(sprite, dealerArea.position, dealerCardsRendered * 24 - 24, 0, now)
          dealerCardsRendered++
          // The face-down hole card sits next to the upcard while hiding.
          if (dealerCardsRendered === 1 && bj.dealer.hiding && !dealerHole) {
            dealerHole = drawCardBack()
            dealerArea.addChild(dealerHole)
            fly(dealerHole, dealerArea.position, 24, 0, now)
          }
        }
        if (!bj.dealer.hiding && dealerHole && !holeRevealed) {
          holeRevealed = true
          const hole = dealerHole
          tweens.push({
            view: hole,
            fromX: hole.x,
            fromY: hole.y,
            toX: hole.x,
            toY: hole.y,
            start: now,
            duration: 360,
            flip: {
              done: false,
              halfway: () => {
                hole.destroy()
                dealerHole = null
              },
            },
          })
        }

        // Win celebration.
        if (bj.lastReturned !== lastReturnedSeen) {
          if (bj.lastReturned !== null && bj.lastReturned > 0) {
            fx.burst(W / 2, H * 0.3, Math.min(160, 60 + bj.lastReturned))
          }
          lastReturnedSeen = bj.lastReturned
        }

        // Tweens.
        for (let i = tweens.length - 1; i >= 0; i--) {
          const tween = tweens[i]
          const t = Math.min(1, (now - tween.start) / tween.duration)
          const eased = 1 - Math.pow(1 - t, 3)
          if (tween.flip) {
            tween.view.scale.x = Math.abs(1 - t * 2)
            if (t >= 0.5 && !tween.flip.done) {
              tween.flip.done = true
              tween.flip.halfway()
              tweens.splice(i, 1)
              continue
            }
          } else {
            tween.view.position.set(
              tween.fromX + (tween.toX - tween.fromX) * eased,
              tween.fromY + (tween.toY - tween.fromY) * eased,
            )
            tween.view.rotation = (1 - eased) * 0.5 + (tween.view.rotation % 0.2)
          }
          if (t >= 1) tweens.splice(i, 1)
        }

        fx.tick(ticker.deltaMS)
      })
    }

    void setup()
    return () => {
      destroyed = true
      app?.destroy(true, { children: true })
    }
  }, [])

  return <div className="stage-host" ref={hostRef} />
}
