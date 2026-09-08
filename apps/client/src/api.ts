import { SERVER_URL } from './ws'

export interface JoinResponse {
  id: string
  token: string
  nickname: string
  balance: number
}

export interface HistoryEntry {
  roundId: string
  number: number
  settledAt: string
  spot: string
  amount: number
  returned: number
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  if (!response.ok) throw new Error(`${path} → ${response.status}`)
  return response.json() as Promise<T>
}

export const api = {
  join: (nickname: string) =>
    request<JoinResponse>('/players', { method: 'POST', body: JSON.stringify({ nickname }) }),
  history: (token: string) => request<HistoryEntry[]>(`/players/${token}/history`),
}
