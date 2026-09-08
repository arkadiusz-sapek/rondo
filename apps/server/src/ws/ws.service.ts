import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import type { Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import { parseClientCommand, type ChatMessage, type ServerEvent } from '@rondo/protocol'
import { DB } from '../db/db.module'
import type { Db } from '../db/index'
import { users } from '../db/schema'
import type { BlackjackEngine } from '../engine/blackjackEngine'
import type { RouletteEngine } from '../engine/rouletteEngine'
import type { Transport } from '../engine/transport'

type Engine = RouletteEngine | BlackjackEngine

interface Session {
  socket: WebSocket
  playerId: string
  nickname: string
  tableId: string
  lastChatAt: number
}

const CHAT_HISTORY_SIZE = 50
const CHAT_MIN_INTERVAL_MS = 1000

/**
 * Table-scoped transport hub: sockets authenticate with a bearer token and
 * name their table; every frame is `{ type, payload }`, zod-parsed and routed
 * to that table's engine with one switch.
 */
@Injectable()
export class WsService {
  private sessions = new Set<Session>()
  private chat = new Map<string, ChatMessage[]>()
  private resolveEngine: (tableId: string) => Engine | undefined = () => undefined

  constructor(@Inject(DB) private readonly db: Db) {}

  setEngineResolver(resolver: (tableId: string) => Engine | undefined) {
    this.resolveEngine = resolver
  }

  transportFor(tableId: string): Transport {
    return {
      broadcast: (event) => this.broadcastTable(tableId, event),
      sendTo: (playerId, event) => this.sendToUser(tableId, playerId, event),
    }
  }

  attach(httpServer: Server) {
    const wss = new WebSocketServer({ server: httpServer, path: '/ws' })
    wss.on('connection', (socket, request) => {
      const url = new URL(request.url ?? '', 'http://localhost')
      const token = url.searchParams.get('token')
      const tableId = url.searchParams.get('table')
      if (!token || !tableId) return socket.close(4001, 'missing token or table')
      void this.handleConnection(socket, token, tableId)
    })
  }

  private async handleConnection(socket: WebSocket, token: string, tableId: string) {
    const user = await this.db.query.users.findFirst({ where: eq(users.token, token) }).catch(() => undefined)
    if (!user) return socket.close(4003, 'unknown token')
    const engine = this.resolveEngine(tableId)
    if (!engine) return socket.close(4004, 'unknown table')

    const session: Session = {
      socket,
      playerId: user.id,
      nickname: user.nickname,
      tableId,
      lastChatAt: 0,
    }
    const isFirstSocketOfPlayer = !this.playersAt(tableId).some((p) => p.id === user.id)
    this.sessions.add(session)

    const you = { id: user.id, nickname: user.nickname, balance: user.balance }
    const shared = {
      you,
      players: this.playersAt(tableId),
      chatHistory: this.chat.get(tableId) ?? [],
      table: {
        id: engine.table.id,
        name: engine.table.name,
        game: engine.table.game,
        minStake: engine.table.minStake,
        maxStake: engine.table.maxStake,
      },
    }
    if (engine.game === 'roulette') {
      send(socket, { type: 'table_snapshot', payload: { ...engine.snapshotFor(you), ...shared } })
    } else {
      send(socket, { type: 'bj_snapshot', payload: { ...engine.snapshot(), ...shared } })
    }
    if (isFirstSocketOfPlayer) {
      this.broadcastTable(
        tableId,
        { type: 'player_joined', payload: { player: { id: user.id, nickname: user.nickname } } },
        session,
      )
    }

    socket.on('message', (raw) => void this.handleMessage(session, raw.toString()))
    socket.on('close', () => void this.handleClose(session))
  }

  private async handleMessage(session: Session, raw: string) {
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      return send(session.socket, { type: 'error', payload: { message: 'invalid JSON' } })
    }
    const command = parseClientCommand(json)
    if (!command) {
      return send(session.socket, { type: 'error', payload: { message: 'unknown command' } })
    }
    const engine = this.resolveEngine(session.tableId)
    if (!engine) return send(session.socket, { type: 'error', payload: { message: 'table closed' } })

    switch (command.type) {
      case 'chat_send':
        return this.handleChat(session, command.payload.text)
      case 'place_bet':
        if (engine.game !== 'roulette') break
        return engine.placeBet(session.playerId, command.payload.spot, command.payload.amount)
      case 'undo_bet':
        if (engine.game !== 'roulette') break
        return engine.undoBet(session.playerId)
      case 'clear_bets':
        if (engine.game !== 'roulette') break
        return engine.clearBets(session.playerId)
      case 'bj_bet':
        if (engine.game !== 'blackjack') break
        return engine.placeBet(session.playerId, session.nickname, command.payload.amount)
      case 'bj_clear':
        if (engine.game !== 'blackjack') break
        return engine.clearBet(session.playerId)
      case 'bj_hit':
        if (engine.game !== 'blackjack') break
        return engine.hit(session.playerId)
      case 'bj_stand':
        if (engine.game !== 'blackjack') break
        return engine.stand(session.playerId)
      case 'bj_double':
        if (engine.game !== 'blackjack') break
        return engine.double(session.playerId)
    }
    send(session.socket, { type: 'error', payload: { message: 'wrong game for that command' } })
  }

  private handleChat(session: Session, text: string) {
    const now = Date.now()
    if (now - session.lastChatAt < CHAT_MIN_INTERVAL_MS) {
      return send(session.socket, { type: 'error', payload: { message: 'Slow down a little' } })
    }
    session.lastChatAt = now
    const message: ChatMessage = {
      playerId: session.playerId,
      nickname: session.nickname,
      text: text.trim(),
      at: new Date(now).toISOString(),
    }
    const history = [...(this.chat.get(session.tableId) ?? []), message].slice(-CHAT_HISTORY_SIZE)
    this.chat.set(session.tableId, history)
    this.broadcastTable(session.tableId, { type: 'chat_message', payload: message })
  }

  private async handleClose(session: Session) {
    this.sessions.delete(session)
    const stillConnected = [...this.sessions].some(
      (candidate) => candidate.playerId === session.playerId && candidate.tableId === session.tableId,
    )
    if (!stillConnected) {
      await this.resolveEngine(session.tableId)?.dropPlayer(session.playerId)
      this.broadcastTable(session.tableId, { type: 'player_left', payload: { playerId: session.playerId } })
    }
  }

  playersAt(tableId: string) {
    const seen = new Map<string, string>()
    for (const session of this.sessions) {
      if (session.tableId === tableId) seen.set(session.playerId, session.nickname)
    }
    return [...seen.entries()].map(([id, nickname]) => ({ id, nickname }))
  }

  kickTable(tableId: string, reason: string) {
    for (const session of this.sessions) {
      if (session.tableId === tableId) {
        send(session.socket, { type: 'error', payload: { message: reason } })
        session.socket.close(4005, reason)
      }
    }
  }

  private broadcastTable(tableId: string, event: ServerEvent, except?: Session) {
    for (const session of this.sessions) {
      if (session.tableId === tableId && session !== except) send(session.socket, event)
    }
  }

  private sendToUser(tableId: string, playerId: string, event: ServerEvent) {
    for (const session of this.sessions) {
      if (session.tableId === tableId && session.playerId === playerId) send(session.socket, event)
    }
  }
}

function send(socket: WebSocket, event: ServerEvent) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event))
}
