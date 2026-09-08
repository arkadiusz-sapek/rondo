import { BadRequestException, Body, Controller, Get, Headers, Param, Patch, Post, Put } from '@nestjs/common'
import { z } from 'zod'
import { AuthService, bearer } from '../auth/auth.service'
import { TableManager } from './table-manager.service'

const createSchema = z
  .object({
    name: z.string().trim().min(2).max(40),
    game: z.enum(['roulette', 'blackjack']),
    minStake: z.number().int().min(1),
    maxStake: z.number().int().min(1),
  })
  .refine((table) => table.maxStake >= table.minStake, 'maxStake must be >= minStake')

const patchSchema = z
  .object({
    name: z.string().trim().min(2).max(40).optional(),
    minStake: z.number().int().min(1).optional(),
    maxStake: z.number().int().min(1).optional(),
    isOpen: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'empty patch')

@Controller()
export class TablesController {
  constructor(
    private readonly manager: TableManager,
    private readonly auth: AuthService,
  ) {}

  @Get('tables')
  list() {
    return this.manager.list()
  }

  @Post('admin/tables')
  async create(@Body() body: unknown, @Headers('authorization') authorization?: string) {
    await this.auth.requireAdmin(bearer(authorization))
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? 'invalid table')
    return this.manager.create(parsed.data)
  }

  @Patch('admin/tables/:id')
  async update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
  ) {
    await this.auth.requireAdmin(bearer(authorization))
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException('invalid patch')
    return this.manager.update(id, parsed.data)
  }

  @Get('admin/settings')
  async settings(@Headers('authorization') authorization?: string) {
    await this.auth.requireAdmin(bearer(authorization))
    return { defaultBalance: await this.auth.defaultBalance() }
  }

  @Put('admin/settings')
  async putSettings(@Body() body: unknown, @Headers('authorization') authorization?: string) {
    await this.auth.requireAdmin(bearer(authorization))
    const parsed = z.object({ defaultBalance: z.number().int().min(1).max(1_000_000) }).safeParse(body)
    if (!parsed.success) throw new BadRequestException('defaultBalance must be a positive int')
    await this.auth.setDefaultBalance(parsed.data.defaultBalance)
    return { defaultBalance: parsed.data.defaultBalance }
  }
}
