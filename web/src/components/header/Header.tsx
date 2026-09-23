import { useEvaluation } from '../../hooks/useEvaluation'
import { useUi } from '../../store/ui'
import { DecisionSockets } from './DecisionSockets'

export function Header() {
  const { state } = useEvaluation()
  const backend = useUi((s) => s.backend)
  const crit = state.nCrit

  return (
    <header className="col-span-3 flex items-center gap-6 border-b border-line bg-panel px-4">
      <div className="w-[150px] shrink-0 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink">Пульт акима</div>
      <div className="flex flex-1 justify-center">
        <DecisionSockets />
      </div>
      <div className="flex w-[280px] shrink-0 items-center justify-end gap-3">
        {backend === 'offline' && (
          <span className="caps rounded-chip border border-line px-1.5 py-0.5 text-[10px]" title="Бэкенд недоступен: расчёт локальным движком">
            офлайн
          </span>
        )}
        <span
          className="num rounded-chip px-2 py-0.5 text-[11px] font-medium text-panel"
          style={{ background: crit > 0 ? 'var(--down)' : 'var(--up)' }}
        >
          КРИТ {crit}
        </span>
      </div>
    </header>
  )
}
