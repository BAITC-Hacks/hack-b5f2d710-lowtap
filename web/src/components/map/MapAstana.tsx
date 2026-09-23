import { Maximize, Minus, Plus } from 'lucide-react'
import { useId, useMemo, useState, type ReactNode } from 'react'
import { DISTRICT_BY_ID, RULES, districtName } from '../../engine/catalog'
import { BASE_STATE, type EngineState } from '../../engine/score'
import { useMapNavigation, type MapView } from '../../hooks/useMapNavigation'
import { useSize } from '../../hooks/useSize'
import { DISTRICT_COLOR, deltaColor, labelInk, mapColor, signColor } from '../../lib/colors'
import { fmt1, fmt2, fmtSigned } from '../../lib/format'
import { anchored, districtShapes, fitMap, riverLine, screenStroke, type MapLayout, type Padding } from '../../lib/geo'
import { useUi, type MapIndicator } from '../../store/ui'
import { DISTRICT_IDS, INDICATOR_CODES, type DistrictId } from '../../types/data'
import { MapLandscapeImage } from './MapLandscape'

const EASE = 'var(--ease-data)'

export interface MapAstanaProps {
  state: EngineState
  base?: EngineState
  /** «Что если» при наведении: карта перекрашивается в это состояние, изменённые районы — пунктиром. */
  ghost?: EngineState | null
  indicator?: MapIndicator
  /** Мини-карта без взаимодействия (Вердикт, Сравнение). */
  compact?: boolean
  /** Пейзаж и управление камерой только для большой карты Пульта. */
  navigable?: boolean
  onNavigate?: () => void
  /** Подписи: имя + число + дельта, только число или ничего. */
  labels?: 'full' | 'numbers' | 'none'
  /** Подсветка района извне (hover на числе записки). */
  highlight?: DistrictId | null
  /** Без дельта-чипов под числами (их место занимают what-if ярлыки). */
  hideDelta?: boolean
  /** В режиме D — свой цвет у каждого района вместо шкалы (карта Пульта); мини-карты остаются в шкале. */
  districtColors?: boolean
  selected?: DistrictId | null
  /** Районы, куда ставить нельзя (конфликт «в одном районе»): штриховка и блок клика. */
  blocked?: Partial<Record<DistrictId, string>>
  cursor?: 'default' | 'crosshair'
  onDistrictClick?: (id: DistrictId) => void
  onDistrictHover?: (id: DistrictId | null) => void
  /** Слои поверх районов в пиксельных координатах карты (пины, what-if). */
  overlay?: (layout: MapLayout, getView: () => MapView) => ReactNode
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
  state: current,
  base = BASE_STATE,
  ghost = null,
  indicator = 'D',
  compact = false,
  navigable = false,
  onNavigate,
  labels = compact ? 'none' : 'full',
  highlight = null,
  hideDelta = false,
  districtColors = false,
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
  const [focused, setFocused] = useState<DistrictId | null>(null)
  const { viewportRef, worldRef, getView, dragging, handlers, zoomIn, zoomOut, reset, canZoomIn, canZoomOut } = useMapNavigation(width, height, navigable && !compact, () => {
    setHovered(null)
    onDistrictHover?.(null)
    onNavigate?.()
  })
  const hatchId = `hatch${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const shapes = districtShapes()
  const river = useMemo(() => riverLine(shapes), [shapes])
  const layout = useMemo(() => (width && height ? fitMap(shapes, width, height, padding) : null), [shapes, width, height, padding])
  const paths = useMemo(() => layout && ({
    districts: shapes.map((s) => ({
      id: s.id,
      main: layout.path(s.main) ?? undefined,
      exclaves: s.exclaves.map((ex) => layout.path(ex) ?? undefined),
    })),
    river: layout.path(river) ?? undefined,
  }), [layout, shapes, river])
  const state = ghost ?? current
  const ghostChanged = (i: number) => ghost !== null && Math.abs(ghost.d[i] - current.d[i]) >= 0.005

  const k = indicator === 'D' || indicator === 'delta' ? -1 : INDICATOR_CODES.indexOf(indicator)
  const critical = (i: number) =>
    k >= 0 ? state.values[i][k] < RULES.critical_threshold : state.critical.some((p) => p.district_id === DISTRICT_IDS[i])
  const categorical = districtColors && indicator === 'D'
  const fill = (i: number) => {
    if (categorical) return DISTRICT_COLOR[DISTRICT_IDS[i]].fill
    const v = districtValue(state, base, indicator, i)
    return indicator === 'delta' ? deltaColor(v) : mapColor(v)
  }
  const interactive = Boolean(onDistrictClick) && !compact

  function hover(id: DistrictId | null) {
    if (dragging) return
    setHovered(id)
    onDistrictHover?.(id)
  }

  return (
    <div ref={ref} className="absolute inset-0 overflow-hidden">
      {layout && paths && (
        <div
          ref={viewportRef}
          data-testid="map-viewport"
          className="absolute inset-0"
          style={{
            cursor: dragging ? 'grabbing' : navigable && cursor === 'default' ? 'grab' : cursor,
            touchAction: navigable ? 'none' : undefined,
            userSelect: 'none',
            background: navigable && !compact ? '#c9dfa8' : undefined,
          }}
          {...handlers}
        >
          <div ref={worldRef} data-testid="map-world" className="absolute inset-0" style={{ transformOrigin: '0 0' }}>
            {navigable && !compact && <MapLandscapeImage />}
            <svg className="absolute inset-0" width={width} height={height} role="img" aria-label="Карта районов Астаны" style={{ overflow: 'visible' }}>
              <defs>
                <pattern id={hatchId} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="6" style={{ stroke: 'var(--down)', strokeWidth: 2 }} />
                </pattern>
              </defs>

              <g>
                {/* districts */}
                <g>
                  {paths.districts.map((s, i) => (
                    <g key={s.id}>
                      {s.exclaves.map((ex, j) => (
                        <path key={j} d={ex} opacity={0.35} style={{ fill: fill(i), transition: `fill 300ms ${EASE}` }} />
                      ))}
                      <path
                        d={s.main}
                        role={interactive ? 'button' : undefined}
                        aria-label={interactive ? `${DISTRICT_BY_ID.get(s.id)!.name_ru}, D ${fmt2(state.d[i])}` : undefined}
                        style={{
                          fill: fill(i),
                          stroke: categorical ? DISTRICT_COLOR[s.id].line : 'var(--panel)',
                          strokeWidth: screenStroke(categorical ? 1.5 : 1),
                          transition: `fill 300ms ${EASE}`,
                          // SVG's native focus ring outlines the bounding rectangle.
                          // Keyboard focus is drawn along the district contour below.
                          outline: 'none',
                          cursor: dragging ? 'grabbing' : interactive ? (blocked[s.id] ? 'not-allowed' : cursor === 'crosshair' ? 'crosshair' : navigable ? 'grab' : 'pointer') : undefined,
                        }}
                        onMouseEnter={interactive ? () => hover(s.id) : undefined}
                        onMouseLeave={interactive ? () => hover(null) : undefined}
                        onClick={interactive && !blocked[s.id] ? () => onDistrictClick?.(s.id) : undefined}
                        tabIndex={interactive ? 0 : undefined}
                        onFocus={interactive ? (event) => { if (event.currentTarget.matches(':focus-visible')) setFocused(s.id) } : undefined}
                        onBlur={interactive ? () => setFocused(null) : undefined}
                        onKeyDown={interactive && !blocked[s.id] ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDistrictClick?.(s.id) } } : undefined}
                      />
                    </g>
                  ))}
                </g>

                {/* hatch (<40); без CSS-пульса: анимация внутри SVG перерисовывала бы карту каждый кадр */}
                <g pointerEvents="none">
                  {paths.districts.map((s, i) => (
                    <path
                      key={s.id}
                      d={s.main}
                      fill={`url(#${hatchId})`}
                      style={{ opacity: critical(i) || blocked[s.id] ? 0.55 : 0, transition: `opacity 300ms ${EASE}` }}
                    />
                  ))}
                </g>

                {/* river */}
                <path
                  d={paths.river}
                  pointerEvents="none"
                  style={{ fill: 'none', stroke: 'var(--accent)', strokeWidth: screenStroke(1.5), opacity: 0.5, strokeLinejoin: 'round' }}
                />

                {/* selection / hover / ghost / highlight */}
                <g pointerEvents="none">
                  {paths.districts.map((s, i) =>
                    s.id === selected || s.id === highlight || s.id === focused || (interactive && s.id === hovered) || ghostChanged(i) ? (
                      <path
                        key={s.id}
                        d={s.main}
                        style={{
                          fill: 'none',
                          stroke: 'var(--accent)',
                          strokeWidth: screenStroke(s.id === selected || s.id === highlight || s.id === focused ? 2.5 : 1.5),
                          strokeDasharray: ghostChanged(i) && s.id !== selected ? '4 2' : undefined,
                        }}
                      />
                    ) : null,
                  )}
                </g>

                {labels !== 'none' && (
                  <g pointerEvents="none">
                    {DISTRICT_IDS.map((id, i) => (
                      <DistrictLabel
                        key={id}
                        id={id}
                        at={layout.anchors[id]}
                        value={districtValue(state, base, indicator, i)}
                        delta={
                          hideDelta || labels === 'numbers' || indicator === 'delta'
                            ? null
                            : districtValue(state, base, indicator, i) - districtValue(ghost ? current : base, base, indicator, i)
                        }
                        ghost={ghost !== null}
                        nameless={labels === 'numbers'}
                        critical={critical(i)}
                        indicator={indicator}
                        fillColor={fill(i)}
                        blocked={blocked[id]}
                      />
                    ))}
                  </g>
                )}

                {overlay?.(layout, getView)}
              </g>
            </svg>
          </div>
        </div>
      )}
      {navigable && !compact && (
        <div className="absolute right-3 top-3 flex flex-col overflow-hidden rounded-chip border border-line bg-panel shadow-sm" role="group" aria-label="Масштаб карты">
          <button type="button" aria-label="Приблизить карту" title="Приблизить — также колёсиком мыши" onClick={zoomIn} disabled={!canZoomIn} className="flex h-8 w-8 items-center justify-center text-ink-2 hover:bg-bg disabled:opacity-35">
            <Plus size={16} />
          </button>
          <button type="button" aria-label="Отдалить карту" title="Отдалить" onClick={zoomOut} disabled={!canZoomOut} className="flex h-8 w-8 items-center justify-center border-t border-line text-ink-2 hover:bg-bg disabled:opacity-35">
            <Minus size={16} />
          </button>
          <button type="button" aria-label="Вернуть карту в центр" title="Исходный вид карты" onClick={reset} className="flex h-8 w-8 items-center justify-center border-t border-line text-ink-2 hover:bg-bg">
            <Maximize size={15} />
          </button>
        </div>
      )}
    </div>
  )
}

