import { colorOf } from '@rondo/protocol'
import { useEffect, useState } from 'react'
import { useGame } from '../store/game'
import { sendCommand } from '../ws'

const PHASE_LABEL: Record<string, string> = {
  betting: 'PLACE YOUR BETS',
  bets_closed: 'BETS CLOSED',
  spinning: 'SPINNING…',
  result: 'RESULT',
}

function Countdown() {
  const bettingEndsAt = useGame((state) => state.bettingEndsAt)
  const [left, setLeft] = useState(0)
  useEffect(() => {
    if (!bettingEndsAt) return
    const target = new Date(bettingEndsAt).getTime()
    const tick = () => setLeft(Math.max(0, Math.ceil((target - Date.now()) / 1000)))
    tick()
    const interval = setInterval(tick, 200)
    return () => clearInterval(interval)
  }, [bettingEndsAt])
  if (!bettingEndsAt) return null
  return <span className={`countdown ${left <= 5 ? 'urgent' : ''}`}>{left}s</span>
}

export function TopBar() {
  const nickname = useGame((state) => state.nickname)
  const balance = useGame((state) => state.balance)
  const phase = useGame((state) => state.phase)
  const connection = useGame((state) => state.connection)

  return (
    <header className="topbar">
      <span className="brand">
        ron<span className="accent">do</span>
      </span>
      <span className={`phase phase-${phase}`}>
        {PHASE_LABEL[phase]} <Countdown />
      </span>
      <span className="me">
        {connection !== 'open' && <span className="conn">reconnecting…</span>}
        {nickname} · <strong>${balance}</strong>
      </span>
    </header>
  )
}

const CHIPS = [1, 5, 10, 25, 100]

export function ChipBar() {
  const selected = useGame((state) => state.selectedChip)
  const setChip = useGame((state) => state.setSelectedChip)
  const phase = useGame((state) => state.phase)
  const myBets = useGame((state) => state.myBets)
  const total = myBets.reduce((sum, bet) => sum + bet.amount, 0)
  const disabled = phase !== 'betting'

  return (
    <footer className="chipbar">
      <div className="chips">
        {CHIPS.map((value) => (
          <button
            key={value}
            type="button"
            className={`chip chip-${value} ${selected === value ? 'selected' : ''}`}
            onClick={() => setChip(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <span className="staked">staked: ${total}</span>
      <div className="bet-actions">
        <button type="button" disabled={disabled || total === 0} onClick={() => sendCommand({ type: 'undo_bet', payload: {} })}>
          undo
        </button>
        <button type="button" disabled={disabled || total === 0} onClick={() => sendCommand({ type: 'clear_bets', payload: {} })}>
          clear
        </button>
      </div>
    </footer>
  )
}

export function ResultsStrip() {
  const recent = useGame((state) => state.recentResults)
  return (
    <div className="results-strip">
      {recent.map((result) => (
        <span key={result.roundId} className={`result-dot ${result.color}`}>
          {result.number}
        </span>
      ))}
    </div>
  )
}

export function Toast() {
  const toast = useGame((state) => state.toast)
  const dismiss = useGame((state) => state.dismissToast)
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(dismiss, 3000)
    return () => clearTimeout(timer)
  }, [toast, dismiss])
  if (!toast) return null
  return <div className="toast">{toast}</div>
}

export function ResultBanner() {
  const phase = useGame((state) => state.phase)
  const lastResult = useGame((state) => state.lastResult)
  const spinTarget = useGame((state) => state.spinTarget)
  if (phase !== 'result') return null
  // Spectators get no personalized round_settled — fall back to the broadcast number.
  const number = lastResult?.number ?? spinTarget
  if (number === null || number === undefined) return null
  const color = lastResult?.color ?? colorOf(number)
  const returned = lastResult?.returned ?? null
  return (
    <div className="result-banner">
      <span className={`result-number ${color}`}>{number}</span>
      {returned !== null && returned > 0 && <span className="win">+${returned}</span>}
      {returned !== null && returned === 0 && <span className="lose">no win</span>}
    </div>
  )
}
