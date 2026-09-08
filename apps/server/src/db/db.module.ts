import { Global, Module } from '@nestjs/common'
import { createDb } from './index'

export const DB = 'DB'

@Global()
@Module({
  providers: [{ provide: DB, useFactory: createDb }],
  exports: [DB],
})
export class DbModule {}
