import { ArrowRight } from 'lucide-react'
import { RULES } from '../../engine/catalog'
import { BASE_STATE, formulaComponents } from '../../engine/score'
import { useEvaluation } from '../../hooks/useEvaluation'
import { useGhost } from '../../hooks/useGhost'
import { useAnalysis } from '../../store/analysis'
import { BudgetTicks } from './BudgetTicks'
import { DistrictRows } from './DistrictRows'
import { FormulaRows } from './FormulaRows'
import { Percentile } from './Percentile'
import { ScoreHero } from './ScoreHero'
import { ValidationStrip } from './ValidationStrip'

/** Правая рейка Пульта: бюджет → Score → формула → районы → валидатор → действия. */
export function ScoreRail() {
  const { state, status, decisions, cost, remaining, checks, violations } = useEvaluation()
  const run = useAnalysis((s) => s.run)
  const ghost = useGhost()
  const official = status === 'official'
  const over = cost - RULES.budget
  const invalidFull = decisions.length >= RULES.decisions_required && !official
  const reason = violations.find((v) => v.code !== 'NOT_FIVE')?.message ?? violations[0]?.message

  return (
    <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-l border-line bg-panel px-4 py-3" aria-label="Score">
      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="caps text-[10px]">
            Бюджет · <span className="num text-[11px] text-ink">{cost}</span>/{RULES.budget} у.е.
          </h2>
          <span className="num text-[12px]" style={{ color: over > 0 ? 'var(--down)' : 'var(--gold)' }}>
            {over > 0 ? (
              <>
                +{over} → {cost}/{RULES.budget}
              </>
            ) : (
              <>
                остаток <b className="font-medium">{remaining}</b>
              </>
            )}
          </span>
        </div>
        <div className="mt-1.5">
          <BudgetTicks decisions={decisions} cost={cost} />
        </div>
        <p className="mt-1 text-[9px] text-ink-2">остаток не влияет на Score</p>
      </section>

      <ScoreHero score={state.score} delta={state.score - BASE_STATE.score} status={status} count={decisions.length} invalidFull={invalidFull}
        ghost={ghost ? { score: ghost.state.score, label: ghost.label } : null}
      />
      {official && <Percentile score={state.score} />}

      <FormulaRows state={state} base={BASE_STATE} c={formulaComponents(state)} />
      <DistrictRows state={state} base={BASE_STATE} />
      <ValidationStrip checks={checks} violations={violations} />

      <div className="mt-auto flex gap-2 pt-1">
        <button
          type="button"
          disabled={!official}
          onClick={() => void run('calc', decisions)}
          title={official ? 'Локальный движок + записка по шаблону' : reason}
          className="h-9 flex-1 rounded-chip border border-accent text-[13px] font-medium text-accent disabled:cursor-not-allowed disabled:border-line disabled:text-ink-2"
        >
          Рассчитать
        </button>
        <button
          type="button"
          disabled={!official}
          onClick={() => void run('ai', decisions)}
          title={official ? 'AI-анализ сценария' : reason}
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-chip bg-accent text-[13px] font-medium text-panel disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-2"
        >
          AI-анализ <ArrowRight size={14} />
        </button>
      </div>
    </aside>
  )
}
