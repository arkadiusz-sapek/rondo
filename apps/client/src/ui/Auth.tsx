import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type SessionUser } from '../api'

export function Auth({ onAuthed }: { onAuthed: (user: SessionUser) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')

  const submitMutation = useMutation({
    mutationFn: () =>
      mode === 'login' ? api.login(nickname.trim(), password) : api.register(nickname.trim(), password),
    onSuccess: onAuthed,
  })

  const valid = nickname.trim().length >= 2 && password.length >= 4

  return (
    <div className="auth">
      <h1>
        ron<span className="accent">do</span>
      </h1>
      <p className="tagline">Live tables. Fun money. Zero consequences.</p>

      <div className="auth-card">
        <div className="auth-tabs">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
            Sign in
          </button>
          <button
            type="button"
            className={mode === 'register' ? 'active' : ''}
            onClick={() => setMode('register')}
          >
            Create account
          </button>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (valid) submitMutation.mutate()
          }}
        >
          <input
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            placeholder="nickname"
            maxLength={24}
            autoFocus
          />
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="password"
            type="password"
            maxLength={100}
          />
          <button type="submit" disabled={!valid || submitMutation.isPending}>
            {submitMutation.isPending ? '…' : mode === 'login' ? 'Sign in' : 'Join the casino'}
          </button>
        </form>
        {submitMutation.isError && <p className="error">{(submitMutation.error as Error).message}</p>}
        {mode === 'register' && (
          <p className="hint">Every new account starts with the house bankroll. First account runs the place.</p>
        )}
      </div>
    </div>
  )
}