interface LabelProps {
  id: DistrictId
  at: [number, number]
  value: number
  delta: number | null
  /** Дельта — к текущему набору в режиме «что если»: пунктир, opacity 0.6. */
  ghost?: boolean
  nameless?: boolean
  /** В районе есть показатель < 40: черта плашки красная. */
  critical?: boolean
  indicator: MapIndicator
  fillColor: string
  blocked?: string
}

/** Геометрия плашки района относительно центроида: пины — выше, чипы и ярлыки — ниже. */
const PLATE_TOP = -26
const PLATE_BOTTOM = 20

function DistrictLabel({ id, at, value, delta, ghost = false, nameless = false, critical = false, indicator, fillColor, blocked }: LabelProps) {
  const lang = useUi((s) => s.lang)
  if (!nameless) {
    return <DistrictPlate {...{ id, at, value, delta, ghost, critical, indicator, blocked }} name={districtName(id, lang).toUpperCase()} />
  }
  const ink = indicator === 'delta' ? 'var(--ink)' : labelInk(value)
  const text = indicator === 'delta' ? fmtSigned(value) : indicator === 'D' ? fmt2(value) : fmt1(value)
  const showDelta = !blocked && delta !== null && Math.abs(delta) >= 0.005
  const chip = showDelta ? (indicator === 'D' ? fmtSigned(delta) : fmtSigned(delta, 1)) : ''
  const chipWidth = chip.length * 6.4 + 8
  const halo = { paintOrder: 'stroke' as const, stroke: fillColor, strokeWidth: 3, strokeLinejoin: 'round' as const }

  return (
    <g style={anchored(at[0], at[1])} textAnchor="middle">
      {!nameless && (
        <text y={-5} fontSize={11} fontWeight={600} letterSpacing="0.10em" style={{ fill: ink, fontFamily: 'var(--font-sans)', ...halo }}>
          {districtName(id, lang).toUpperCase()}
        </text>
      )}
      <text
        y={nameless ? 4 : 10}
        fontSize={12}
        style={{ fill: ink, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', ...halo }}
      >
        {text}
      </text>
      {showDelta && (
        <g transform="translate(0,16)" opacity={ghost ? 0.6 : 1}>
          <rect
            x={-chipWidth / 2}
            y={0}
            width={chipWidth}
            height={14}
            rx={3}
            style={{ fill: 'var(--panel)', stroke: ghost ? 'var(--accent)' : 'none', strokeDasharray: '4 2' }}
          />
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

interface PlateProps extends Omit<LabelProps, 'nameless' | 'fillColor'> {
  name: string
}

/**
 * Плашка района: имя капителью, число крупно (читается с проектора), снизу черта —
 * красная, если в районе есть показатель < 40. Плоская: 1px рамка, без теней.
 */
function DistrictPlate({ at, value, delta, ghost = false, critical = false, indicator, blocked, name }: PlateProps) {
  const text = indicator === 'delta' ? fmtSigned(value) : indicator === 'D' ? fmt2(value) : fmt1(value)
  const showDelta = !blocked && delta !== null && Math.abs(delta) >= 0.005
  const chip = showDelta ? (indicator === 'D' ? fmtSigned(delta) : fmtSigned(delta, 1)) : ''
  const chipWidth = chip.length * 6.4 + 8
  const width = Math.max(name.length * 7.4, text.length * 12.2) + 18
  const valueColor = indicator === 'delta' ? signColor(value) : 'var(--ink)'

  return (
    <g style={anchored(at[0], at[1])} textAnchor="middle">
      <rect
        x={-width / 2}
        y={PLATE_TOP}
        width={width}
        height={PLATE_BOTTOM - PLATE_TOP}
        rx={3}
        style={{
          fill: 'var(--panel)',
          stroke: ghost ? 'var(--accent)' : 'var(--line)',
          strokeDasharray: ghost ? '4 2' : undefined,
          transition: 'stroke 150ms var(--ease-data)',
        }}
      />
      <rect
        x={-width / 2}
        y={PLATE_BOTTOM - 3}
        width={width}
        height={3}
        style={{ fill: critical ? 'var(--down)' : 'var(--accent)', transition: 'fill 300ms var(--ease-data)' }}
      />
      <text y={PLATE_TOP + 14} fontSize={10} fontWeight={600} letterSpacing="0.10em" style={{ fill: 'var(--ink-2)', fontFamily: 'var(--font-sans)' }}>
        {name}
      </text>
      <text
        y={PLATE_BOTTOM - 8}
        fontSize={20}
        fontWeight={600}
        style={{ fill: valueColor, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}
      >
        {text}
      </text>
      {showDelta && (
        <g transform={`translate(0,${PLATE_BOTTOM + 4})`} opacity={ghost ? 0.6 : 1}>
          <rect
            x={-chipWidth / 2}
            y={0}
            width={chipWidth}
            height={14}
            rx={3}
            style={{ fill: 'var(--panel)', stroke: ghost ? 'var(--accent)' : 'var(--line)', strokeDasharray: ghost ? '4 2' : undefined }}
          />
          <text y={10.5} fontSize={10} style={{ fill: signColor(delta!), fontFamily: 'var(--font-mono)' }}>
            {chip}
          </text>
        </g>
      )}
      {blocked && (
        <g transform={`translate(0,${PLATE_BOTTOM + 4})`}>
          <rect x={-78} y={0} width={156} height={15} rx={3} style={{ fill: 'var(--panel)', stroke: 'var(--down)' }} />
          <text y={11} fontSize={10} style={{ fill: 'var(--down)', fontFamily: 'var(--font-sans)' }}>
            {blocked}
          </text>
        </g>
      )}
    </g>
  )
}
