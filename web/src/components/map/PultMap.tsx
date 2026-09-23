import { X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DISTRICT_BY_ID, MEASURE_BY_ID, RULES, districtName } from '../../engine/catalog'
import { effectShare } from '../../engine/score'
import { districtConflict } from '../../engine/validate'
import { whatIf } from '../../engine/whatif'
import { useEvaluation } from '../../hooks/useEvaluation'
import { useClosedPairs } from '../../hooks/useClosedPairs'
import { useDisplayState } from '../../hooks/useDisplayState'
import { useGhost } from '../../hooks/useGhost'
import { fmt1, fmt2, fmtShare } from '../../lib/format'
import { districtShapes } from '../../lib/geo'
import { useScenario } from '../../store/scenario'
import { useUi } from '../../store/ui'
import { DISTRICT_IDS, INDICATOR_CODES, type DistrictId } from '../../types/data'
import { MapAstana } from './MapAstana'
import { MapLegend } from './MapLegend'
import { Pins, type PinTarget } from './Pins'
import { WhatIfLabels } from './WhatIfLabels'

/**
 * Карта Пульта: выбор района, режим постановки с what-if на 5 районах (несовместимые районы
 * заблокированы), ghost-превью при наведении, пины поставленных мер с попапом «Переставить / Снять».
 */
