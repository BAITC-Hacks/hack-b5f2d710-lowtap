import { useId, useMemo, useState, type ReactNode } from 'react'
import { DISTRICT_BY_ID, RULES } from '../../engine/catalog'
import { BASE_STATE, type EngineState } from '../../engine/score'
import { useSize } from '../../hooks/useSize'
import { deltaColor, labelInk, mapColor, signColor } from '../../lib/colors'
import { fmt1, fmt2, fmtSigned } from '../../lib/format'
import { districtShapes, fitMap, riverLine, type MapLayout, type Padding } from '../../lib/geo'
import type { MapIndicator } from '../../store/ui'
import { DISTRICT_IDS, INDICATOR_CODES, type DistrictId } from '../../types/data'

const EASE = 'var(--ease-data)'

export interface MapAstanaProps {
  state: EngineState
  base?: EngineState
  indicator?: MapIndicator
  /** Мини-карта без подписей и взаимодействия (Вердикт, Сравнение). */
  compact?: boolean
  selected?: DistrictId | null
  /** Районы, куда ставить нельзя (конфликт «в одном районе»): штриховка и блок клика. */
  blocked?: Partial<Record<DistrictId, string>>
  cursor?: 'default' | 'crosshair'
  onDistrictClick?: (id: DistrictId) => void
  onDistrictHover?: (id: DistrictId | null) => void
  /** Слои поверх районов в пиксельных координатах карты (пины, what-if). */
  overlay?: (layout: MapLayout) => ReactNode
  padding?: Padding
}

/** Значение района для заливки и подписи в выбранном режиме легенды. */
function districtValue(state: EngineState, base: EngineState, indicator: MapIndicator, i: number): number {
  if (indicator === 'D') return state.d[i]
  if (indicator === 'delta') return state.d[i] - base.d[i]
  return state.values[i][INDICATOR_CODES.indexOf(indicator)]
}

/** Хороплет настоящей Астаны: SVG, geoMercator + fitExtent; DOM целиком у React, заливка — CSS transition. */
export function MapAstana({
  state,
  base = BASE_STATE,
  indicator = 'D',
  compact = false,
  selected = null,
  blocked = {},
  cursor = 'default',
  onDistrictClick,
  onDistrictHover,
  overlay,
  padding = 40,
}: MapAstanaProps) {
  const [ref, { width, height }] = useSize<HTMLDivElement>()
  const [hovered, setHovered] = useState<DistrictId | null>(null)
  const hatchId = `hatch${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const shapes = districtShapes()
  const river = useMemo(() => riverLine(shapes), [shapes])
  const layout = useMemo(() => (width && height ? fitMap(shapes, width, height, padding) : null), [shapes, width, height, padding])

  const k = indicator === 'D' || indicator === 'delta' ? -1 : INDICATOR_CODES.indexOf(indicator)
  const critical = (i: number) =>
    k >= 0 ? state.values[i][k] < RULES.critical_threshold : state.critical.some((p) => p.district_id === DISTRICT_IDS[i])
  const fill = (i: number) => {
    const v = districtValue(state, base, indicator, i)
    return indicator === 'delta' ? deltaColor(v) : mapColor(v)
  }
  const interactive = Boolean(onDistrictClick) && !compact

  function hover(id: DistrictId | null) {
    setHovered(id)
    onDistrictHover?.(id)
  }

  return (
    <div ref={ref} className="absolute inset-0">
      {layout && (
        <svg width={width} height={height} role="img" aria-label="Карта районов Астаны" style={{ cursor }}>
          <defs>
            <pattern id={hatchId} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" style={{ stroke: 'var(--down)', strokeWidth: 2 }} />
            </pattern>
          </defs>

          {/* districts */}
          <g>
            {shapes.map((s, i) => (
              <g key={s.id}>
                {s.exclaves.map((ex, j) => (
                  <path key={j} d={layout.path(ex) ?? undefined} opacity={0.35} style={{ fill: fill(i), transition: `fill 300ms ${EASE}` }} />
                ))}
                <path
                  d={layout.path(s.main) ?? undefined}
                  role={interactive ? 'button' : undefined}
                  aria-label={interactive ? `${DISTRICT_BY_ID.get(s.id)!.name_ru}, D ${fmt2(state.d[i])}` : undefined}
                  style={{
                    fill: fill(i),
                    stroke: 'var(--panel)',
                    strokeWidth: 1,
                    transition: `fill 300ms ${EASE}`,
                    cursor: interactive ? (blocked[s.id] ? 'not-allowed' : cursor === 'crosshair' ? 'crosshair' : 'pointer') : undefined,
                  }}
                  onMouseEnter={interactive ? () => hover(s.id) : undefined}
                  onMouseLeave={interactive ? () => hover(null) : undefined}
                  onClick={interactive && !blocked[s.id] ? () => onDistrictClick?.(s.id) : undefined}
                />
              </g>
            ))}
          </g>

          {/* hatch (<40): пульсирует, пока в городе есть критические пары */}
          <g className={state.nCrit > 0 ? 'crit-pulse' : undefined} pointerEvents="none">
            {shapes.map((s, i) => (
              <path
                key={s.id}
                d={layout.path(s.main) ?? undefined}
                fill={`url(#${hatchId})`}
                style={{ opacity: critical(i) || blocked[s.id] ? 0.55 : 0, transition: `opacity 300ms ${EASE}` }}
              />
            ))}
          </g>

          {/* river */}
          <path
            d={layout.path(river) ?? undefined}
            pointerEvents="none"
            style={{ fill: 'none', stroke: 'var(--accent)', strokeWidth: 1.5, opacity: 0.5, strokeLinejoin: 'round' }}
          />

          {/* selection / hover */}
          <g pointerEvents="none">
            {shapes.map((s) =>
              s.id === selected || (interactive && s.id === hovered) ? (
                <path
                  key={s.id}
                  d={layout.path(s.main) ?? undefined}
                  style={{ fill: 'none', stroke: 'var(--accent)', strokeWidth: s.id === selected ? 2.5 : 1.5 }}
                />
              ) : null,
            )}
          </g>

          {!compact && (
            <g pointerEvents="none">
              {DISTRICT_IDS.map((id, i) => (
                <DistrictLabel
                  key={id}
                  id={id}
                  at={layout.anchors[id]}
                  value={districtValue(state, base, indicator, i)}
                  delta={indicator === 'delta' ? null : districtValue(state, base, indicator, i) - districtValue(base, base, indicator, i)}
                  indicator={indicator}
                  fillColor={fill(i)}
                  blocked={blocked[id]}
                />
              ))}
            </g>
          )}

          {overlay?.(layout)}
        </svg>
      )}
    </div>
  )
}

