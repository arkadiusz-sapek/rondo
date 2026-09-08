import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type SessionUser, type TableInfo } from '../api'
import { navigate } from '../router'

export function Admin({ user }: { user: SessionUser }) {
  const queryClient = useQueryClient()
  const tablesQuery = useQuery({ queryKey: ['tables'], queryFn: api.tables })
  const settingsQuery = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => api.admin.settings(user.token),
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['tables'] })
  }

  return (
    <div className="admin">
      <header className="admin-head">
        <button type="button" onClick={() => navigate('#/')}>
          ← lobby
        </button>
        <h1>Casino backoffice</h1>
      </header>

      <section className="admin-section">
        <h2>House settings</h2>
        <DefaultBalance
          token={user.token}
          current={settingsQuery.data?.defaultBalance}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: ['admin-settings'] })}
        />
      </section>

      <section className="admin-section">
        <h2>New table</h2>
        <CreateTable token={user.token} onCreated={refresh} />
      </section>

      <section className="admin-section">
        <h2>Tables</h2>
        <div className="admin-tables">
          {(tablesQuery.data ?? []).map((table) => (
            <TableRowEditor key={table.id} token={user.token} table={table} onSaved={refresh} />
          ))}
        </div>
      </section>
    </div>
  )
}

function DefaultBalance({
  token,
  current,
  onSaved,
}: {
  token: string
  current?: number
  onSaved: () => void
}) {
  const [value, setValue] = useState<string>('')
  const saveMutation = useMutation({
    mutationFn: () => api.admin.putSettings(token, Number(value)),
    onSuccess: onSaved,
  })
  return (
    <form
      className="admin-row"
      onSubmit={(event) => {
        event.preventDefault()
        if (Number(value) > 0) saveMutation.mutate()
      }}
    >
      <label>
        Default bankroll (registration &amp; balance reset)
        <input
          type="number"
          min={1}
          placeholder={String(current ?? 100)}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <button type="submit" disabled={!value || saveMutation.isPending}>
        Save
      </button>
      <span className="muted">current: ${current ?? '…'}</span>
    </form>
  )
}

function CreateTable({ token, onCreated }: { token: string; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [game, setGame] = useState<TableInfo['game']>('roulette')
  const [minStake, setMinStake] = useState('1')
  const [maxStake, setMaxStake] = useState('500')

  const createMutation = useMutation({
    mutationFn: () =>
      api.admin.createTable(token, {
        name: name.trim(),
        game,
        minStake: Number(minStake),
        maxStake: Number(maxStake),
      }),
    onSuccess: () => {
      setName('')
      onCreated()
    },
  })

  const valid = name.trim().length >= 2 && Number(minStake) >= 1 && Number(maxStake) >= Number(minStake)

  return (
    <form
      className="admin-row"
      onSubmit={(event) => {
        event.preventDefault()
        if (valid) createMutation.mutate()
      }}
    >
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Table name" maxLength={40} />
      <select value={game} onChange={(event) => setGame(event.target.value as TableInfo['game'])}>
        <option value="roulette">roulette</option>
        <option value="blackjack">blackjack</option>
      </select>
      <input type="number" min={1} value={minStake} onChange={(event) => setMinStake(event.target.value)} placeholder="min" />
      <input type="number" min={1} value={maxStake} onChange={(event) => setMaxStake(event.target.value)} placeholder="max" />
      <button type="submit" disabled={!valid || createMutation.isPending}>
        Create
      </button>
      {createMutation.isError && <span className="error">{(createMutation.error as Error).message}</span>}
    </form>
  )
}

function TableRowEditor({
  token,
  table,
  onSaved,
}: {
  token: string
  table: TableInfo
  onSaved: () => void
}) {
  const [name, setName] = useState(table.name)
  const [minStake, setMinStake] = useState(String(table.minStake))
  const [maxStake, setMaxStake] = useState(String(table.maxStake))

  const patchMutation = useMutation({
    mutationFn: (patch: Parameters<typeof api.admin.updateTable>[2]) =>
      api.admin.updateTable(token, table.id, patch),
    onSuccess: onSaved,
  })

  const dirty = name !== table.name || Number(minStake) !== table.minStake || Number(maxStake) !== table.maxStake

  return (
    <div className={`admin-row table-row ${table.isOpen ? '' : 'closed'}`}>
      <span className={`dot ${table.game}`} />
      <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} />
      <span className="muted">{table.game}</span>
      <input type="number" min={1} value={minStake} onChange={(event) => setMinStake(event.target.value)} />
      <input type="number" min={1} value={maxStake} onChange={(event) => setMaxStake(event.target.value)} />
      <span className="muted">● {table.playersOnline}</span>
      <button
        type="button"
        disabled={!dirty || patchMutation.isPending}
        onClick={() => patchMutation.mutate({ name: name.trim(), minStake: Number(minStake), maxStake: Number(maxStake) })}
      >
        Save
      </button>
      <button
        type="button"
        className={table.isOpen ? 'danger' : ''}
        onClick={() => patchMutation.mutate({ isOpen: !table.isOpen })}
      >
        {table.isOpen ? 'Close' : 'Reopen'}
      </button>
    </div>
  )
}
