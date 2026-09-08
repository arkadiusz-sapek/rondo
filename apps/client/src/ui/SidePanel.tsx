import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { useGame } from '../store/game'

export function SidePanel({ token }: { token: string }) {
  const [tab, setTab] = useState<'players' | 'history'>('players')
  return (
    <aside className="sidepanel">
      <div className="tabs">
        <button type="button" className={tab === 'players' ? 'active' : ''} onClick={() => setTab('players')}>
          Players
        </button>
        <button type="button" className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
          My history
        </button>
      </div>
      {tab === 'players' ? <Players /> : <History token={token} />}
    </aside>
  )
}

function Players() {
  const players = useGame((state) => state.players)
  const myId = useGame((state) => state.playerId)
  return (
    <ul className="players">
      {players.map((player) => (
        <li key={player.id}>
          {player.nickname}
          {player.id === myId ? ' (you)' : ''}
        </li>
      ))}
      {players.length === 0 && <li className="muted">nobody at the table</li>}
    </ul>
  )
}

function History({ token }: { token: string }) {
  const queryClient = useQueryClient()
  const lastRoundId = useGame((state) => state.lastResult && state.roundId)
  useEffect(() => {
    // A settled round means new rows — refetch instead of polling.
    void queryClient.invalidateQueries({ queryKey: ['history'] })
  }, [lastRoundId, queryClient])

  const historyQuery = useQuery({ queryKey: ['history'], queryFn: () => api.history(token) })
  const rows = historyQuery.data ?? []
  return (
    <ul className="history">
      {rows.map((row) => (
        <li key={`${row.roundId}:${row.spot}:${row.amount}`}>
          <span className={`result-dot small ${row.number === 0 ? 'green' : ''}`}>{row.number}</span>
          <span className="spot">{row.spot}</span>
          <span className="amount">-${row.amount}</span>
          <span className={row.returned > 0 ? 'win' : 'lose'}>
            {row.returned > 0 ? `+$${row.returned}` : '—'}
          </span>
        </li>
      ))}
      {rows.length === 0 && <li className="muted">no settled bets yet</li>}
    </ul>
  )
}
