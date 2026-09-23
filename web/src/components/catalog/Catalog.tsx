import { MEASURE_BY_ID, MEASURES, RULES } from '../../engine/catalog'
import { DIRECTION_COLOR } from '../../lib/colors'
import { useScenario } from '../../store/scenario'

/** Левая рейка (каркас F0): пять направлений ТЗ со счётчиком лимита. Карточки мер — F1. */
export function Catalog() {
  const decisions = useScenario((s) => s.decisions)

  return (
    <aside className="overflow-y-auto border-r border-line bg-panel" aria-label="Каталог мер">
      {RULES.directions.map((dir) => {
        const used = decisions.filter((d) => MEASURE_BY_ID.get(d.measure_id)?.direction === dir.code).length
        const total = MEASURES.filter((m) => m.direction === dir.code).length
        const full = used >= RULES.max_per_direction
        return (
          <section key={dir.code} className="border-b border-line">
            <h2 className="caps flex h-5 items-center gap-2 px-3" style={{ color: full ? 'var(--down)' : undefined }}>
              <span className="h-2.5 w-[3px]" style={{ background: DIRECTION_COLOR[dir.code] }} />
              {dir.name_ru} · {used}/{RULES.max_per_direction}
              <span className="num ml-auto font-normal normal-case tracking-normal">{total} мер</span>
            </h2>
          </section>
        )
      })}
    </aside>
  )
}
