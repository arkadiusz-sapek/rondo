import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type JoinResponse } from '../api'

export function Join({ onJoined }: { onJoined: (session: JoinResponse) => void }) {
  const [nickname, setNickname] = useState('')
  const joinMutation = useMutation({
    mutationFn: () => api.join(nickname.trim()),
    onSuccess: onJoined,
  })

  return (
    <div className="join">
      <h1>
        ron<span className="accent">do</span>
      </h1>
      <p>Live multiplayer roulette. Fun money only — everyone sits down with $100.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (nickname.trim().length >= 2) joinMutation.mutate()
        }}
      >
        <input
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
          placeholder="your nickname"
          maxLength={24}
          autoFocus
        />
        <button type="submit" disabled={joinMutation.isPending || nickname.trim().length < 2}>
          {joinMutation.isPending ? 'Joining…' : 'Take a seat'}
        </button>
      </form>
      {joinMutation.isError && <p className="error">Could not join — is the server running?</p>}
    </div>
  )
}
