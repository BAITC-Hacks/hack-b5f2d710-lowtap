import { scaleLinear } from 'd3-scale'
import { motion, useReducedMotion } from 'motion/react'
import { DISTRICTS } from '../../engine/catalog'
import { useSize } from '../../hooks/useSize'
import { fmt2 } from '../../lib/format'
import type { EvalResult } from '../../types/api'
import type { DistrictId } from '../../types/data'

/** D района до → после: толщина линии ∝ доле населения; самый выросший район — --accent. */
export function DistrictSlope({ result, highlight = null }: { result: EvalResult; highlight?: DistrictId | null }) {
  const [ref, { width, height }] = useSize<HTMLDivElement>()
  const reduced = useReducedMotion()
  const values = DISTRICTS.flatMap((d) => [result.districts[d.id].d_before, result.districts[d.id].d_after])
  const y = scaleLinear()
    .domain([Math.floor(Math.min(...values) - 0.5), Math.ceil(Math.max(...values) + 0.5)])
    .range([height - 14, 14])
  const leftX = 96
  const rightX = Math.max(leftX + 40, width - 150)
  const top = [...DISTRICTS].sort((a, b) => result.districts[b.id].delta - result.districts[a.id].delta)[0].id
  // Подписи справа разводим по вертикали, чтобы близкие значения не слипались.
  const labelY = spread(DISTRICTS.map((d) => ({ id: d.id, y: y(result.districts[d.id].d_after) })), 13)
  const labelYLeft = spread(DISTRICTS.map((d) => ({ id: d.id, y: y(result.districts[d.id].d_before) })), 13)

  return (
    <div ref={ref} className="relative h-full w-full">
      {width > 0 && height > 0 && (
        <svg width={width} height={height} aria-label="D районов до и после">
          <text x={leftX} y={10} textAnchor="middle" fontSize={9} style={{ fill: 'var(--ink-2)', fontFamily: 'var(--font-mono)' }}>
            Q0
          </text>
          <text x={rightX} y={10} textAnchor="middle" fontSize={9} style={{ fill: 'var(--ink-2)', fontFamily: 'var(--font-mono)' }}>
            Q8
          </text>
          {DISTRICTS.map((d) => {
            const r = result.districts[d.id]
            const accent = d.id === top
            const dim = highlight !== null && highlight !== d.id
            const color = accent || highlight === d.id ? 'var(--accent)' : 'var(--ink-2)'
            return (
              <g key={d.id} opacity={dim ? 0.3 : 1} style={{ transition: 'opacity 150ms var(--ease-data)' }}>
                <motion.line
                  x1={leftX}
                  y1={y(r.d_before)}
                  initial={reduced ? false : { x2: leftX, y2: y(r.d_before) }}
                  animate={{ x2: rightX, y2: y(r.d_after) }}
                  transition={{ duration: 0.3, delay: reduced ? 0 : 0.35, ease: [0.2, 0.8, 0.2, 1] }}
                  style={{ stroke: color, strokeWidth: 1 + d.pop_share * 14, strokeLinecap: 'round' }}
                />
                <text x={leftX - 8} y={labelYLeft[d.id] + 3.5} textAnchor="end" fontSize={10} style={{ fill: 'var(--ink-2)', fontFamily: 'var(--font-mono)' }}>
                  {fmt2(r.d_before)}
                </text>
                <text x={rightX + 8} y={labelY[d.id] + 3.5} fontSize={10} style={{ fill: accent ? 'var(--accent)' : 'var(--ink)', fontFamily: 'var(--font-mono)' }}>
                  {fmt2(r.d_after)}
                  <tspan dx={6} style={{ fontFamily: 'var(--font-sans)', fill: 'var(--ink-2)' }}>
                    {d.name_ru}
                  </tspan>
                </text>
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}

function spread(items: { id: DistrictId; y: number }[], gap: number): Record<DistrictId, number> {
  const sorted = [...items].sort((a, b) => a.y - b.y)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].y - sorted[i - 1].y < gap) sorted[i] = { ...sorted[i], y: sorted[i - 1].y + gap }
  }
  return Object.fromEntries(sorted.map((s) => [s.id, s.y])) as Record<DistrictId, number>
}
