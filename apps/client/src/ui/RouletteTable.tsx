import { GameStage } from '../pixi/GameStage'
import { Dock } from './Dock'
import { ResultBanner, ResultsStrip, TableName, Toast, TopBar } from './Hud'

export function RouletteTable() {
  return (
    <div className="table-layout">
      <GameStage />
      <TableName />
      <TopBar />
      <ResultsStrip />
      <ResultBanner />
      <Toast />
      <Dock />
    </div>
  )
}
