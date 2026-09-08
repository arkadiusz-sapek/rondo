import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://rondo:rondo@localhost:5434/rondo'

export function createDb() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  return drizzle(pool, { schema })
}

export type Db = ReturnType<typeof createDb>
