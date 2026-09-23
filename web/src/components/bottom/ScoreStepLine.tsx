import { curveStepAfter, line } from 'd3-shape'
import { scaleLinear } from 'd3-scale'
import { fmt2 } from '../../lib/format'
import { useSize } from '../../hooks/useSize'
import type { TimelinePoint } from '../../types/api'

const DOMAIN: [number, number] = [50, 58]

/** Ступенчатая линия Score(q) по 8 кварталам; домен 50–58 фиксирован. */
export function ScoreStepLine({ points, quarter }: { points: TimelinePoint[]; quarter?: number }) {
  const [ref, { width, height }] = useSize<HTMLDivElement>()
  const left = 28
  const right = 44
  const x = scaleLinear().domain([0, 8]).range([left, Math.max(left + 1, width - right)])
  const y = scaleLinear().domain(DOMAIN).range([height - 16, 6]).clamp(true)
  // Шаг держится до следующего квартала: добавляем точку q=8 ещё раз, чтобы последняя ступень была видна.
  const path = line<TimelinePoint>()
    .x((p) => x(p.q))
    .y((p) => y(p.score))
    .curve(curveStepAfter)(points)

  return (
    <div ref={ref} className="relative h-full w-full">
      {width > 0 && (
        <svg width={width} height={height} aria-label="Score по кварталам">
          {[50, 54, 58].map((v) => (
            <g key={v}>
              <line x1={left} x2={width - right} y1={y(v)} y2={y(v)} style={{ stroke: 'var(--line)', strokeDasharray: v === 54 ? '2 3' : undefined }} />
              <text x={left - 6} y={y(v) + 3} textAnchor="end" fontSize={9} style={{ fill: 'var(--ink-2)', fontFamily: 'var(--font-mono)' }}>
                {v}
              </text>
            </g>
          ))}
          {points.map((p) => (
            <text key={p.q} x={x(p.q)} y={height - 3} textAnchor="middle" fontSize={9} style={{ fill: p.q === quarter ? 'var(--accent)' : 'var(--ink-2)', fontFamily: 'var(--font-mono)' }}>
              Q{p.q}
            </text>
          ))}
          {path && <path d={path} style={{ fill: 'none', stroke: 'var(--ink)', strokeWidth: 1.5 }} />}
          {points.map((p) => (
            <circle key={p.q} cx={x(p.q)} cy={y(p.score)} r={2.5} style={{ fill: 'var(--panel)', stroke: 'var(--ink)', strokeWidth: 1.2 }} />
          ))}
          {[points[0], points[points.length - 1]].map((p) => (
            <text
              key={p.q}
              x={x(p.q) + (p.q === 0 ? 6 : 6)}
              y={y(p.score) - 6}
              fontSize={10}
              style={{ fill: 'var(--ink)', fontFamily: 'var(--font-mono)' }}
            >
              {fmt2(p.score)}
            </text>
          ))}
        </svg>
      )}
    </div>
  )
}
