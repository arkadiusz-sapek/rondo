import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import type { Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import { parseClientCommand, type ServerEvent } from '@rondo/protocol'
import { DB } from '../db/db.module'
import type { Db } from '../db/index'
import { players } from '../db/schema'
import { EngineService } from '../engine/engine.service'

interface Session {
  socket: WebSocket
  playerId: string
  nickname: string
}

/**
 * Plain-`ws` transport on top of Nest's HTTP server. Every frame in both
 * directions is `{ type, payload }`; incoming frames are zod-parsed and
 * dispatched with one switch — malformed input never reaches the engine.
 */
@Injectable()
export class WsService {
  private sessions = new Set<Session>()

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly engine: EngineService,
  ) {
    this.engine.setTransport({
      broadcast: (event) => this.broadcast(event),
      sendTo: (playerId, event) => this.sendTo(playerId, event),
    })
  }

  attach(httpServer: Server) {
    const wss = new WebSocketServer({ server: httpServer, path: '/ws' })
    wss.on('connection', (socket, request) => {
      const token = new URL(request.url ?? '', 'http://localhost').searchParams.get('token')
      if (!token) return socket.close(4001, 'missing token')
      void this.handleConnection(socket, token)
    })
  }

  private async handleConnection(socket: WebSocket, token: string) {
    const player = await this.db.query.players
      .findFirst({ where: eq(players.token, token) })
      .catch(() => undefined)
    if (!player) return socket.close(4003, 'unknown token')

    const session: Session = { socket, playerId: player.id, nickname: player.nickname }
    const isFirstSocketOfPlayer = ![...this.sessions].some((s) => s.playerId === player.id)
    this.sessions.add(session)

    send(socket, {
      type: 'table_snapshot',
      payload: {
        ...this.engine.snapshotFor({
          id: player.id,
          nickname: player.nickname,
          balance: player.balance,
        }),
        players: this.playersAtTable(),
      },
    })
    if (isFirstSocketOfPlayer) {
      this.broadcast(
        { type: 'player_joined', payload: { player: { id: player.id, nickname: player.nickname } } },
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

    switch (command.type) {
      case 'place_bet':
        return this.engine.placeBet(session.playerId, command.payload.spot, command.payload.amount)
      case 'undo_bet':
        return this.engine.undoBet(session.playerId)
      case 'clear_bets':
        return this.engine.clearBets(session.playerId)
    }
  }

  private async handleClose(session: Session) {
    this.sessions.delete(session)
    const stillConnected = [...this.sessions].some((s) => s.playerId === session.playerId)
    if (!stillConnected) {
      await this.engine.dropPlayer(session.playerId)
      this.broadcast({ type: 'player_left', payload: { playerId: session.playerId } })
    }
  }

  playersAtTable() {
    const seen = new Map<string, string>()
    for (const session of this.sessions) seen.set(session.playerId, session.nickname)
    return [...seen.entries()].map(([id, nickname]) => ({ id, nickname }))
  }

  private broadcast(event: ServerEvent, except?: Session) {
    for (const session of this.sessions) {
      if (session !== except) send(session.socket, event)
    }
  }

  private sendTo(playerId: string, event: ServerEvent) {
    for (const session of this.sessions) {
      if (session.playerId === playerId) send(session.socket, event)
    }
  }
}

function send(socket: WebSocket, event: ServerEvent) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event))
}
