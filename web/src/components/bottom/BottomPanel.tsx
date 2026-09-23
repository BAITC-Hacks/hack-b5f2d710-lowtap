import { useMemo } from 'react'
import { timeline } from '../../engine/timeline'
import { useEvaluation } from '../../hooks/useEvaluation'
import { useUi } from '../../store/ui'
import { ScoreStepLine } from './ScoreStepLine'

const TABS = [{ key: 'timeline', label: '8 кварталов' }] as const

/** Нижняя полоса: Score по кварталам (из формулы лага) и матрица показателей. */
export function BottomPanel() {
  const tab = useUi((s) => s.bottomTab)
  const { decisions, status } = useEvaluation()
  const points = useMemo(() => timeline(decisions), [decisions])

  return (
    <section className="col-span-3 grid grid-cols-[264px_1fr] border-t border-line bg-panel">
      <div className="flex flex-col justify-between border-r border-line px-3 py-2">
        <div className="flex flex-col gap-1" role="tablist" aria-label="Нижняя панель">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className="caps flex h-6 items-center border-l-2 pl-2 text-left text-[10px]"
              style={{ borderColor: tab === t.key ? 'var(--accent)' : 'transparent', color: tab === t.key ? 'var(--ink)' : undefined }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="num text-[9px] leading-snug text-ink-2">
          эффект × max(0, q−L)/8 · в Q8 = формула ТЗ{status === 'preliminary' ? ' · предварительно' : ''}
        </p>
      </div>
      <div className="relative min-w-0 px-2 py-1.5">
        <ScoreStepLine points={points} />
      </div>
    </section>
  )
}
