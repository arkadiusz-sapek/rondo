import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useGame } from '../store/game'
import { sendCommand } from '../ws'

export type DrawerKind = 'history' | 'players' | 'chat'

export function RightRail({
  open,
  onToggle,
  onLeave,
}: {
  open: DrawerKind | null
  onToggle: (kind: DrawerKind) => void
  onLeave: () => void
}) {
  const chatUnread = useGame((state) => state.chatUnread)
  const players = useGame((state) => state.players)
  return (
    <nav className="rail">
      <button type="button" className={open === 'chat' ? 'active' : ''} onClick={() => onToggle('chat')}>
        💬{chatUnread > 0 && open !== 'chat' && <span className="badge">{chatUnread}</span>}
      </button>
      <button
        type="button"
        className={open === 'players' ? 'active' : ''}
        onClick={() => onToggle('players')}
      >
        👥<span className="badge subtle">{players.length}</span>
      </button>
      <button
        type="button"
        className={open === 'history' ? 'active' : ''}
        onClick={() => onToggle('history')}
      >
        🧾
      </button>
      <div className="rail-spacer" />
      <button type="button" className="leave" title="Leave table" onClick={onLeave}>
        ⏻
      </button>
    </nav>
  )
}

export function Drawer({
  kind,
  token,
  onClose,
}: {
  kind: DrawerKind
  token: string
  onClose: () => void
}) {
  return (
    <aside className="drawer">
      <div className="drawer-head">
        <h2>{kind === 'history' ? 'My history' : kind === 'players' ? 'At the table' : 'Table chat'}</h2>
        <button type="button" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      {kind === 'history' && <History token={token} />}
      {kind === 'players' && <Players />}
      {kind === 'chat' && <Chat />}
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
          <span className="avatar">{player.nickname[0]?.toUpperCase()}</span>
          {player.nickname}
          {player.id === myId ? ' (you)' : ''}
        </li>
      ))}
    </ul>
  )
}

function History({ token }: { token: string }) {
  const queryClient = useQueryClient()
  const lastRoundId = useGame((state) => state.lastResult && state.roundId)
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ['history'] })
  }, [lastRoundId, queryClient])

  const historyQuery = useQuery({ queryKey: ['history'], queryFn: () => api.history(token) })
  const rows = historyQuery.data ?? []
  return (
    <ul className="history">
      {rows.map((row) => (
        <li key={`${row.roundId}:${row.spot}:${row.amount}`}>
          <span className={`result-dot small ${dotColor(row.number)}`}>{row.number}</span>
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

function Chat() {
  const chat = useGame((state) => state.chat)
  const myId = useGame((state) => state.playerId)
  const markRead = useGame((state) => state.markChatRead)
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    markRead()
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [chat, markRead])

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    sendCommand({ type: 'chat_send', payload: { text } })
    setDraft('')
  }

  return (
    <div className="chat">
      <ul ref={scrollRef} className="chat-log">
        {chat.map((message, index) => (
          <li key={`${message.at}:${index}`} className={message.playerId === myId ? 'mine' : ''}>
            <span className="who">{message.nickname}</span>
            <span className="text">{message.text}</span>
          </li>
        ))}
        {chat.length === 0 && <li className="muted">say hi 👋</li>}
      </ul>
      <form onSubmit={submit} className="chat-input">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="message…"
          maxLength={200}
        />
        <button type="submit" disabled={!draft.trim()}>
          send
        </button>
      </form>
    </div>
  )
}

function dotColor(num: number): string {
  if (num === 0) return 'green'
  return [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].includes(num)
    ? 'red'
    : ''
}