export function PultMap() {
  const { decisions } = useEvaluation()
  const { display: state, quarter, intermediate } = useDisplayState()
  const closed = useClosedPairs(state)
  const liveGhost = useGhost()
  const ghost = intermediate ? null : liveGhost
  const place = useScenario((s) => s.place)
  const mode = useUi((s) => s.mode)
  const indicator = useUi((s) => s.indicator)
  const selected = useUi((s) => s.selectedDistrict)
  const selectDistrict = useUi((s) => s.selectDistrict)
  const cancel = useUi((s) => s.cancel)
  const setGhost = useUi((s) => s.setGhost)
  const [hovered, setHovered] = useState<DistrictId | null>(null)
  const [pointer, setPointer] = useState<[number, number]>([0, 0])
  const [pinned, setPopover] = useState<PinTarget | null>(null)
  const shapes = districtShapes()

  const placing = mode.kind === 'placing' ? MEASURE_BY_ID.get(mode.measureId) : undefined
  const options = useMemo(() => (placing ? whatIf(decisions, placing.id) : []), [placing, decisions])
  const blocked: Partial<Record<DistrictId, string>> = {}
  if (placing) {
    const others = decisions.filter((d) => d.measure_id !== placing.id)
    for (const id of DISTRICT_IDS) {
      const reason = districtConflict(others, placing.id, id)
      if (reason) blocked[id] = reason
    }
  }

  // Попап пина живёт только вне постановки и проигрывания.
  const popover = mode.kind === 'idle' ? pinned : null

  function click(id: DistrictId) {
    setPopover(null)
    if (placing) {
      place(placing.id, id)
      setGhost(null)
      cancel()
    } else {
      selectDistrict(id)
    }
  }

  function hover(id: DistrictId | null) {
    setHovered(id)
    if (placing) setGhost(id && !blocked[id] ? { measureId: placing.id, district: id } : null)
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
        ghost={ghost?.state ?? null}
        indicator={indicator}
        selected={selected}
        blocked={blocked}
        hideDelta={Boolean(placing)}
        cursor={placing ? 'crosshair' : 'default'}
        onDistrictClick={click}
        onDistrictHover={hover}
        padding={[56, 40, 80, 40]}
        overlay={(layout) => (
          <>
            <Landmark at={layout.projection(BAITEREK)} />
            <Pins
              layout={layout}
              shapes={shapes}
              decisions={decisions}
              onPinClick={placing || intermediate ? undefined : setPopover}
              litQuarter={intermediate ? (id) => quarter >= (MEASURE_BY_ID.get(id)?.lag ?? 0) + 1 : undefined}
            />
            {placing && <WhatIfLabels layout={layout} shapes={shapes} options={options} />}
            {closed.map((p, i) => {
              const [x, y] = layout.anchors[p.district_id]
              // Несколько снятых пар одного района — столбиком, а не друг на друге.
              const row = closed.slice(0, i).filter((q) => q.district_id === p.district_id).length
              return (
                <g key={`${p.district_id}.${p.indicator}`} transform={`translate(${x},${y + 42 + row * 20})`} pointerEvents="none">
                  <rect x={-40} y={0} width={80} height={17} rx={3} style={{ fill: 'var(--panel)', stroke: 'var(--up)' }} />
                  <text y={12.5} textAnchor="middle" fontSize={11} style={{ fill: 'var(--up)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                    {p.indicator} {fmt1(p.now)} ✓
                  </text>
                </g>
              )
            })}
          </>
        )}
      />

      {placing && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-chip border border-accent bg-panel px-3 py-1 text-[12px]">
          <span className="num text-accent">{placing.id}</span> {placing.name_ru} → выберите район
          <span className="num ml-2 text-ink-2">Esc отмена</span>
        </div>
      )}

      {hovered && !popover && <DistrictHoverCard id={hovered} at={pointer} />}
      {popover && <PinPopover pin={popover} onClose={() => setPopover(null)} />}
      <MapLegend />
    </div>
  )
}

/** Байтерек — ориентир, по которому жюри узнаёт город (левый берег, у Ишима). */
const BAITEREK: [number, number] = [71.4305, 51.1283]

function Landmark({ at }: { at: [number, number] | null }) {
  if (!at) return null
  const [x, y] = at
  return (
    <g transform={`translate(${x},${y})`} pointerEvents="none" aria-label="Байтерек">
      <path d="M0 -6 L4 0 L0 6 L-4 0 Z" style={{ fill: 'var(--ink)', stroke: 'var(--panel)', strokeWidth: 1.5 }} />
      <text
        x={8}
        y={3.5}
        fontSize={10}
        fontWeight={600}
        letterSpacing="0.06em"
        style={{ fill: 'var(--ink)', fontFamily: 'var(--font-sans)', paintOrder: 'stroke', stroke: 'var(--panel)', strokeWidth: 3, strokeLinejoin: 'round' }}
      >
        БАЙТЕРЕК
      </text>
    </g>
  )
}

function PinPopover({ pin, onClose }: { pin: PinTarget; onClose: () => void }) {
  const decisions = useScenario((s) => s.decisions)
  const remove = useScenario((s) => s.remove)
  const startPlacing = useUi((s) => s.startPlacing)
  const measure = MEASURE_BY_ID.get(pin.measureId)!
  const decision = decisions.find((d) => d.measure_id === pin.measureId)
  if (!decision) return null
  const share = effectShare(measure.lag)
  const effects = Object.entries(measure.effects)
    .map(([code, v]) => `${code} ${v! * share > 0 ? '+' : ''}${fmt1(v! * share)}`)
    .join(' · ')

  return (
    <div
      className="absolute z-30 w-[260px] rounded-chip border border-line bg-panel p-3 text-[12px]"
      style={{ left: Math.max(8, pin.x - 130), top: pin.y + 18 }}
    >
      <button type="button" onClick={onClose} aria-label="Закрыть" className="absolute right-2 top-2 text-ink-2 hover:text-ink">
        <X size={14} />
      </button>
      <div className="pr-5 font-medium">
        <span className="num text-accent">{measure.id}</span> {measure.name_ru}
      </div>
      <div className="num mt-1 text-[11px] text-ink-2">
        {districtName(decision.district)} · <span className="text-gold">{measure.cost} у.е.</span> · лаг {measure.lag} · {effects}
      </div>
      <div className="mt-2.5 flex gap-2">
        {measure.type === 'district' && (
          <button
            type="button"
            onClick={() => {
              onClose()
              startPlacing(measure.id)
            }}
            className="h-7 flex-1 rounded-chip border border-accent text-[12px] font-medium text-accent"
          >
            Переставить
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            onClose()
            remove(measure.id)
          }}
          className="h-7 flex-1 rounded-chip border border-line text-[12px] text-ink hover:border-down hover:text-down"
        >
          Снять
        </button>
      </div>
    </div>
  )
}

function DistrictHoverCard({ id, at }: { id: DistrictId; at: [number, number] }) {
  const { state } = useEvaluation()
  const i = DISTRICT_IDS.indexOf(id)
  const district = DISTRICT_BY_ID.get(id)!
  const lang = useUi((s) => s.lang)
  const crit = state.critical.filter((p) => p.district_id === id).length
  const weakestK = state.values[i].reduce((best, v, k, row) => (v < row[best] ? k : best), 0)
  const weakest = state.values[i][weakestK]

  return (
    <div
      className="pointer-events-none absolute z-20 whitespace-nowrap rounded-chip border border-line bg-panel px-2.5 py-1.5 text-[12px]"
      style={{ left: at[0] + 14, top: at[1] + 14 }}
    >
      <b className="font-semibold">{districtName(id, lang)}</b>
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
