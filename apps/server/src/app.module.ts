import { Module } from '@nestjs/common'
import { DbModule } from './db/db.module'
import { EngineService } from './engine/engine.service'
import { PlayersController } from './players/players.controller'
import { WsService } from './ws/ws.service'

@Module({
  imports: [DbModule],
  controllers: [PlayersController],
  providers: [EngineService, WsService],
})
export class AppModule {}
