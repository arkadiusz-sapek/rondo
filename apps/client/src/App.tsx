import { useEffect, useState } from 'react'
import type { JoinResponse } from './api'
import { GameStage } from './pixi/GameStage'
import { ChipBar, ResultBanner, ResultsStrip, Toast, TopBar } from './ui/Hud'
import { Join } from './ui/Join'
import { SidePanel } from './ui/SidePanel'
import { connect } from './ws'

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

  return (
    <div className="table-layout">
      <TopBar />
      <div className="table-main">
        <div className="stage-wrap">
          <GameStage />
          <ResultsStrip />
          <ResultBanner />
          <Toast />
        </div>
        <SidePanel token={session.token} />
      </div>
      <ChipBar />
    </div>
  )
}
