import type { Components } from '../../types/api'
import { MINUS, fmt2 } from '../../lib/format'
import type { EngineState } from '../../engine/score'
import { RULES } from '../../engine/catalog'

/** Формула ТЗ буквально: три слагаемых с текущими значениями и зачёркнутой базой, внизу — их сумма. */
export function FormulaRows({ state, base, c }: { state: EngineState; base: EngineState; c: Components }) {
  const { d_avg_weight, min_weight } = RULES.score
  const rows = [
    { label: `${d_avg_weight} × D_avg`, value: fmt2(state.dAvg), baseValue: fmt2(base.dAvg), term: c.d_avg_term, baseTerm: c.d_avg_term_base },
    { label: `${min_weight} × min D`, value: fmt2(state.minD), baseValue: fmt2(base.minD), term: c.min_term, baseTerm: c.min_term_base },
    { label: '− N_crit', value: String(state.nCrit), baseValue: String(base.nCrit), term: c.crit_term, baseTerm: c.crit_term_base },
  ]
  const sum = c.d_avg_term + c.min_term + c.crit_term

  return (
    <section className="num text-[12px]" aria-label="Формула Score">
      <table className="w-full border-collapse">
        <tbody>
          {rows.map((r) => {
            const changed = r.value !== r.baseValue
            return (
              <tr key={r.label} className="h-[18px]">
                <td className="text-ink-2">{r.label}</td>
                <td className="text-right">
                  {r.value}
                  {changed && <span className="ml-1.5 text-[10px] text-ink-2 line-through">{r.baseValue}</span>}
                </td>
                <td className="w-[62px] text-right" style={{ color: r.label === '− N_crit' && r.term < 0 ? 'var(--down)' : 'var(--ink)' }}>
                  {r.label === '− N_crit' ? `${MINUS}${fmt2(Math.abs(r.term))}` : `+${fmt2(r.term)}`}
                </td>
              </tr>
            )
          })}
          <tr className="h-[20px] border-t border-line">
            <td className="text-ink-2">= Score</td>
            <td />
            <td className="text-right font-medium text-ink">{fmt2(sum)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  )
}
