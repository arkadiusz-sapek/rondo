import { parseServerEvent, type ClientCommand } from '@rondo/protocol'
import { SERVER_URL } from './api'
import { useGame } from './store/game'

const WS_URL = SERVER_URL.replace(/^http/, 'ws') + '/ws'

let socket: WebSocket | null = null
let retryMs = 1000
let intentionalClose = false

/** One socket per tab; reconnects with backoff and re-syncs via snapshot. */
export function connect(token: string, tableId: string) {
  intentionalClose = false
  useGame.getState().setConnection('connecting')
  socket = new WebSocket(
    `${WS_URL}?token=${encodeURIComponent(token)}&table=${encodeURIComponent(tableId)}`,
  )

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
    if (event.code === 4003) {
      // Dead token (e.g. the DB was reset) — force a clean sign-in.
      localStorage.removeItem('rondo-auth')
      window.location.hash = '#/'
      window.location.reload()
      return
    }
    if (intentionalClose || event.code === 4004 || event.code === 4005) return
    setTimeout(() => connect(token, tableId), retryMs)
    retryMs = Math.min(retryMs * 2, 10_000)
  }
}

/** Leave the table: close without triggering the reconnect loop. */
export function disconnect() {
  intentionalClose = true
  socket?.close()
  socket = null
}

export function sendCommand(command: ClientCommand) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(command))
}
