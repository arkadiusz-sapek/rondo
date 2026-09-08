import { Application } from 'pixi.js'
import { useEffect, useRef } from 'react'
import type { Phase } from '@rondo/protocol'
import { useGame } from '../store/game'
import { sendCommand } from '../ws'
import { Board } from './board'
import { palette } from './palette'
import { Wheel } from './wheel'

export const STAGE_W = 960
export const STAGE_H = 700
const SPIN_LANDING_MS = 4200

/**
 * The one canvas. React never re-renders this component — the Pixi ticker
 * polls the zustand store each frame and diffs the few fields it cares about
 * (transient updates; no per-frame React work).
 */
export function GameStage() {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let app: Application | undefined
    let destroyed = false

    const setup = async () => {
      app = new Application()
      await app.init({
        width: STAGE_W,
        height: STAGE_H,
        background: 0x0a2c22,
        antialias: true,
      })
      if (destroyed || !hostRef.current) {
        app.destroy(true)
        return
      }
      hostRef.current.appendChild(app.canvas)

      const wheel = new Wheel(150)
      wheel.view.position.set(STAGE_W / 2, 190)

      const board = new Board((spot) => {
        const state = useGame.getState()
        if (state.phase !== 'betting') return
        sendCommand({ type: 'place_bet', payload: { spot, amount: state.selectedChip } })
      })
      board.view.position.set((STAGE_W - board.width) / 2, 388)

      app.stage.addChild(wheel.view, board.view)

      let prevPhase: Phase | null = null
      let prevTarget: number | null = null
      let prevBets: unknown = null
      let prevTotals: unknown = null

      app.ticker.add((ticker) => {
        const now = performance.now()
        const state = useGame.getState()

        if (state.phase !== prevPhase) {
          if (state.phase === 'spinning') wheel.startSpin()
          if (state.phase === 'betting') {
            wheel.reset()
            board.showWinner(null)
          }
          if (state.phase === 'result') board.showWinner(state.spinTarget)
          prevPhase = state.phase
        }
        if (state.spinTarget !== prevTarget) {
          if (state.spinTarget !== null && state.phase === 'spinning') {
            wheel.landOn(state.spinTarget, SPIN_LANDING_MS, now)
          }
          prevTarget = state.spinTarget
        }
        if (state.myBets !== prevBets || state.betTotals !== prevTotals) {
          board.renderChips(state.myBets, state.betTotals)
          prevBets = state.myBets
          prevTotals = state.betTotals
        }

        wheel.tick(ticker.deltaMS, now)
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
