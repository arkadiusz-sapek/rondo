import { useEffect, useState } from 'react'
import { BjStage } from '../pixi/BjStage'
import { useGame } from '../store/game'
import { sendCommand } from '../ws'
import { Dock } from './Dock'
import { Countdown, TableName, Toast, TopBar } from './Hud'

const BJ_PHASE_LABEL: Record<string, string> = {
  betting: 'PLACE YOUR BETS',
  dealing: 'DEALING…',
  acting: 'PLAYERS ACT',
  dealer: 'DEALER DRAWS',
  result: 'RESULT',
}

function Actions() {
  const bj = useGame((state) => state.bj)
  const playerId = useGame((state) => state.playerId)
  const balance = useGame((state) => state.balance)
  const myTurn = bj.turn?.playerId === playerId
  const seat = bj.seats.find((candidate) => candidate.playerId === playerId)
  if (!myTurn || !seat) return null
  const canDouble = seat.cards.length === 2 && !seat.doubled && balance >= seat.bet

  return (
    <div className="bj-actions">
      <span className="turn-clock">
        <Countdown endsAt={bj.turn?.endsAt ?? null} />
      </span>
      <button type="button" className="hit" onClick={() => sendCommand({ type: 'bj_hit', payload: {} })}>
        HIT
      </button>
      <button type="button" className="stand" onClick={() => sendCommand({ type: 'bj_stand', payload: {} })}>
        STAND
      </button>
      {canDouble && (
        <button type="button" className="double" onClick={() => sendCommand({ type: 'bj_double', payload: {} })}>
          DOUBLE
        </button>
      )}
    </div>
  )
}

function BjBanner() {
  const bj = useGame((state) => state.bj)
  const [shown, setShown] = useState<number | null>(null)
  useEffect(() => {
    if (bj.phase === 'result') setShown(bj.lastReturned)
    else setShown(null)
  }, [bj.phase, bj.lastReturned])
  if (bj.phase !== 'result' || shown === null) return null
  return (
    <div className={`result-banner ${shown > 0 ? 'won' : ''}`}>
      {shown > 0 ? <span className="win">+${shown}</span> : <span className="lose">dealer takes it</span>}
    </div>
  )
}

export function BjTable() {
  const bj = useGame((state) => state.bj)
  return (
    <div className="table-layout">
      <BjStage />
      <TableName />
      <TopBar
        phaseLabel={BJ_PHASE_LABEL[bj.phase]}
        phaseClass={bj.phase === 'betting' ? 'betting' : 'spinning'}
        endsAt={bj.phase === 'betting' ? bj.bettingEndsAt : null}
      />
      <BjBanner />
      <Toast />
      <Actions />
      <Dock mode="blackjack" />
    </div>
  )
}
