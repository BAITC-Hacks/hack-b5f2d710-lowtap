import { scaleLinear } from 'd3-scale'
import { curveStepAfter, line } from 'd3-shape'
import { useRef } from 'react'
import { MEASURE_BY_ID } from '../../engine/catalog'
import { firstEffectQuarter } from '../../engine/timeline'
import { useSize } from '../../hooks/useSize'
import { DIRECTION_COLOR } from '../../lib/colors'
import { fmt2 } from '../../lib/format'
import { HORIZON, useUi } from '../../store/ui'
import type { Decision, TimelinePoint } from '../../types/api'

const DOMAIN: [number, number] = [50, 58]

interface Props {
  points: TimelinePoint[]
  decisions: readonly Decision[]
}

/**
 * Score(q) по 8 кварталам (ступеньки — формула ТЗ с долей эффекта max(0, q−L)/8), маркеры мер
 * в квартале первого эффекта L+1 и скраббер: перетаскивание меняет квартал на карте и в рейке.
 */
export function Timeline({ points, decisions }: Props) {
  const [ref, { width, height }] = useSize<HTMLDivElement>()
  const quarter = useUi((s) => s.quarter)
  const setQuarter = useUi((s) => s.setQuarter)
  const mode = useUi((s) => s.mode)
  const dragging = useRef(false)

  const left = 30
  const right = 48
  const markersH = 20
  const axisH = 14
  const x = scaleLinear().domain([0, HORIZON]).range([left, Math.max(left + 1, width - right)])
  const y = scaleLinear()
    .domain(DOMAIN)
    .range([height - markersH - axisH - 4, 8])
    .clamp(true)
  const path = line<TimelinePoint>()
    .x((p) => x(p.q))
    .y((p) => y(p.score))
    .curve(curveStepAfter)(points)

  const markers = decisions
    .map((d) => ({ d, q: firstEffectQuarter(d.measure_id), m: MEASURE_BY_ID.get(d.measure_id) }))
    .filter((v) => v.q !== null && v.m)
  const perQuarter: Record<number, number> = {}

  function fromPointer(clientX: number, el: Element) {
    const box = el.getBoundingClientRect()
    setQuarter(x.invert(clientX - box.left))
  }

  const current = points[Math.min(quarter, points.length - 1)]

  return (
    <div ref={ref} className="relative h-full w-full select-none">
      {width > 0 && height > 0 && (
        <svg
          width={width}
          height={height}
          aria-label="Score по кварталам"
          style={{ cursor: 'ew-resize', touchAction: 'none' }}
          onPointerDown={(e) => {
            if (mode.kind === 'playing') useUi.getState().togglePlay()
            dragging.current = true
            e.currentTarget.setPointerCapture(e.pointerId)
            fromPointer(e.clientX, e.currentTarget)
          }}
          onPointerMove={(e) => dragging.current && fromPointer(e.clientX, e.currentTarget)}
          onPointerUp={() => (dragging.current = false)}
        >
          {[50, 54, 58].map((v) => (
            <g key={v}>
              <line x1={left} x2={width - right} y1={y(v)} y2={y(v)} style={{ stroke: 'var(--line)', strokeDasharray: v === 54 ? '2 3' : undefined }} />
              <text x={left - 6} y={y(v) + 3} textAnchor="end" fontSize={9} style={{ fill: 'var(--ink-2)', fontFamily: 'var(--font-mono)' }}>
                {v}
              </text>
            </g>
          ))}

          {path && <path d={path} style={{ fill: 'none', stroke: 'var(--ink)', strokeWidth: 1.5 }} />}
          {points.map((p) => (
            <circle
              key={p.q}
              cx={x(p.q)}
              cy={y(p.score)}
              r={p.q === quarter ? 4 : 2.5}
              style={{ fill: p.q <= quarter ? 'var(--ink)' : 'var(--panel)', stroke: 'var(--ink)', strokeWidth: 1.2 }}
            />
          ))}
          <text x={x(0) + 6} y={y(points[0].score) - 6} fontSize={10} style={{ fill: 'var(--ink-2)', fontFamily: 'var(--font-mono)' }}>
            {fmt2(points[0].score)}
          </text>
          <text x={x(HORIZON) + 6} y={y(points[HORIZON].score) + 3} fontSize={10} style={{ fill: 'var(--ink)', fontFamily: 'var(--font-mono)' }}>
            {fmt2(points[HORIZON].score)}
          </text>

          {/* маркеры мер: квартал первого эффекта L+1 */}
          {markers.map(({ d, q, m }) => {
            const n = (perQuarter[q!] = (perQuarter[q!] ?? -1) + 1)
            const cx = x(q!) + (n % 2 ? 1 : -1) * Math.ceil(n / 2) * 24
            const lit = quarter >= q!
            return (
              <g key={d.measure_id} transform={`translate(${cx},${height - axisH - markersH / 2})`} opacity={lit ? 1 : 0.4}>
                <rect x={-11} y={-7} width={22} height={14} rx={7} style={{ fill: 'var(--panel)', stroke: DIRECTION_COLOR[m!.direction], strokeWidth: 1.5 }} />
                <text y={3} textAnchor="middle" fontSize={8} style={{ fill: 'var(--ink)', fontFamily: 'var(--font-mono)' }}>
                  {d.measure_id}
                </text>
              </g>
            )
          })}

          {points.map((p) => (
            <text
              key={p.q}
              x={x(p.q)}
              y={height - 2}
              textAnchor="middle"
              fontSize={9}
              style={{ fill: p.q === quarter ? 'var(--accent)' : 'var(--ink-2)', fontFamily: 'var(--font-mono)', fontWeight: p.q === quarter ? 600 : 400 }}
            >
              Q{p.q}
            </text>
          ))}

          {/* скраббер */}
          <g transform={`translate(${x(quarter)},0)`} pointerEvents="none" style={{ transition: 'transform 200ms var(--ease-data)' }}>
            <line y1={2} y2={height - axisH} style={{ stroke: 'var(--accent)', strokeWidth: 2 }} />
            <rect x={-26} y={0} width={52} height={14} rx={3} style={{ fill: 'var(--accent)' }} />
            <text y={10.5} textAnchor="middle" fontSize={10} style={{ fill: 'var(--panel)', fontFamily: 'var(--font-mono)' }}>
              {fmt2(current.score)}
            </text>
          </g>
        </svg>
      )}
    </div>
  )
}
