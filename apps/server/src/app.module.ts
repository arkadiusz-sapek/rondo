import { Module } from '@nestjs/common'
import { AuthController } from './auth/auth.controller'
import { AuthService } from './auth/auth.service'
import { DbModule } from './db/db.module'
import { TableManager } from './tables/table-manager.service'
import { TablesController } from './tables/tables.controller'
import { WsService } from './ws/ws.service'

@Module({
  imports: [DbModule],
  controllers: [AuthController, TablesController],
  providers: [AuthService, TableManager, WsService],
})
export class AppModule {}
