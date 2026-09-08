import { Application, Point } from 'pixi.js'
import { useEffect, useRef } from 'react'
import type { Phase } from '@rondo/protocol'
import { useGame } from '../store/game'
import { sendCommand } from '../ws'
import { Board } from './board'
import { registerBoard } from './boardRegistry'
import { Confetti } from './confetti'
import { Wheel3D } from './wheel3d'

const SPIN_LANDING_MS = 4200

/**
 * Fullscreen scene. Focus follows the phase: while betting the board is the
 * hero (big, bottom-center) and the wheel recedes; during spin/result the
 * wheel scales up and the board tucks down. All motion is exponential lerp —
 * nothing snaps. React never re-renders this; the ticker polls the store.
 */
export function GameStage() {
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

      const wheel = new Wheel3D(190)
      const board = new Board((spot) => {
        const state = useGame.getState()
        if (state.phase !== 'betting') return
        sendCommand({ type: 'place_bet', payload: { spot, amount: state.selectedChip } })
      })
      const confetti = new Confetti()
      app.stage.addChild(wheel.view, board.view, confetti.view)

      board.view.pivot.set(board.width / 2, board.height)

      registerBoard({
        spotAtClient: (clientX, clientY) => {
          const local = clientToLocal(app!, board, clientX, clientY)
          return local ? board.spotAt(local) : null
        },
        hoverAtClient: (clientX, clientY) => {
          const local = clientToLocal(app!, board, clientX, clientY)
          board.setHover(local ? board.spotAt(local) : null)
        },
        clearHover: () => board.setHover(null),
      })

      let firstFrame = true
      let prevPhase: Phase | null = null
      let prevRound: string | null = null
      let prevTarget: number | null = null
      let prevBets: unknown = null
      let prevTotals: unknown = null
      let prevReturned: number | null = null

      app.ticker.add((ticker) => {
        const now = performance.now()
        const state = useGame.getState()
        // Embedded viewports don't always fire window `resize` — self-heal.
        if (
          app!.renderer.width !== window.innerWidth ||
          app!.renderer.height !== window.innerHeight
        ) {
          app!.renderer.resize(window.innerWidth, window.innerHeight)
        }
        const W = app!.screen.width
        const H = app!.screen.height
        const betting = state.phase === 'betting'

        // Round identity beats phase edges: a hidden/throttled tab can skip
        // whole phases between frames, so never trust transitions alone.
        if (state.roundId !== prevRound) {
          prevRound = state.roundId
          prevTarget = null
          wheel.reset()
          board.showWinner(null)
        }
        if (state.phase !== prevPhase) {
          if (state.phase === 'spinning') wheel.startSpin()
          if (state.phase === 'betting') {
            wheel.reset()
            board.showWinner(null)
          }
          prevPhase = state.phase
        }
        if (state.spinTarget !== prevTarget) {
          if (state.spinTarget !== null) {
            if (state.phase === 'spinning') {
              wheel.landOn(state.spinTarget, SPIN_LANDING_MS, now)
            } else if (state.phase === 'result') {
              wheel.snapTo(state.spinTarget)
            }
          }
          prevTarget = state.spinTarget
        }
        if (state.phase === 'result' && state.spinTarget !== null) {
          board.showWinner(state.spinTarget)
        }
        if (state.myBets !== prevBets || state.betTotals !== prevTotals) {
          board.renderChips(state.myBets, state.betTotals)
          prevBets = state.myBets
          prevTotals = state.betTotals
        }

        const returned = state.lastResult?.returned ?? null
        if (returned !== prevReturned) {
          if (returned !== null && returned > 0) {
            const bursts = Math.min(4, 1 + Math.floor(returned / 50))
            for (let i = 0; i < bursts; i++) {
              confetti.burst(W * (0.3 + Math.random() * 0.4), H * 0.25, 60)
            }
          }
          prevReturned = returned
        }

        // Phase-driven focus targets: the hero swaps with the phase.
        const boardFit = Math.min((W - 160) / board.width, (H * 0.42) / board.height, 1.12)
        const boardTarget = {
          x: W / 2,
          y: betting ? H - 104 : H - 100,
          scale: betting ? boardFit : boardFit * 0.62,
          alpha: betting ? 1 : 0.7,
        }
        const wheelRadiusPx = betting ? H * 0.16 : H * 0.27
        const wheelTarget = {
          x: W / 2,
          y: betting ? H * 0.21 : H * 0.36,
          scale: wheelRadiusPx / 190,
          alpha: 1,
        }

        // First frame snaps straight to targets — no fly-in from (0,0).
        const k = firstFrame ? 1 : 1 - Math.exp(-ticker.deltaMS * 0.006)
        firstFrame = false
        lerpView(board.view, boardTarget, k)
        lerpView(wheel.view, wheelTarget, k)

        wheel.tick(ticker.deltaMS, now)
        confetti.tick(ticker.deltaMS)
      })
    }

    void setup()
    return () => {
      destroyed = true
      registerBoard(null)
      app?.destroy(true, { children: true })
    }
  }, [])

  return <div className="stage-host" ref={hostRef} />
}

function lerpView(
  view: { x: number; y: number; scale: { set: (s: number) => void; x: number }; alpha: number },
  target: { x: number; y: number; scale: number; alpha: number },
  k: number,
) {
  view.x += (target.x - view.x) * k
  view.y += (target.y - view.y) * k
  view.scale.set(view.scale.x + (target.scale - view.scale.x) * k)
  view.alpha += (target.alpha - view.alpha) * k
}

function clientToLocal(app: Application, board: Board, clientX: number, clientY: number) {
  const rect = app.canvas.getBoundingClientRect()
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
    return null
  }
  const global = new Point(
    ((clientX - rect.left) / rect.width) * app.screen.width,
    ((clientY - rect.top) / rect.height) * app.screen.height,
  )
  return board.view.toLocal(global)
}