interface LabelProps {
  id: DistrictId
  at: [number, number]
  value: number
  delta: number | null
  indicator: MapIndicator
  fillColor: string
  blocked?: string
}

function DistrictLabel({ id, at, value, delta, indicator, fillColor, blocked }: LabelProps) {
  const ink = indicator === 'delta' ? 'var(--ink)' : labelInk(value)
  const text = indicator === 'delta' ? fmtSigned(value) : indicator === 'D' ? fmt2(value) : fmt1(value)
  const showDelta = !blocked && delta !== null && Math.abs(delta) >= 0.005
  const chip = showDelta ? (indicator === 'D' ? fmtSigned(delta) : fmtSigned(delta, 1)) : ''
  const chipWidth = chip.length * 6.4 + 8
  const halo = { paintOrder: 'stroke' as const, stroke: fillColor, strokeWidth: 3, strokeLinejoin: 'round' as const }

  return (
    <g transform={`translate(${at[0]},${at[1]})`} textAnchor="middle">
      <text y={-5} fontSize={11} fontWeight={600} letterSpacing="0.10em" style={{ fill: ink, fontFamily: 'var(--font-sans)', ...halo }}>
        {DISTRICT_BY_ID.get(id)!.name_ru.toUpperCase()}
      </text>
      <text y={10} fontSize={12} style={{ fill: ink, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', ...halo }}>
        {text}
      </text>
      {showDelta && (
        <g transform="translate(0,16)">
          <rect x={-chipWidth / 2} y={0} width={chipWidth} height={14} rx={3} style={{ fill: 'var(--panel)' }} />
          <text y={10.5} fontSize={10} style={{ fill: signColor(delta!), fontFamily: 'var(--font-mono)' }}>
            {chip}
          </text>
        </g>
      )}
      {blocked && (
        <g transform="translate(0,16)">
          <rect x={-78} y={0} width={156} height={15} rx={3} style={{ fill: 'var(--panel)', stroke: 'var(--down)' }} />
          <text y={11} fontSize={10} style={{ fill: 'var(--down)', fontFamily: 'var(--font-sans)' }}>
            {blocked}
          </text>
        </g>
      )}
    </g>
  )
}
