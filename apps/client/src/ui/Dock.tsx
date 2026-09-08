import { useEffect, useRef, useState } from 'react'
import { boardBridge } from '../pixi/boardRegistry'
import { useGame } from '../store/game'
import { sendCommand } from '../ws'

const CHIPS = [1, 5, 10, 25, 100]

interface DragState {
  amount: number
  x: number
  y: number
}

/**
 * Chip dock. Chips work both ways: click to arm the selected chip (then tap a
 * spot), or drag a chip straight onto the board — the drop position goes
 * through the same delegated hit-test as a tap.
 */
export function Dock({ mode = 'roulette' }: { mode?: 'roulette' | 'blackjack' }) {
  const selected = useGame((state) => state.selectedChip)
  const setChip = useGame((state) => state.setSelectedChip)
  const roulettePhase = useGame((state) => state.phase)
  const bjPhase = useGame((state) => state.bj.phase)
  const myBets = useGame((state) => state.myBets)
  const bjMyBet = useGame((state) => state.bj.myBet)
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  dragRef.current = drag

  useEffect(() => {
    if (!drag) return
    const onMove = (event: PointerEvent) => {
      setDrag((current) => (current ? { ...current, x: event.clientX, y: event.clientY } : null))
      boardBridge()?.hoverAtClient(event.clientX, event.clientY)
    }
    const onUp = (event: PointerEvent) => {
      const current = dragRef.current
      boardBridge()?.clearHover()
      setDrag(null)
      if (!current) return
      const spot = boardBridge()?.spotAtClient(event.clientX, event.clientY)
      if (spot && useGame.getState().phase === 'betting') {
        sendCommand({ type: 'place_bet', payload: { spot, amount: current.amount } })
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [drag !== null])

  const bj = mode === 'blackjack'
  const disabled = bj ? bjPhase !== 'betting' : roulettePhase !== 'betting'
  const total = bj ? bjMyBet : myBets.reduce((sum, bet) => sum + bet.amount, 0)

  return (
    <>
      <footer className={`dock ${disabled ? 'dock-disabled' : ''}`}>
        <div className="chips">
          {CHIPS.map((value) => (
            <button
              key={value}
              type="button"
              className={`chip chip-${value} ${selected === value ? 'selected' : ''}`}
              onClick={() => {
                setChip(value)
                if (bj && !disabled) sendCommand({ type: 'bj_bet', payload: { amount: value } })
              }}
              onPointerDown={(event) => {
                if (bj || disabled) return
                setChip(value)
                setDrag({ amount: value, x: event.clientX, y: event.clientY })
              }}
            >
              {value}
            </button>
          ))}
        </div>
        <span className="staked">{bj ? `bet $${total}` : `staked $${total}`}</span>
        <div className="bet-actions">
          {!bj && (
            <button
              type="button"
              disabled={disabled || total === 0}
              onClick={() => sendCommand({ type: 'undo_bet', payload: {} })}
            >
              undo
            </button>
          )}
          <button
            type="button"
            disabled={disabled || total === 0}
            onClick={() => sendCommand({ type: bj ? 'bj_clear' : 'clear_bets', payload: {} })}
          >
            clear
          </button>
        </div>
      </footer>
      {drag && (
        <div className={`chip chip-${drag.amount} chip-ghost`} style={{ left: drag.x, top: drag.y }}>
          {drag.amount}
        </div>
      )}
    </>
  )
}
