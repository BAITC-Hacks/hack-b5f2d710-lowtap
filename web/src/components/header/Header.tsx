import { RotateCcw, Undo2 } from 'lucide-react'
import { useEvaluation } from '../../hooks/useEvaluation'
import { useScenario } from '../../store/scenario'
import { useUi } from '../../store/ui'
import { DecisionSockets } from './DecisionSockets'
import { Presets } from './Presets'

export function Header() {
  const { state } = useEvaluation()
  const backend = useUi((s) => s.backend)
  const canUndo = useScenario((s) => s.past.length > 0)
  const undo = useScenario((s) => s.undo)
  const reset = useScenario((s) => s.reset)
  const cancel = useUi((s) => s.cancel)
  const crit = state.nCrit

  return (
    <header className="col-span-3 flex items-center gap-4 border-b border-line bg-panel px-4">
      <div className="w-[150px] shrink-0 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink">Пульт акима</div>
      <div className="flex flex-1 justify-center">
        <DecisionSockets />
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2">
        {backend === 'offline' && (
          <span className="caps rounded-chip border border-line px-1.5 py-0.5 text-[9px]" title="Бэкенд недоступен: расчёт локальным движком, записка по шаблону">
            офлайн
          </span>
        )}
        <span
          className="num rounded-chip px-2 py-0.5 text-[11px] font-medium text-panel"
          style={{ background: crit > 0 ? 'var(--down)' : 'var(--up)', transition: 'background-color 300ms var(--ease-data)' }}
          title="Критические пары район × показатель < 40"
        >
          КРИТ {crit}
        </span>
        <Presets />
        <button
          type="button"
          onClick={undo}
          disabled={!canUndo}
          title="Отменить (Ctrl+Z)"
          aria-label="Отменить"
          className="flex h-[26px] w-[26px] items-center justify-center rounded-chip border border-line text-ink hover:border-accent disabled:text-line"
        >
          <Undo2 size={14} />
        </button>
        <button
          type="button"
          onClick={() => {
            cancel()
            reset()
          }}
          title="Сбросить набор к базе"
          className="flex h-[26px] items-center gap-1 rounded-chip border border-line px-2 text-[12px] text-ink hover:border-accent"
        >
          <RotateCcw size={13} /> Сброс
        </button>
      </div>
    </header>
  )
}
