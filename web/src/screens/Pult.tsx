import { BottomPanel } from '../components/bottom/BottomPanel'
import { Catalog } from '../components/catalog/Catalog'
import { Header } from '../components/header/Header'
import { MapAstana } from '../components/map/MapAstana'
import { ScoreRail } from '../components/score/ScoreRail'
import { useEvaluation } from '../hooks/useEvaluation'
import { DISTRICT_IDS, type DistrictId } from '../types/data'

/**
 * Главный экран. Один CSS-grid под 1280×720, растущий до 1440×900 и 1920×1080:
 * строки [44 header][1fr][120 bottom] × столбцы [264 catalog][1fr map][300 score].
 */
export function Pult() {
  const { state } = useEvaluation()
  const dByDistrict = Object.fromEntries(DISTRICT_IDS.map((id, i) => [id, state.d[i]])) as Record<DistrictId, number>

  return (
    <div className="grid h-full min-h-[720px] min-w-[1280px] grid-cols-[264px_1fr_300px] grid-rows-[44px_1fr_120px] overflow-hidden">
      <Header />
      <Catalog />
      <main className="relative bg-panel" aria-label="Карта Астаны">
        <MapAstana values={dByDistrict} />
      </main>
      <ScoreRail />
      <BottomPanel />
    </div>
  )
}
