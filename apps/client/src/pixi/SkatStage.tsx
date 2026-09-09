import { Application, Container, Graphics, Text } from 'pixi.js'
import { useEffect, useRef } from 'react'
import type { SkatCard } from '@rondo/protocol'
import { useGame } from '../store/game'
import { palette } from './palette'
import { Confetti } from './confetti'

const CARD_W = 74
const CARD_H = 104
const BACK_W = 48
const BACK_H = 68

function drawSkatCardFace(card: SkatCard, w = CARD_W, h = CARD_H): Container {
  const view = new Container()
  const g = new Graphics()
  g.roundRect(-w / 2, -h / 2, w, h, 9)
    .fill(0xf9f7f0)
    .stroke({ width: 1.5, color: 0x2a2d35, alpha: 0.65 })
  view.addChild(g)
  const red = card.suit === '♥' || card.suit === '♦'
  const color = red ? 0xc22f2f : 0x1c1f26
  const corner = new Text({
    text: `${card.rank}\n${card.suit}`,
    style: { fill: color, fontSize: 17, fontFamily: 'Arial', fontWeight: '800', align: 'center', lineHeight: 17 },
  })
  corner.position.set(-w / 2 + 6, -h / 2 + 5)
  const corner2 = new Text({
    text: `${card.rank}\n${card.suit}`,
    style: { fill: color, fontSize: 17, fontFamily: 'Arial', fontWeight: '800', align: 'center', lineHeight: 17 },
  })
  corner2.rotation = Math.PI
  corner2.position.set(w / 2 - 6, h / 2 - 5)
  const pip = new Text({ text: card.suit, style: { fill: color, fontSize: 34, fontFamily: 'Arial' } })
  pip.anchor.set(0.5)
  pip.position.set(0, 6)
  view.addChild(corner, corner2, pip)
  return view
}

