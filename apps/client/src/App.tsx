import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api, type SessionUser } from './api'
import { navigate, useHashRoute } from './router'
import { clearSession, loadSession, saveSession } from './session'
import { useGame } from './store/game'
import { Admin } from './ui/Admin'
import { Auth } from './ui/Auth'
import { BjTable } from './ui/BjTable'
import { Drawer, RightRail, type DrawerKind } from './ui/Drawers'
import { Lobby } from './ui/Lobby'
import { RouletteTable } from './ui/RouletteTable'
import { SkatTable } from './ui/SkatTable'
import { connect, disconnect } from './ws'

export function App() {
  const [user, setUser] = useState<SessionUser | null>(loadSession)
  const route = useHashRoute()

  const setSession = (next: SessionUser) => {
    saveSession(next)
    setUser(next)
  }

  if (!user) {
    return <Auth onAuthed={setSession} />
  }

  const logout = () => {
    disconnect()
    clearSession()
    setUser(null)
    navigate('#/')
  }

  if (route.view === 'admin' && user.role === 'admin') {
    return <Admin user={user} />
  }
  if (route.view === 'table') {
    return <TableRoute user={user} tableId={route.tableId} />
  }
  return (
    <Lobby
      user={user}
      onBalance={(balance) => setSession({ ...user, balance })}
      onLogout={logout}
    />
  )
}

function TableRoute({ user, tableId }: { user: SessionUser; tableId: string }) {
  const [drawer, setDrawer] = useState<DrawerKind | null>(null)
  const tablesQuery = useQuery({ queryKey: ['tables'], queryFn: api.tables })
  const table = tablesQuery.data?.find((candidate) => candidate.id === tableId)

  useEffect(() => {
    if (!table) return
    connect(user.token, tableId)
    return () => disconnect()
  }, [user.token, tableId, table?.id])

  // Keep the lobby session's balance in sync with what the table reports.
  const liveBalance = useGame((state) => state.balance)
  useEffect(() => {
    if (liveBalance > 0) saveSession({ ...user, balance: liveBalance })
  }, [liveBalance])

  if (tablesQuery.isLoading) return <div className="center-note">joining the table…</div>
  if (!table || !table.isOpen) {
    return (
      <div className="center-note">
        This table is closed.{' '}
        <button type="button" onClick={() => navigate('#/')}>
          Back to lobby
        </button>
      </div>
    )
  }

  return (
    <>
      {table.game === 'roulette' ? <RouletteTable /> : table.game === 'blackjack' ? <BjTable /> : <SkatTable />}
      <RightRail
        open={drawer}
        onToggle={(kind) => setDrawer((current) => (current === kind ? null : kind))}
        onLeave={() => navigate('#/')}
      />
      {drawer && <Drawer kind={drawer} token={user.token} onClose={() => setDrawer(null)} />}
    </>
  )
}
