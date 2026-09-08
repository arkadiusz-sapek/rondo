import { parseServerEvent, type ClientCommand } from '@rondo/protocol'
import { useGame } from './store/game'

export const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3200'
const WS_URL = SERVER_URL.replace(/^http/, 'ws') + '/ws'

let socket: WebSocket | null = null
let retryMs = 1000

/** One socket per tab; reconnects with backoff and re-syncs via table_snapshot. */
export function connect(token: string) {
  useGame.getState().setConnection('connecting')
  socket = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`)

  socket.onopen = () => {
    retryMs = 1000
    useGame.getState().setConnection('open')
  }
  socket.onmessage = (message) => {
    let json: unknown
    try {
      json = JSON.parse(String(message.data))
    } catch {
      return
    }
    const event = parseServerEvent(json)
    if (event) useGame.getState().apply(event)
  }
  socket.onclose = (event) => {
    useGame.getState().setConnection('closed')
    if (event.code === 4003) return // stale token — Join screen takes over
    setTimeout(() => connect(token), retryMs)
    retryMs = Math.min(retryMs * 2, 10_000)
  }
}

export function sendCommand(command: ClientCommand) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(command))
}
