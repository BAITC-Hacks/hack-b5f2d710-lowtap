import { useEffect, useMemo } from 'react'
import { BottomPanel } from '../components/bottom/BottomPanel'
import { Catalog } from '../components/catalog/Catalog'
import { Header } from '../components/header/Header'
import { PultMap } from '../components/map/PultMap'
import { ScoreRail } from '../components/score/ScoreRail'
import { useHotkeys } from '../lib/hotkeys'
import { useScenario } from '../store/scenario'
import { HORIZON, useUi } from '../store/ui'

/**
 * Главный экран. Один CSS-grid под 1280×720, растущий до 1440×900 и 1920×1080:
 * строки [44 header][1fr][120 bottom] × столбцы [264 catalog][1fr map][300 score].
 */
export function Pult() {
  const handlers = useMemo(
    () => ({
      escape: () => {
        const ui = useUi.getState()
        ui.setGhost(null)
        if (ui.mode.kind === 'playing' || ui.quarter < HORIZON) ui.stopPlaying()
        else ui.cancel()
      },
      undo: () => useScenario.getState().undo(),
      space: () => {
        if (useScenario.getState().decisions.length > 0) useUi.getState().togglePlay()
      },
      matrix: () => useUi.getState().toggleBottomTab(),
    }),
    [],
  )
  useHotkeys(handlers)

  // Любое изменение набора возвращает Пульт к итогу Q8: проигрывание показывает только готовый набор.
  useEffect(
    () =>
      useScenario.subscribe((s, prev) => {
        const ui = useUi.getState()
        if (s.decisions !== prev.decisions && (ui.mode.kind === 'playing' || ui.quarter < HORIZON)) ui.stopPlaying()
      }),
    [],
  )

  return (
    <div className="grid h-full min-h-[720px] min-w-[1280px] grid-cols-[264px_1fr_300px] grid-rows-[44px_1fr_120px] overflow-hidden">
      <Header />
      <Catalog />
      <main className="relative overflow-hidden bg-panel" aria-label="Карта Астаны">
        <PultMap />
      </main>
      <ScoreRail />
      <BottomPanel />
    </div>
  )
}
