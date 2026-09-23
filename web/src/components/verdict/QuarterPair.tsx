import { BASE_STATE, type EngineState } from '../../engine/score'
import type { DistrictId } from '../../types/data'
import { MapAstana } from '../map/MapAstana'

interface Props {
  state: EngineState
  /** «Примерить» рекомендацию: правая карта показывает её пунктиром. */
  ghost?: EngineState | null
  highlight?: DistrictId | null
}

/** Два хороплета в одной шкале: Q0 (база) | Q8 (итог); подписи — только числа. */
export function QuarterPair({ state, ghost = null, highlight = null }: Props) {
  return (
    <div className="grid h-full grid-cols-2 gap-px bg-line">
      {[
        { q: 'Q0', s: BASE_STATE, caption: 'база', g: null },
        { q: 'Q8', s: state, caption: ghost ? 'примерка' : 'итог', g: ghost },
      ].map(({ q, s, caption, g }) => (
        <div key={q} className="relative bg-panel">
          <div className="absolute left-3 top-2 z-10 flex items-baseline gap-2">
            <span className="font-display text-[18px] font-medium">{q}</span>
            <span className="caps text-[10px]">{caption}</span>
          </div>
          <MapAstana state={s} ghost={g} compact labels="numbers" highlight={highlight} padding={[34, 16, 12, 16]} />
        </div>
      ))}
    </div>
  )
}
