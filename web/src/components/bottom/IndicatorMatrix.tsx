import { DISTRICTS, RULES } from '../../engine/catalog'
import { BASE_STATE, type EngineState } from '../../engine/score'
import { deltaColor } from '../../lib/colors'
import { fmt1, fmtSigned } from '../../lib/format'
import { DISTRICT_IDS, INDICATOR_CODES } from '../../types/data'

interface Props {
  state: EngineState
  /** «Что если» при наведении на меру: призрачные дельты к текущему набору. */
  ghost?: EngineState | null
}

/**
 * Все 50 чисел ТЗ: 5 районов × 10 показателей. Фон — дивергентная заливка по дельте к базе,
 * <40 — красная рамка и штриховка; при наведении на меру — пунктирные «что если» дельты.
 */
export function IndicatorMatrix({ state, ghost = null }: Props) {
  const threshold = RULES.critical_threshold
  const shown = ghost ?? state

  return (
    <div className="h-full overflow-hidden">
      <table className="num w-full table-fixed border-collapse text-[11px]">
        <colgroup>
          <col className="w-[76px]" />
          {INDICATOR_CODES.map((c) => (
            <col key={c} />
          ))}
        </colgroup>
        <thead>
          <tr className="h-[11px] text-[8px] uppercase tracking-[0.06em] text-ink-2">
            <th />
            {RULES.directions.map((dir) => (
              <th key={dir.code} colSpan={2} className="border-l border-line text-center font-sans font-semibold">
                {dir.name_ru} {dir.weight.toFixed(2).replace(/^0/, '')}
              </th>
            ))}
          </tr>
          <tr className="h-[13px] text-[9px] text-ink-2">
            <th />
            {INDICATOR_CODES.map((code, k) => (
              <th key={code} className={`font-medium ${k % 2 === 0 ? 'border-l border-line' : ''}`} title={RULES.indicators[k].name_ru}>
                {code}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DISTRICTS.map((d) => {
            const i = DISTRICT_IDS.indexOf(d.id)
            return (
              <tr key={d.id} className="h-[17px]">
                <td className="truncate pr-2 font-sans text-[11px] text-ink">{d.name_ru}</td>
                {INDICATOR_CODES.map((code, k) => {
                  const v = shown.values[i][k]
                  const delta = v - BASE_STATE.values[i][k]
                  const ghostDelta = ghost ? v - state.values[i][k] : 0
                  const crit = v < threshold
                  const alpha = Math.min(0.5, 0.15 + Math.abs(delta) / 20)
                  return (
                    <td
                      key={code}
                      className={`relative px-1 text-right ${k % 2 === 0 ? 'border-l border-line' : ''}`}
                      title={`${d.name_ru} · ${code} ${fmt1(BASE_STATE.values[i][k])} → ${fmt1(v)}`}
                      style={{
                        background: Math.abs(delta) >= 0.05 ? `color-mix(in srgb, ${deltaColor(delta)} ${alpha * 100}%, transparent)` : undefined,
                        outline: crit ? '1px solid var(--down)' : Math.abs(ghostDelta) >= 0.05 ? '1px dashed var(--accent)' : undefined,
                        outlineOffset: -1,
                        backgroundImage: crit ? 'repeating-linear-gradient(45deg, transparent 0 3px, color-mix(in srgb, var(--down) 25%, transparent) 3px 4px)' : undefined,
                      }}
                    >
                      <span style={{ color: crit ? 'var(--down)' : 'var(--ink)' }}>{fmt1(v)}</span>
                      {Math.abs(ghostDelta) >= 0.05 ? (
                        <span className="ml-0.5 text-[8px] text-accent">{fmtSigned(ghostDelta, 1)}</span>
                      ) : (
                        Math.abs(delta) >= 0.05 && <span className="ml-0.5 text-[8px]" style={{ color: delta > 0 ? 'var(--up)' : 'var(--down)' }}>{delta > 0 ? '▲' : '▼'}</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
