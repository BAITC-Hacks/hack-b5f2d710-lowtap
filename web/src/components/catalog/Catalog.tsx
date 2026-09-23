import { MEASURE_BY_ID, MEASURES, RULES, districtName } from '../../engine/catalog'
import { blockReason, districtConflict } from '../../engine/validate'
import { DIRECTION_COLOR } from '../../lib/colors'
import { useScenario } from '../../store/scenario'
import { useUi } from '../../store/ui'
import { MeasureCard, type CardState } from './MeasureCard'

/** Левая рейка: 14 мер по пяти направлениям ТЗ, лимит «≤2 на направление» в заголовке секции. */
export function Catalog() {
  const decisions = useScenario((s) => s.decisions)
  const place = useScenario((s) => s.place)
  const remove = useScenario((s) => s.remove)
  const mode = useUi((s) => s.mode)
  const selected = useUi((s) => s.selectedDistrict)
  const startPlacing = useUi((s) => s.startPlacing)
  const cancel = useUi((s) => s.cancel)
  const setGhost = useUi((s) => s.setGhost)

  function activate(measureId: string, state: CardState) {
    const measure = MEASURE_BY_ID.get(measureId)!
    if (state === 'blocked') return
    if (state === 'placing') return cancel()
    if (measure.type === 'city') {
      if (state !== 'placed') place(measureId, null)
      return
    }
    const others = decisions.filter((d) => d.measure_id !== measureId)
    if (state !== 'placed' && selected && !districtConflict(others, measureId, selected)) {
      place(measureId, selected)
      return
    }
    startPlacing(measureId)
  }

  return (
    <aside className="overflow-y-auto border-r border-line bg-panel" aria-label="Каталог мер">
      {RULES.directions.map((dir) => {
        const used = decisions.filter((d) => MEASURE_BY_ID.get(d.measure_id)?.direction === dir.code).length
        const full = used >= RULES.max_per_direction
        return (
          <section key={dir.code} aria-label={dir.name_ru}>
            <h2
              className="caps sticky top-0 z-10 flex h-5 items-center gap-2 border-b border-line bg-panel px-3 text-[10px]"
              style={{ color: full ? 'var(--down)' : undefined }}
            >
              <span className="h-2.5 w-[3px]" style={{ background: DIRECTION_COLOR[dir.code] }} />
              {dir.name_ru} · {used}/{RULES.max_per_direction}
            </h2>
            {MEASURES.filter((m) => m.direction === dir.code).map((m) => {
              const placed = decisions.find((d) => d.measure_id === m.id) ?? null
              const blocked = blockReason(decisions, m.id)
              const state: CardState =
                mode.kind === 'placing' && mode.measureId === m.id ? 'placing' : placed ? 'placed' : blocked ? 'blocked' : 'default'
              return (
                <MeasureCard
                  key={m.id}
                  measure={m}
                  state={state}
                  placed={placed}
                  blocked={blocked}
                  target={selected ? districtName(selected) : null}
                  onActivate={() => activate(m.id, state)}
                  onRemove={() => remove(m.id)}
                  onHover={(hovered) => setGhost(hovered && state !== 'blocked' ? { measureId: m.id, district: selected } : null)}
                />
              )
            })}
          </section>
        )
      })}
    </aside>
  )
}
