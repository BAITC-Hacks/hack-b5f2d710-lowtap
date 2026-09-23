import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useMemo } from 'react'
import { MEASURE_BY_ID } from '../../engine/catalog'
import { DIRECTION_COLOR } from '../../lib/colors'
import { anchored, pinOffset, type DistrictShape, type MapLayout } from '../../lib/geo'
import type { Decision } from '../../types/api'
import { DISTRICT_IDS, type DistrictId } from '../../types/data'

/** Пины над плашкой района. */
const PIN_LIFT = -40

export interface PinTarget {
  measureId: string
  district: DistrictId
  /** Якорь района в координатах карты. */
  x: number
  y: number
  /** Смещение пина от якоря в экранных пикселях (не масштабируется зумом). */
  ox: number
  oy: number
}

interface Props {
  layout: MapLayout
  shapes: DistrictShape[]
  decisions: readonly Decision[]
  onPinClick?: (pin: PinTarget) => void
  /** Для таймлайна: пин «загорается» с квартала L+1, до этого — бледный. */
  litQuarter?: (measureId: string) => boolean
}

/**
 * Пины поставленных мер: круг 22 px с полосой направления и ID; мера «Город» — пин 16 px на каждом районе.
 * Постановка: пин падает на район, от него расходится кольцо, обрезанное контуром района.
 */
export function Pins({ layout, shapes, decisions, onPinClick, litQuarter }: Props) {
  const reduced = useReducedMotion()
  const clipPaths = useMemo(() => shapes.map((s) => ({
    id: s.id,
    path: layout.path(s.main) ?? undefined,
  })), [layout, shapes])
  const pins: (PinTarget & { size: number; color: string })[] = []
  const slot: Record<string, number> = {}

  const ordered = [...decisions.filter((d) => d.district !== null), ...decisions.filter((d) => d.district === null)]
  for (const d of ordered) {
    const measure = MEASURE_BY_ID.get(d.measure_id)
    if (!measure) continue
    const targets = (d.district === null ? DISTRICT_IDS : DISTRICT_IDS.filter((id) => id === d.district)) as DistrictId[]
    for (const id of targets) {
      const n = (slot[id] = (slot[id] ?? -1) + 1)
      const [dx, dy] = pinOffset(n)
      const [ax, ay] = layout.anchors[id]
      pins.push({
        measureId: measure.id,
        district: id,
        x: ax,
        y: ay,
        ox: dx,
        oy: PIN_LIFT - dy,
        size: d.district === null ? 16 : 22,
        color: DIRECTION_COLOR[measure.direction],
      })
    }
  }

  return (
    <g>
      <defs>
        {clipPaths.map((s) => (
          <clipPath key={s.id} id={`clip-${s.id}`}>
            <path d={s.path} />
          </clipPath>
        ))}
      </defs>
      <AnimatePresence>
        {pins.map((p) => {
          const r = p.size / 2
          const lit = litQuarter ? litQuarter(p.measureId) : true
          return (
            // Прямой ребёнок AnimatePresence — обычная группа: exit у вложенного motion.g всё равно срабатывает.
            <g key={`${p.measureId}-${p.district}`}>
              {!reduced && (
                // Кольцо обрезается контуром района в координатах карты, само рисуется в экранных.
                <g clipPath={`url(#clip-${p.district})`} pointerEvents="none">
                  <g style={anchored(p.x, p.y)}>
                    <motion.circle
                      cx={p.ox}
                      cy={p.oy + r}
                      initial={{ r: 0, opacity: 0.5 }}
                      animate={{ r: 90, opacity: 0 }}
                      transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
                      style={{ fill: 'none', stroke: p.color, strokeWidth: 2 }}
                    />
                  </g>
                </g>
              )}
              <g style={anchored(p.x, p.y)}>
                <motion.g
                  initial={reduced ? false : { opacity: 0, y: -24 }}
                  animate={{ opacity: lit ? 1 : 0.35, y: 0 }}
                  exit={{ opacity: 0, transition: { duration: 0.15 } }}
                  transition={{ type: 'spring', stiffness: 420, damping: 28, mass: 0.6 }}
                  style={{ cursor: onPinClick ? 'pointer' : undefined }}
                  onClick={onPinClick ? () => onPinClick(p) : undefined}
                >
                  <circle cx={p.ox} cy={p.oy} r={r} style={{ fill: 'var(--panel)', stroke: p.color, strokeWidth: 3 }} />
                  <text
                    x={p.ox}
                    y={p.oy + (p.size === 22 ? 3.5 : 3)}
                    textAnchor="middle"
                    fontSize={p.size === 22 ? 9 : 7}
                    style={{ fill: 'var(--ink)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}
                  >
                    {p.measureId}
                  </text>
                </motion.g>
              </g>
            </g>
          )
        })}
      </AnimatePresence>
    </g>
  )
}
