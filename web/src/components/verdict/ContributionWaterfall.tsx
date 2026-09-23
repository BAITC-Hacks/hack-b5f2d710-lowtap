import { scaleLinear } from 'd3-scale'
import { motion, useReducedMotion } from 'motion/react'
import { MEASURE_BY_ID, districtName } from '../../engine/catalog'
import { useSize } from '../../hooks/useSize'
import { DIRECTION_COLOR } from '../../lib/colors'
import { fmt2, fmtSigned } from '../../lib/format'
import type { Decision, EvalResult } from '../../types/api'

interface Props {
  result: EvalResult
  decisions: readonly Decision[]
  highlight?: string | null
}

/**
 * Вклады мер по Шепли в каноническом порядке M1..M14: база → столбик каждой меры → итог.
 * Синергии и снятие критических пар распределены между мерами — сумма сходится к Score точно.
 */
export function ContributionWaterfall({ result, decisions, highlight = null }: Props) {
  const [ref, { width, height }] = useSize<HTMLDivElement>()
  const reduced = useReducedMotion()
  const steps = result.waterfall
  const bars = steps.map((w, i) => {
    const from = result.baseline + steps.slice(0, i).reduce((sum, x) => sum + x.delta, 0)
    return { ...w, from, to: from + w.delta }
  })
  const values = [result.baseline, result.score, ...bars.flatMap((b) => [b.from, b.to])]
  const lo = Math.floor(Math.min(...values) - 0.5)
  const hi = Math.ceil(Math.max(...values) + 0.3)
  const top = 18
  const bottom = 30
  const y = scaleLinear().domain([lo, hi]).range([height - bottom, top])
  const n = bars.length + 2
  const left = 30
  const slot = (width - left) / n
  const barW = Math.min(46, slot * 0.62)
  const cx = (i: number) => left + slot * i + slot / 2

  return (
    <div ref={ref} className="relative h-full w-full">
      {width > 0 && height > 0 && (
        <svg width={width} height={height} aria-label="Вклад мер в Score (Шепли)">
          {[lo, (lo + hi) / 2, hi].map((v) => (
            <g key={v}>
              <line x1={left} x2={width} y1={y(v)} y2={y(v)} style={{ stroke: 'var(--line)', strokeDasharray: '2 3' }} />
              <text x={left - 4} y={y(v) + 3} textAnchor="end" fontSize={9} style={{ fill: 'var(--ink-2)', fontFamily: 'var(--font-mono)' }}>
                {v % 1 ? v.toFixed(1) : v}
              </text>
            </g>
          ))}
          <Total x={cx(0)} w={barW} y={y} value={result.baseline} label="база" />
          {bars.map((b, i) => {
            const measure = MEASURE_BY_ID.get(b.measure_id)
            const d = decisions.find((x) => x.measure_id === b.measure_id)
            const y0 = y(Math.max(b.from, b.to))
            const h = Math.max(1, Math.abs(y(b.from) - y(b.to)))
            const dim = highlight !== null && highlight !== b.measure_id
            return (
              <g key={b.measure_id} opacity={dim ? 0.35 : 1} style={{ transition: 'opacity 150ms var(--ease-data)' }}>
                <line x1={cx(i) + barW / 2} x2={cx(i + 1) - barW / 2} y1={y(b.from)} y2={y(b.from)} style={{ stroke: 'var(--ink-2)', strokeDasharray: '2 2' }} />
                <motion.rect
                  x={cx(i + 1) - barW / 2}
                  width={barW}
                  initial={reduced ? false : { y: y(b.from), height: 0 }}
                  animate={{ y: y0, height: h }}
                  transition={{ duration: 0.3, delay: reduced ? 0 : 0.06 * i, ease: [0.2, 0.8, 0.2, 1] }}
                  style={{
                    fill: b.delta < 0 ? 'var(--down)' : measure ? DIRECTION_COLOR[measure.direction] : 'var(--ink-2)',
                    stroke: highlight === b.measure_id ? 'var(--accent)' : 'none',
                    strokeWidth: 2,
                  }}
                />
                <text x={cx(i + 1)} y={y0 - 5} textAnchor="middle" fontSize={11} style={{ fill: b.delta < 0 ? 'var(--down)' : 'var(--ink)', fontFamily: 'var(--font-mono)' }}>
                  {fmtSigned(b.delta)}
                </text>
                <text x={cx(i + 1)} y={height - bottom + 13} textAnchor="middle" fontSize={10} style={{ fill: 'var(--ink)', fontFamily: 'var(--font-mono)' }}>
                  {b.measure_id}
                </text>
                <text x={cx(i + 1)} y={height - bottom + 25} textAnchor="middle" fontSize={9} style={{ fill: 'var(--ink-2)', fontFamily: 'var(--font-sans)' }}>
                  {districtName(d?.district ?? null)}
                </text>
              </g>
            )
          })}
          <line
            x1={cx(bars.length) + barW / 2}
            x2={cx(n - 1) - barW / 2}
            y1={y(result.score)}
            y2={y(result.score)}
            style={{ stroke: 'var(--ink-2)', strokeDasharray: '2 2' }}
          />
          <Total x={cx(n - 1)} w={barW} y={y} value={result.score} label="итог" strong />
        </svg>
      )}
    </div>
  )
}

function Total({ x, w, y, value, label, strong = false }: { x: number; w: number; y: (v: number) => number; value: number; label: string; strong?: boolean }) {
  return (
    <g>
      <line x1={x - w / 2} x2={x + w / 2} y1={y(value)} y2={y(value)} style={{ stroke: 'var(--ink)', strokeWidth: strong ? 3 : 1.5 }} />
      <text x={x} y={y(value) - 6} textAnchor="middle" fontSize={11} fontWeight={strong ? 600 : 400} style={{ fill: 'var(--ink)', fontFamily: 'var(--font-mono)' }}>
        {fmt2(value)}
      </text>
      <text x={x} textAnchor="middle" fontSize={10} style={{ fill: 'var(--ink-2)', fontFamily: 'var(--font-sans)' }} y={y(value) + 14}>
        {label}
      </text>
    </g>
  )
}
