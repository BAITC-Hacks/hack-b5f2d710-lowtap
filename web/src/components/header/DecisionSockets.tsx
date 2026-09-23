import { X } from 'lucide-react'
import { MEASURE_BY_ID, RULES, districtName } from '../../engine/catalog'
import { DIRECTION_COLOR } from '../../lib/colors'
import { useScenario } from '../../store/scenario'

/** Пять гнёзд решений: «5 решений = 5 часов смены». */
export function DecisionSockets() {
  const decisions = useScenario((s) => s.decisions)
  const remove = useScenario((s) => s.remove)
  const slots = Array.from({ length: Math.max(RULES.decisions_required, decisions.length) }, (_, i) => decisions[i])

  return (
    <ol className="flex items-center gap-1.5" aria-label="Решения акима">
      {slots.map((dec, i) => {
        const hour = `${i + 1}/${RULES.decisions_required}`
        if (!dec) {
          return (
            <li
              key={`empty-${i}`}
              className="num flex h-[26px] w-[108px] items-center justify-center rounded-chip border border-dashed border-line text-[11px] text-ink-2"
            >
              — час {hour} —
            </li>
          )
        }
        const measure = MEASURE_BY_ID.get(dec.measure_id)
        return (
          <li
            key={dec.measure_id}
            title={measure?.name_ru}
            className="group relative flex h-[26px] w-[108px] items-center overflow-hidden rounded-chip border border-line bg-panel"
          >
            <span className="h-full w-[3px] shrink-0" style={{ background: measure ? DIRECTION_COLOR[measure.direction] : 'var(--down)' }} />
            <span className="num truncate px-2 text-[11px] text-ink">
              {dec.measure_id} · {districtName(dec.district)}
            </span>
            <button
              type="button"
              onClick={() => remove(dec.measure_id)}
              aria-label={`Снять ${dec.measure_id}`}
              className="absolute right-0 top-0 hidden h-full w-6 items-center justify-center bg-panel text-ink-2 hover:text-down group-hover:flex"
            >
              <X size={14} />
            </button>
          </li>
        )
      })}
    </ol>
  )
}
