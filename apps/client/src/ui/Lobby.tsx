import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type SessionUser, type TableInfo } from '../api'
import { navigate } from '../router'

type Category = 'all' | 'roulette' | 'blackjack' | 'skat'

const CATEGORIES: { id: Category; label: string; icon: string }[] = [
  { id: 'all', label: 'All games', icon: '✦' },
  { id: 'roulette', label: 'Roulette', icon: '◎' },
  { id: 'blackjack', label: 'Blackjack', icon: '♠' },
  { id: 'skat', label: 'Skat', icon: '♣' },
]

export function Lobby({
  user,
  onBalance,
  onLogout,
}: {
  user: SessionUser
  onBalance: (balance: number) => void
  onLogout: () => void
}) {
  const [category, setCategory] = useState<Category>('all')
  const queryClient = useQueryClient()

  const tablesQuery = useQuery({
    queryKey: ['tables'],
    queryFn: api.tables,
    refetchInterval: 10_000,
  })

  const resetMutation = useMutation({
    mutationFn: () => api.resetBalance(user.token),
    onSuccess: ({ balance }) => onBalance(balance),
  })

  const tables = (tablesQuery.data ?? []).filter(
    (table) => table.isOpen && (category === 'all' || table.game === category),
  )

  return (
    <div className="lobby">
      <aside className="lobby-side">
        <span className="brand big">
          ron<span className="accent">do</span>
        </span>
        <nav className="categories">
          {CATEGORIES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={category === entry.id ? 'active' : ''}
              onClick={() => setCategory(entry.id)}
            >
              <span className="cat-icon">{entry.icon}</span>
              {entry.label}
            </button>
          ))}
        </nav>
        {user.role === 'admin' && (
          <button type="button" className="admin-link" onClick={() => navigate('#/admin')}>
            ⚙ Manage casino
          </button>
        )}
      </aside>

      <main className="lobby-main">
        <header className="lobby-head">
          <h1>{CATEGORIES.find((entry) => entry.id === category)?.label}</h1>
          <div className="profile">
            <span className="profile-balance">${user.balance}</span>
            <span className="profile-nick">{user.nickname}</span>
            <button
              type="button"
              title="Reset balance to the house default"
              onClick={() => resetMutation.mutate()}
              disabled={resetMutation.isPending}
            >
              ↺ reset
            </button>
            <button type="button" onClick={onLogout}>
              logout
            </button>
          </div>
        </header>

        <div className="tables-grid">
          {tables.map((table) => (
            <TableTile key={table.id} table={table} onJoin={() => navigate(`#/table/${table.id}`)} />
          ))}
          {tables.length === 0 && !tablesQuery.isLoading && (
            <p className="muted">No open tables in this category.</p>
          )}
        </div>
      </main>
    </div>
  )
}

function TableTile({ table, onJoin }: { table: TableInfo; onJoin: () => void }) {
  return (
    <button type="button" className={`tile tile-${table.game}`} onClick={onJoin}>
      <div className="tile-art">
        {table.game === 'roulette' ? (
          <span className="art-wheel" />
        ) : table.game === 'blackjack' ? (
          <span className="art-cards">
            <i>A♠</i>
            <i>K♥</i>
          </span>
        ) : (
          <span className="art-cards art-skat">
            <i>♣J</i>
            <i className="red">♥A</i>
            <i>♠J</i>
          </span>
        )}
      </div>
      <div className="tile-body">
        <span className="tile-name">{table.name}</span>
        <span className="tile-game">{table.game}</span>
        <div className="tile-meta">
          <span className="tile-stakes">
            {table.game === 'skat' ? 'Seeger list · 36 games' : `$${table.minStake}–$${table.maxStake}`}
          </span>
          <span className="tile-players">● {table.playersOnline} online</span>
        </div>
      </div>
      <span className="tile-cta">Play →</span>
    </button>
  )
}
