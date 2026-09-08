import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { DB } from '../db/db.module'
import type { Db } from '../db/index'
import { appSettings, users, type UserRow } from '../db/schema'

const DEFAULT_BALANCE_KEY = 'defaultBalance'

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  const candidate = scryptSync(password, salt, 64)
  return timingSafeEqual(candidate, Buffer.from(hash, 'hex'))
}

@Injectable()
export class AuthService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async register(nickname: string, password: string): Promise<UserRow> {
    const [{ count }] = await this.db.select({ count: sql<number>`count(*)::int` }).from(users)
    const [user] = await this.db
      .insert(users)
      .values({
        nickname,
        passwordHash: hashPassword(password),
        // Bootstrap: the very first account owns the casino.
        role: count === 0 ? 'admin' : 'player',
        balance: await this.defaultBalance(),
      })
      .returning()
    return user
  }

  async login(nickname: string, password: string): Promise<UserRow> {
    const user = await this.db.query.users.findFirst({ where: eq(users.nickname, nickname) })
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedException('Wrong nickname or password')
    }
    return user
  }

  async byToken(token: string | undefined): Promise<UserRow> {
    if (!token) throw new UnauthorizedException()
    const user = await this.db.query.users.findFirst({ where: eq(users.token, token) }).catch(() => undefined)
    if (!user) throw new UnauthorizedException()
    return user
  }

  async requireAdmin(token: string | undefined): Promise<UserRow> {
    const user = await this.byToken(token)
    if (user.role !== 'admin') throw new UnauthorizedException('Admins only')
    return user
  }

  async resetBalance(userId: string): Promise<number> {
    const balance = await this.defaultBalance()
    await this.db.update(users).set({ balance }).where(eq(users.id, userId))
    return balance
  }

  async defaultBalance(): Promise<number> {
    const row = await this.db.query.appSettings.findFirst({
      where: eq(appSettings.key, DEFAULT_BALANCE_KEY),
    })
    return row ? Number(row.value) : 100
  }

  async setDefaultBalance(value: number): Promise<void> {
    await this.db
      .insert(appSettings)
      .values({ key: DEFAULT_BALANCE_KEY, value: String(value) })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: String(value) } })
  }
}

export function bearer(header: string | undefined): string | undefined {
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined
}
