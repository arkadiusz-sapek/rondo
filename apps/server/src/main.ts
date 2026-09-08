import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { WsService } from './ws/ws.service'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.enableCors({ origin: true })
  const port = Number(process.env.PORT ?? 3200)
  await app.listen(port)
  // WS shares the HTTP server — one port for REST and the table socket.
  app.get(WsService).attach(app.getHttpServer())
  console.log(`rondo-server on http://localhost:${port} (ws: /ws)`)
}

bootstrap()
