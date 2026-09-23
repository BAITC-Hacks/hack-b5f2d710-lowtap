import { X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo } from 'react'
import { canonicalScenario } from '../../engine/hash'
import { engineNumbers } from '../../lib/verify'
import { useAnalysis } from '../../store/analysis'
import { useScenario } from '../../store/scenario'
import { AgentTrace } from './AgentTrace'
import { MemoDocument } from './MemoDocument'
import { VerifiedBadge } from './VerifiedBadge'

const SOURCE_LABEL = { template: 'шаблон', rules: 'rules', llm: 'llm', cache: 'cache' } as const

/** Панель результата «Рассчитать» / «AI-анализ» поверх карты. */
export function MemoPanel() {
  const { open, mode, report, result, source, key, close, run } = useAnalysis()
  const decisions = useScenario((s) => s.decisions)
  const load = useScenario((s) => s.load)
  const stale = key !== null && key !== canonicalScenario(decisions)
  const numbers = useMemo(() => (result && report ? engineNumbers(result, report.recommendations) : []), [result, report])

  return (
    <AnimatePresence>
      {open && report && result && (
        <motion.div
          key="memo"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
          className="absolute inset-0 z-30 flex flex-col bg-bg"
          role="dialog"
          aria-label="Записка акиму"
        >
          <div className="flex h-10 shrink-0 items-center gap-3 border-b border-line bg-panel px-4">
            <h2 className="caps text-[11px] text-ink">{mode === 'ai' ? 'AI-анализ' : 'Расчёт'}</h2>
            <span className="num rounded-chip border border-line px-1.5 text-[10px] text-ink-2" title="Источник записки">
              {SOURCE_LABEL[source]}
            </span>
            <VerifiedBadge verified={report.verified_numbers} />
            {stale && (
              <button type="button" onClick={() => run(mode, decisions)} className="text-[12px] text-accent underline underline-offset-2">
                набор изменён — пересчитать
              </button>
            )}
            <button type="button" onClick={close} aria-label="Закрыть записку" className="ml-auto text-ink-2 hover:text-ink">
              <X size={16} />
            </button>
          </div>
          <AgentTrace steps={report.trace} />
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="mx-auto max-w-[640px]">
              <MemoDocument
                report={report}
                numbers={numbers}
                scenarioId={result.scenario_id}
                onApply={(rec) => {
                  load(rec.decisions)
                  close()
                }}
              />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
