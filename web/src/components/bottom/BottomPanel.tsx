import { Pause, Play } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { timeline } from '../../engine/timeline'
import { useDisplayState } from '../../hooks/useDisplayState'
import { useEvaluation } from '../../hooks/useEvaluation'
import { useGhost } from '../../hooks/useGhost'
import { HORIZON, useUi } from '../../store/ui'
import { IndicatorMatrix } from './IndicatorMatrix'
import { Timeline } from './Timeline'

const TABS = [
  { key: 'timeline', label: '8 кварталов' },
  { key: 'matrix', label: 'Матрица 5×10' },
] as const

const QUARTER_MS = 500

/** Шаг проигрывания: 500 мс на квартал, на Q8 — стоп. */
function usePlayback() {
  const playing = useUi((s) => s.mode.kind === 'playing')
  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => {
      const { quarter, setQuarter } = useUi.getState()
      if (quarter >= HORIZON) useUi.setState({ mode: { kind: 'idle' } })
      else setQuarter(quarter + 1)
    }, QUARTER_MS)
    return () => clearInterval(timer)
  }, [playing])
}

/** Нижняя полоса Пульта: проигрывание 8 кварталов и матрица 5×10. */
export function BottomPanel() {
  const tab = useUi((s) => s.bottomTab)
  const toggleTab = useUi((s) => s.toggleBottomTab)
  const togglePlay = useUi((s) => s.togglePlay)
  const playing = useUi((s) => s.mode.kind === 'playing')
  const { decisions, status } = useEvaluation()
  const { display, quarter, intermediate } = useDisplayState()
  const ghost = useGhost()
  const points = useMemo(() => timeline(decisions), [decisions])
  usePlayback()

  return (
    <section className="col-span-3 grid min-h-0 grid-cols-[264px_1fr] border-t border-line bg-panel">
      <div className="flex min-h-0 flex-col justify-between border-r border-line px-3 py-2">
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-0.5" role="tablist" aria-label="Нижняя панель">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => tab !== t.key && toggleTab()}
                className="caps flex h-6 items-center border-l-2 pl-2 text-left text-[10px]"
                style={{ borderColor: tab === t.key ? 'var(--accent)' : 'transparent', color: tab === t.key ? 'var(--ink)' : undefined }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="font-display text-[20px] font-medium leading-none" style={{ color: intermediate ? 'var(--accent)' : 'var(--ink)' }}>
              Q{quarter}
            </span>
            <button
              type="button"
              onClick={togglePlay}
              disabled={decisions.length === 0}
              aria-label={playing ? 'Пауза (Space)' : 'Прожить 8 кварталов (Space)'}
              title={playing ? 'Пауза (Space)' : 'Прожить 8 кварталов (Space)'}
              className="flex h-8 w-8 items-center justify-center rounded-chip bg-accent text-panel disabled:bg-line"
            >
              {playing ? <Pause size={15} /> : <Play size={15} />}
            </button>
          </div>
        </div>
        <p className="num text-[9px] leading-snug text-ink-2">
          эффект × max(0, q−L)/8 · в Q8 = формула ТЗ{status === 'preliminary' ? ' · предварительно' : ''}
          <br />
          Space play · Esc отмена · Ctrl+Z undo · M матрица
        </p>
      </div>
      <div className="relative min-h-0 min-w-0 px-2 py-1.5">
        {tab === 'timeline' ? <Timeline points={points} decisions={decisions} /> : <IndicatorMatrix state={display} ghost={intermediate ? null : (ghost?.state ?? null)} />}
      </div>
    </section>
  )
}
