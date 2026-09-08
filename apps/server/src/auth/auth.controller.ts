import { BadRequestException, Body, Controller, Get, Headers, Inject, Post } from '@nestjs/common'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { DB } from '../db/db.module'
import type { Db } from '../db/index'
import { bets, bjHands, rounds } from '../db/schema'
import { AuthService, bearer } from './auth.service'

const credentialsSchema = z.object({
  nickname: z.string().trim().min(2).max(24),
  password: z.string().min(4).max(100),
})

function publicUser(user: { id: string; token: string; nickname: string; role: string; balance: number }) {
  return {
    id: user.id,
    token: user.token,
    nickname: user.nickname,
    role: user.role,
    balance: user.balance,
  }
}

@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(DB) private readonly db: Db,
  ) {}

  @Post('auth/register')
  async register(@Body() body: unknown) {
    const parsed = credentialsSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException('nickname 2-24 chars, password 4+ chars')
    try {
      const user = await this.auth.register(parsed.data.nickname, parsed.data.password)
      return publicUser(user)
    } catch {
      throw new BadRequestException('Nickname already taken')
    }
  }

  @Post('auth/login')
  async login(@Body() body: unknown) {
    const parsed = credentialsSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException('nickname and password required')
    return publicUser(await this.auth.login(parsed.data.nickname, parsed.data.password))
  }

  @Get('me')
  async me(@Headers('authorization') authorization?: string) {
    return publicUser(await this.auth.byToken(bearer(authorization)))
  }

  @Post('me/reset-balance')
  async resetBalance(@Headers('authorization') authorization?: string) {
    const user = await this.auth.byToken(bearer(authorization))
    const balance = await this.auth.resetBalance(user.id)
    return { balance }
  }

  /** Cross-game bet history, freshest first. */
  @Get('me/history')
  async history(@Headers('authorization') authorization?: string) {
    const user = await this.auth.byToken(bearer(authorization))
    const roulette = await this.db
      .select({ bet: bets, round: rounds })
      .from(bets)
      .innerJoin(rounds, eq(bets.roundId, rounds.id))
      .where(eq(bets.playerId, user.id))
      .orderBy(desc(rounds.settledAt))
      .limit(100)
    const blackjack = await this.db
      .select()
      .from(bjHands)
      .where(eq(bjHands.playerId, user.id))
      .orderBy(desc(bjHands.settledAt))
      .limit(100)
    return {
      roulette: roulette.map(({ bet, round }) => ({
        roundId: round.id,
        number: round.number,
        settledAt: round.settledAt,
        spot: bet.spot,
        amount: bet.amount,
        returned: bet.returned,
      })),
      blackjack: blackjack.map((hand) => ({
        id: hand.id,
        bet: hand.bet,
        outcome: hand.outcome,
        returned: hand.returned,
        settledAt: hand.settledAt,
      })),
    }
  }
}
