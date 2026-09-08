import { useEffect, useState } from 'react'
import type { JoinResponse } from './api'
import { GameStage } from './pixi/GameStage'
import { Dock } from './ui/Dock'
import { Drawer, RightRail, type DrawerKind } from './ui/Drawers'
import { ResultBanner, ResultsStrip, Toast, TopBar } from './ui/Hud'
import { Join } from './ui/Join'
import { connect, disconnect } from './ws'

const SESSION_KEY = 'rondo-session'

interface Session {
  token: string
  nickname: string
}

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

export function App() {
  const [session, setSession] = useState<Session | null>(loadSession)
  const [drawer, setDrawer] = useState<DrawerKind | null>(null)

  useEffect(() => {
    if (session) connect(session.token)
  }, [session])

  if (!session) {
    return (
      <Join
        onJoined={(joined: JoinResponse) => {
          const next = { token: joined.token, nickname: joined.nickname }
          localStorage.setItem(SESSION_KEY, JSON.stringify(next))
          setSession(next)
        }}
      />
    )
  }

  const leave = () => {
    disconnect()
    localStorage.removeItem(SESSION_KEY)
    setDrawer(null)
    setSession(null)
  }

  return (
    <div className="table-layout">
      <GameStage />
      <TopBar />
      <ResultsStrip />
      <ResultBanner />
      <Toast />
      <Dock />
      <RightRail
        open={drawer}
        onToggle={(kind) => setDrawer((current) => (current === kind ? null : kind))}
        onLeave={leave}
      />
      {drawer && <Drawer kind={drawer} token={session.token} onClose={() => setDrawer(null)} />}
    </div>
  )
}
