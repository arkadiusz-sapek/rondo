import { colorOf } from '@rondo/protocol'
import { useEffect, useState } from 'react'
import { useGame } from '../store/game'

const PHASE_LABEL: Record<string, string> = {
  betting: 'PLACE YOUR BETS',
  bets_closed: 'BETS CLOSED',
  spinning: 'SPINNING…',
  result: 'RESULT',
}

export function Countdown({ endsAt }: { endsAt: string | null }) {
  const [left, setLeft] = useState(0)
  useEffect(() => {
    if (!endsAt) return
    const target = new Date(endsAt).getTime()
    const tick = () => setLeft(Math.max(0, Math.ceil((target - Date.now()) / 1000)))
    tick()
    const interval = setInterval(tick, 200)
    return () => clearInterval(interval)
  }, [endsAt])
  if (!endsAt) return null
  return <span className={`countdown ${left <= 5 ? 'urgent' : ''}`}>{left}</span>
}

export function TableName() {
  const table = useGame((state) => state.table)
  if (!table) return null
  return (
    <div className="table-name">
      <button type="button" className="back" onClick={() => (window.location.hash = '#/')} title="Back to lobby">
        ←
      </button>
      <div>
        <span className="name">{table.name}</span>
        <span className="stakes">
          ${table.minStake}–${table.maxStake}
        </span>
      </div>
    </div>
  )
}

export function TopBar({
  phaseLabel,
  phaseClass,
  endsAt,
}: { phaseLabel?: string; phaseClass?: string; endsAt?: string | null } = {}) {
  const nickname = useGame((state) => state.nickname)
  const balance = useGame((state) => state.balance)
  const phase = useGame((state) => state.phase)
  const bettingEndsAt = useGame((state) => state.bettingEndsAt)
  const connection = useGame((state) => state.connection)

  return (
    <header className="topbar">
      <span className="brand">
        ron<span className="accent">do</span>
      </span>
      <span className={`phase phase-${phaseClass ?? phase}`}>
        {phaseLabel ?? PHASE_LABEL[phase]} <Countdown endsAt={endsAt !== undefined ? endsAt : bettingEndsAt} />
      </span>
      <span className="me">
        {connection !== 'open' && <span className="conn">reconnecting…</span>}
        <span className="nick">{nickname}</span>
        <span className="balance">${balance}</span>
      </span>
    </header>
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

/** Counts the win up from zero — small thing, big feel. */
function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const started = performance.now()
    let frame: number
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / 900)
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))))
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [value])
  return <span className="win">+${shown}</span>
}

export function ResultBanner() {
  const phase = useGame((state) => state.phase)
  const lastResult = useGame((state) => state.lastResult)
  const spinTarget = useGame((state) => state.spinTarget)
  if (phase !== 'result') return null
  const number = lastResult?.number ?? spinTarget
  if (number === null || number === undefined) return null
  const color = lastResult?.color ?? colorOf(number)
  const returned = lastResult?.returned ?? null
  const won = returned !== null && returned > 0
  return (
    <div className={`result-banner ${won ? 'won' : ''}`}>
      <span className={`result-number ${color}`}>{number}</span>
      <span className="result-color">{color.toUpperCase()}</span>
      {won && <CountUp value={returned} />}
      {returned !== null && returned === 0 && <span className="lose">no win</span>}
    </div>
  )
}
