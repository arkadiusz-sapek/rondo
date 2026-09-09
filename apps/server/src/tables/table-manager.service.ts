import { Inject, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { DB } from '../db/db.module'
import type { Db } from '../db/index'
import { tables, type TableRow } from '../db/schema'
import { BlackjackEngine } from '../engine/blackjackEngine'
import { RouletteEngine } from '../engine/rouletteEngine'
import { SkatEngine } from '../engine/skatEngine'
import { WsService } from '../ws/ws.service'

type Engine = RouletteEngine | BlackjackEngine | SkatEngine

/** Boots one live engine per open room and keeps them in sync with admin edits. */
@Injectable()
export class TableManager implements OnModuleInit, OnModuleDestroy {
  private engines = new Map<string, Engine>()

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ws: WsService,
  ) {
    this.ws.setEngineResolver((tableId) => this.engines.get(tableId))
  }

  async onModuleInit() {
    let rows = await this.db.select().from(tables)
    if (rows.length === 0) {
      rows = await this.db
        .insert(tables)
        .values([
          { name: 'Rondo Royale', game: 'roulette', minStake: 1, maxStake: 500 },
          { name: 'Vegas 21', game: 'blackjack', minStake: 5, maxStake: 300 },
        ])
        .returning()
    }
    // The skat room is part of the fixed lineup — seed it once, never wipe anything.
    if (!rows.some((row) => row.game === 'skat')) {
      const [skatRow] = await this.db
        .insert(tables)
        .values([{ name: 'Skat Stammtisch', game: 'skat', minStake: 1, maxStake: 1 }])
        .returning()
      rows.push(skatRow)
    }
    for (const row of rows) {
      if (row.isOpen) this.boot(row)
    }
  }

  onModuleDestroy() {
    for (const engine of this.engines.values()) engine.stop()
  }

  private boot(row: TableRow) {
    const transport = this.ws.transportFor(row.id)
    const engine: Engine =
      row.game === 'roulette'
        ? new RouletteEngine(this.db, row, transport)
        : row.game === 'blackjack'
          ? new BlackjackEngine(this.db, row, transport)
          : new SkatEngine(this.db, row, transport)
    this.engines.set(row.id, engine)
    void engine.start()
  }

  engine(tableId: string): Engine | undefined {
    return this.engines.get(tableId)
  }

  async list() {
    const rows = await this.db.select().from(tables).orderBy(tables.createdAt)
    return rows.map((row) => ({
      ...row,
      playersOnline: this.ws.playersAt(row.id).length,
    }))
  }

  async create(input: { name: string; game: 'roulette' | 'blackjack' | 'skat'; minStake: number; maxStake: number }) {
    const [row] = await this.db.insert(tables).values(input).returning()
    this.boot(row)
    return row
  }

  async update(
    tableId: string,
    patch: Partial<Pick<TableRow, 'name' | 'minStake' | 'maxStake' | 'isOpen'>>,
  ) {
    const [row] = await this.db.update(tables).set(patch).where(eq(tables.id, tableId)).returning()
    if (!row) throw new NotFoundException()

    const engine = this.engines.get(tableId)
    if (engine) {
      engine.table = row
      if (!row.isOpen) {
        engine.stop()
        this.engines.delete(tableId)
        this.ws.kickTable(tableId, 'Table closed by the admin')
      }
    } else if (row.isOpen) {
      this.boot(row)
    }
    return row
  }
}
