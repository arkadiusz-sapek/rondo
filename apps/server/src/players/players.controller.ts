import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common'
import { desc, eq } from 'drizzle-orm'
import { Inject } from '@nestjs/common'
import { z } from 'zod'
import { DB } from '../db/db.module'
import type { Db } from '../db/index'
import { bets, players, rounds } from '../db/schema'
import { WsService } from '../ws/ws.service'

const JOIN_BALANCE = 100

const joinSchema = z.object({ nickname: z.string().trim().min(2).max(24) })

@Controller()
export class PlayersController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ws: WsService,
  ) {}

  /** Guest join: every new player sits down with the same fun-money bankroll. */
  @Post('players')
  async join(@Body() body: unknown) {
    const parsed = joinSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException('nickname must be 2-24 characters')
    const [player] = await this.db
      .insert(players)
      .values({ nickname: parsed.data.nickname, balance: JOIN_BALANCE })
      .returning()
    return { id: player.id, token: player.token, nickname: player.nickname, balance: player.balance }
  }

  @Get('players/:token/history')
  async history(@Param('token') token: string) {
    const player = await this.db.query.players.findFirst({ where: eq(players.token, token) })
    if (!player) throw new NotFoundException()
    const roundsWithBets = await this.db
      .select({ bet: bets, round: rounds })
      .from(bets)
      .innerJoin(rounds, eq(bets.roundId, rounds.id))
      .where(eq(bets.playerId, player.id))
      .orderBy(desc(rounds.settledAt))
      .limit(200)
    return roundsWithBets.map(({ bet, round }) => ({
      roundId: round.id,
      number: round.number,
      settledAt: round.settledAt,
      spot: bet.spot,
      amount: bet.amount,
      returned: bet.returned,
    }))
  }

  @Get('table/players')
  tablePlayers() {
    return this.ws.playersAtTable()
  }
}