function drawSkatCardBack(w = BACK_W, h = BACK_H): Container {
  const view = new Container()
  const g = new Graphics()
  g.roundRect(-w / 2, -h / 2, w, h, 7).fill(0x232f4c).stroke({ width: 1.5, color: 0x0e1524 })
  g.roundRect(-w / 2 + 4, -h / 2 + 4, w - 8, h - 8, 5).stroke({ width: 1.2, color: 0x5a79b8, alpha: 0.7 })
  for (let y = -h / 2 + 10; y < h / 2 - 7; y += 8) {
    g.moveTo(-w / 2 + 8, y).lineTo(w / 2 - 8, y + 3).stroke({ width: 1, color: 0x5a79b8, alpha: 0.35 })
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
  fromRot: number
  toRot: number
  start: number
  duration: number
  fade?: boolean
  onDone?: () => void
}

/**
 * The Skat table scene. Your hand lives in the DOM below; Pixi owns the felt,
 * the opponents' card backs, the skat pile, and — the point of it all — the
 * trick: every played card FLIES IN from its player's side of the table and
 * lands offset toward them, so you always see who threw what. The winner
 * sweeps the trick toward their seat.
 */
export function SkatStage() {
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
      const fansArea = new Container()
      const skatPile = new Container()
      const trickArea = new Container()
      const fx = new Confetti()
      app.stage.addChild(felt, fansArea, skatPile, trickArea, fx.view)

      const tweens: Tween[] = []
      let trickSprites: { view: Container; seat: number }[] = []
      let renderedTrick = 0
      let renderedGame = -1
      let fanCounts = [-1, -1, -1]
      let skatShown = false
      let resultSeen = false
      let lastW = 0
      let lastH = 0

      /** Seat index -> position relative to *you* (0 bottom, 1 left, 2 right). */
      const relOf = (seat: number, yourSeat: number | null) => (seat - (yourSeat ?? 0) + 3) % 3

      const seatAnchor = (rel: number, W: number, H: number) =>
        rel === 0
          ? { x: W / 2, y: H + 60 }
          : rel === 1
            ? { x: W * 0.13, y: H * 0.3 }
            : { x: W * 0.87, y: H * 0.3 }

      const landing = (rel: number, W: number, H: number) => {
        const cx = W / 2
        const cy = H * 0.42
        if (rel === 0) return { x: cx, y: cy + 58, rot: 0.06 }
        if (rel === 1) return { x: cx - 74, y: cy - 16, rot: -0.5 }
        return { x: cx + 74, y: cy - 16, rot: 0.5 }
      }

      const drawFelt = (W: number, H: number) => {
        felt.clear()
        felt.ellipse(W / 2, H * 0.4, Math.min(W * 0.4, 560), Math.min(H * 0.34, 380))
          .fill({ color: 0x0d2b20, alpha: 0.55 })
          .stroke({ width: 3, color: palette.gold, alpha: 0.28 })
        felt.ellipse(W / 2, H * 0.4, Math.min(W * 0.4, 560) - 14, Math.min(H * 0.34, 380) - 12)
          .stroke({ width: 1.5, color: palette.gold, alpha: 0.16 })
      }

      const rebuildFan = (rel: number, count: number, W: number, H: number) => {
        const existing = fansArea.getChildByLabel?.(`fan-${rel}`)
        existing?.destroy({ children: true })
        if (rel === 0 || count <= 0) return
        const fan = new Container()
        fan.label = `fan-${rel}`
        const anchor = seatAnchor(rel, W, H)
        fan.position.set(anchor.x, anchor.y)
        for (let i = 0; i < count; i++) {
          const back = drawSkatCardBack()
          const spread = (i - (count - 1) / 2) * 0.09
          back.rotation = (rel === 1 ? Math.PI / 2 : -Math.PI / 2) + spread
          back.position.set(
            (rel === 1 ? 1 : -1) * Math.abs(spread) * 8,
            (i - (count - 1) / 2) * 14,
          )
          fan.addChild(back)
        }
        fansArea.addChild(fan)
      }

      const throwCard = (seat: number, card: SkatCard, yourSeat: number | null, W: number, H: number, now: number) => {
        const rel = relOf(seat, yourSeat)
        const from = seatAnchor(rel, W, H)
        const to = landing(rel, W, H)
        const sprite = drawSkatCardFace(card)
        sprite.position.set(from.x, from.y)
        trickArea.addChild(sprite)
        trickSprites.push({ view: sprite, seat })
        tweens.push({
          view: sprite,
          fromX: from.x,
          fromY: from.y,
          toX: to.x + (Math.random() - 0.5) * 8,
          toY: to.y + (Math.random() - 0.5) * 6,
          fromRot: rel === 0 ? 0.4 : rel === 1 ? -1.4 : 1.4,
          toRot: to.rot + (Math.random() - 0.5) * 0.12,
          start: now,
          duration: 380,
        })
      }

      const sweepTrick = (winnerSeat: number, yourSeat: number | null, W: number, H: number, now: number) => {
        const rel = relOf(winnerSeat, yourSeat)
        const to = seatAnchor(rel, W, H)
        for (const entry of trickSprites) {
          tweens.push({
            view: entry.view,
            fromX: entry.view.x,
            fromY: entry.view.y,
            toX: to.x,
            toY: to.y,
            fromRot: entry.view.rotation,
            toRot: entry.view.rotation + (rel === 0 ? 0.3 : rel === 1 ? -0.8 : 0.8),
            start: now,
            duration: 430,
            fade: true,
            onDone: () => entry.view.destroy(),
          })
        }
        trickSprites = []
      }

      app.ticker.add((ticker) => {
        const now = performance.now()
        const state = useGame.getState()
        const skat = state.skat
        if (app!.renderer.width !== window.innerWidth || app!.renderer.height !== window.innerHeight) {
          app!.renderer.resize(window.innerWidth, window.innerHeight)
        }
        const W = app!.screen.width
        const H = app!.screen.height
        if (W !== lastW || H !== lastH) {
          drawFelt(W, H)
          skatPile.position.set(W / 2, H * 0.22)
          lastW = lastH = 0
          lastW = W
          lastH = H
          fanCounts = [-1, -1, -1]
        }
        if (!skat) return
        const yourSeat = skat.yourSeat

        // New deal: clear the table.
        if (skat.gameNo !== renderedGame || skat.phase === 'dealing') {
          if (skat.gameNo !== renderedGame) {
            renderedGame = skat.gameNo
            for (const entry of trickSprites) entry.view.destroy()
            trickSprites = []
            renderedTrick = 0
            resultSeen = false
          }
        }

        // Opponent fans reflect live card counts.
        for (const seat of skat.seats) {
          const rel = relOf(seat.seat, yourSeat)
          if (rel === 0) continue
          if (fanCounts[rel] !== seat.cardCount) {
            fanCounts[rel] = seat.cardCount
            rebuildFan(rel, seat.cardCount, W, H)
          }
        }

        // Skat pile: two face-down cards until the deal is decided.
        const showSkat = ['bidding', 'skat_decision', 'discarding'].includes(skat.phase)
        if (showSkat && !skatShown) {
          skatShown = true
          skatPile.removeChildren()
          for (let i = 0; i < 2; i++) {
            const back = drawSkatCardBack(40, 56)
            back.position.set(i * 26 - 13, 0)
            back.rotation = i === 0 ? -0.08 : 0.08
            skatPile.addChild(back)
          }
        } else if (!showSkat && skatShown) {
          skatShown = false
          skatPile.removeChildren()
        }

        // Trick diffing: every new play flies in from its seat.
        if (skat.trick.length < renderedTrick) {
          // Collected — sweep what's still on the table toward the winner.
          if (skat.lastTrick && trickSprites.length > 0) {
            sweepTrick(skat.lastTrick.winnerSeat, yourSeat, W, H, now)
          }
          renderedTrick = 0
        }
        while (renderedTrick < skat.trick.length) {
          const play = skat.trick[renderedTrick]
          throwCard(play.seat, play.card, yourSeat, W, H, now)
          renderedTrick++
        }

        // Confetti when your own game lands.
        if (skat.phase === 'settled' && skat.result && !resultSeen) {
          resultSeen = true
          if (skat.result.won && skat.result.declarerSeat === yourSeat) {
            fx.burst(W / 2, H * 0.35, 120)
            fx.burst(W * 0.35, H * 0.3, 60)
            fx.burst(W * 0.65, H * 0.3, 60)
          }
        }

        // Tweens.
        for (let i = tweens.length - 1; i >= 0; i--) {
          const tween = tweens[i]
          const t = Math.min(1, (now - tween.start) / tween.duration)
          const eased = 1 - Math.pow(1 - t, 3)
          tween.view.position.set(
            tween.fromX + (tween.toX - tween.fromX) * eased,
            tween.fromY + (tween.toY - tween.fromY) * eased,
          )
          tween.view.rotation = tween.fromRot + (tween.toRot - tween.fromRot) * eased
          if (tween.fade) tween.view.alpha = 1 - eased * 0.9
          if (t >= 1) {
            tween.onDone?.()
            tweens.splice(i, 1)
          }
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
