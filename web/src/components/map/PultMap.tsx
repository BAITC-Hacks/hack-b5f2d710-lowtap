import { useState } from 'react'
import { DISTRICT_BY_ID, MEASURE_BY_ID, RULES } from '../../engine/catalog'
import { districtConflict } from '../../engine/validate'
import { useEvaluation } from '../../hooks/useEvaluation'
import { fmt1, fmt2, fmtShare } from '../../lib/format'
import { useScenario } from '../../store/scenario'
import { useUi } from '../../store/ui'
import { DISTRICT_IDS, INDICATOR_CODES, type DistrictId } from '../../types/data'
import { MapAstana } from './MapAstana'
import { MapLegend } from './MapLegend'

/** Карта Пульта: выбор района, постановка районной меры кликом, hover-карточка района. */
export function PultMap() {
  const { state, decisions } = useEvaluation()
  const place = useScenario((s) => s.place)
  const mode = useUi((s) => s.mode)
  const indicator = useUi((s) => s.indicator)
  const selected = useUi((s) => s.selectedDistrict)
  const selectDistrict = useUi((s) => s.selectDistrict)
  const cancel = useUi((s) => s.cancel)
  const [hovered, setHovered] = useState<DistrictId | null>(null)
  const [pointer, setPointer] = useState<[number, number]>([0, 0])

  const placing = mode.kind === 'placing' ? MEASURE_BY_ID.get(mode.measureId) : undefined
  const others = placing ? decisions.filter((d) => d.measure_id !== placing.id) : decisions
  const blocked: Partial<Record<DistrictId, string>> = {}
  if (placing) {
    for (const id of DISTRICT_IDS) {
      const reason = districtConflict(others, placing.id, id)
      if (reason) blocked[id] = reason
    }
  }

  function click(id: DistrictId) {
    if (placing) {
      place(placing.id, id)
      cancel()
    } else {
      selectDistrict(id)
    }
  }

  return (
    <div
      className="absolute inset-0"
      onMouseMove={(e) => {
        const box = e.currentTarget.getBoundingClientRect()
        setPointer([e.clientX - box.left, e.clientY - box.top])
      }}
    >
      <MapAstana
        state={state}
        indicator={indicator}
        selected={selected}
        blocked={blocked}
        cursor={placing ? 'crosshair' : 'default'}
        onDistrictClick={click}
        onDistrictHover={setHovered}
        padding={[36, 40, 80, 40]}
      />

      {placing && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-chip border border-accent bg-panel px-3 py-1 text-[12px]">
          <span className="num text-accent">{placing.id}</span> {placing.name_ru} → выберите район
          <span className="num ml-2 text-ink-2">Esc отмена</span>
        </div>
      )}

      {hovered && <DistrictHoverCard id={hovered} at={pointer} />}
      <MapLegend />
    </div>
  )
}

function DistrictHoverCard({ id, at }: { id: DistrictId; at: [number, number] }) {
  const { state } = useEvaluation()
  const i = DISTRICT_IDS.indexOf(id)
  const district = DISTRICT_BY_ID.get(id)!
  const crit = state.critical.filter((p) => p.district_id === id).length
  const weakestK = state.values[i].reduce((best, v, k, row) => (v < row[best] ? k : best), 0)
  const weakest = state.values[i][weakestK]

  return (
    <div
      className="pointer-events-none absolute z-20 whitespace-nowrap rounded-chip border border-line bg-panel px-2.5 py-1.5 text-[12px]"
      style={{ left: at[0] + 14, top: at[1] + 14 }}
    >
      <b className="font-semibold">{district.name_ru}</b>
      <span className="num text-ink-2">
        {' '}
        · D {fmt2(state.d[i])} · pop {fmtShare(district.pop_share)} ·{' '}
        <span style={{ color: crit ? 'var(--down)' : undefined }}>крит {crit}</span>
      </span>
      <div className="num mt-0.5 text-[11px]">
        слабее всего:{' '}
        <b style={{ color: weakest < RULES.critical_threshold ? 'var(--down)' : 'var(--ink)' }}>
          {INDICATOR_CODES[weakestK]} {fmt1(weakest)}
        </b>
      </div>
    </div>
  )
}
