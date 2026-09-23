import { RULES } from '../../engine/catalog'
import { BASE_STATE, formulaComponents } from '../../engine/score'
import { useEvaluation } from '../../hooks/useEvaluation'
import { fmt2, fmtSigned } from '../../lib/format'

const CAPTION = {
  base: 'база',
  preliminary: 'предварительно',
  official: 'Astana Quality of Life Score',
} as const

/** Правая рейка (каркас F0): бюджет, число, формула ТЗ тремя строками. */
export function ScoreRail() {
  const { state, status, decisions, remaining } = useEvaluation()
  const c = formulaComponents(state)
  const official = status === 'official'
  const delta = state.score - BASE_STATE.score

  const rows = [
    { label: '0.7 × D_avg', value: state.dAvg, term: c.d_avg_term, base: c.d_avg_term_base },
    { label: '0.3 × min D', value: state.minD, term: c.min_term, base: c.min_term_base },
    { label: '− N_crit', value: state.nCrit, term: c.crit_term, base: c.crit_term_base },
  ]

  return (
    <aside className="flex flex-col gap-5 border-l border-line bg-panel px-4 py-4">
      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="caps">Бюджет · {RULES.budget} у.е.</h2>
          <span className="num text-[13px] text-gold">
            остаток <b className="font-medium">{remaining}</b>
          </span>
        </div>
        <p className="mt-0.5 text-[9px] text-ink-2">остаток не влияет на Score</p>
      </section>

      <section>
        <h2 className="caps text-[10px]">
          {CAPTION[status]}
          {status !== 'official' && ` · ${decisions.length}/${RULES.decisions_required}`}
        </h2>
        <div className="mt-1 flex items-baseline gap-3">
          <span
            className="font-display text-[clamp(44px,3.6vw,56px)] font-medium leading-none tracking-[-0.02em] tabular-nums"
            style={{
              color: official ? 'var(--ink)' : 'var(--ink-2)',
              textDecorationLine: official ? 'none' : 'underline',
              textDecorationStyle: 'dashed',
              textDecorationThickness: '1px',
              textUnderlineOffset: '6px',
            }}
          >
            {fmt2(state.score)}
          </span>
          {status !== 'base' && (
            <span className="num text-[13px]" style={{ color: delta >= 0 ? 'var(--up)' : 'var(--down)' }}>
              {fmtSigned(delta)}
            </span>
          )}
        </div>
      </section>

      <section className="num flex flex-col gap-1 text-[12px]">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-2">
            <span className="text-ink-2">{r.label}</span>
            <span className="flex-1 text-right">{r.label === '− N_crit' ? r.value : fmt2(r.value)}</span>
            <span className="w-[64px] text-right text-ink">= {fmt2(r.term)}</span>
            <span className="w-[44px] text-right text-ink-2 line-through">{fmt2(r.base)}</span>
          </div>
        ))}
      </section>
    </aside>
  )
}
