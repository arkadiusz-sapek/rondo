export const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3200'

export interface SessionUser {
  id: string
  token: string
  nickname: string
  role: 'player' | 'admin'
  balance: number
}

export interface TableInfo {
  id: string
  name: string
  game: 'roulette' | 'blackjack'
  minStake: number
  maxStake: number
  isOpen: boolean
  playersOnline: number
}

export interface RouletteHistoryEntry {
  roundId: string
  number: number
  settledAt: string
  spot: string
  amount: number
  returned: number
}

export interface BjHistoryEntry {
  id: string
  bet: number
  outcome: 'blackjack' | 'win' | 'push' | 'lose'
  returned: number
  settledAt: string
}

async function request<T>(path: string, init?: RequestInit, token?: string): Promise<T> {
  const response = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null
    const message = Array.isArray(body?.message) ? body.message[0] : body?.message
    throw new Error(message ?? `${path} → ${response.status}`)
  }
  return response.json() as Promise<T>
}

export const api = {
  register: (nickname: string, password: string) =>
    request<SessionUser>('/auth/register', { method: 'POST', body: JSON.stringify({ nickname, password }) }),
  login: (nickname: string, password: string) =>
    request<SessionUser>('/auth/login', { method: 'POST', body: JSON.stringify({ nickname, password }) }),
  me: (token: string) => request<SessionUser>('/me', {}, token),
  resetBalance: (token: string) =>
    request<{ balance: number }>('/me/reset-balance', { method: 'POST' }, token),
  history: (token: string) =>
    request<{ roulette: RouletteHistoryEntry[]; blackjack: BjHistoryEntry[] }>('/me/history', {}, token),
  tables: () => request<TableInfo[]>('/tables'),
  admin: {
    createTable: (token: string, input: Omit<TableInfo, 'id' | 'isOpen' | 'playersOnline'>) =>
      request<TableInfo>('/admin/tables', { method: 'POST', body: JSON.stringify(input) }, token),
    updateTable: (token: string, id: string, patch: Partial<Omit<TableInfo, 'id' | 'game' | 'playersOnline'>>) =>
      request<TableInfo>(`/admin/tables/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }, token),
    settings: (token: string) => request<{ defaultBalance: number }>('/admin/settings', {}, token),
    putSettings: (token: string, defaultBalance: number) =>
      request<{ defaultBalance: number }>(
        '/admin/settings',
        { method: 'PUT', body: JSON.stringify({ defaultBalance }) },
        token,
      ),
  },
}
