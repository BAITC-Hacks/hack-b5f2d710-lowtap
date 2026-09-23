import { DISTRIBUTION, percentileOf } from '../../engine/distribution'
import { fmt2, fmtPct } from '../../lib/format'

/** Мини-гистограмма всех валидных наборов с маркером текущего Score (только для официального Score). */
export function Percentile({ score }: { score: number }) {
  const dist = DISTRIBUTION
  const pct = percentileOf(score)
  if (!dist || pct === null || !dist.bins.length) return null
  const lo = dist.bins[0].start
  const hi = dist.bins[dist.bins.length - 1].end
  const maxCount = Math.max(...dist.bins.map((b) => b.count))
  const W = 260
  const H = 32
  const x = (v: number) => ((v - lo) / (hi - lo)) * W

  return (
    <section>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: H, display: 'block' }} aria-hidden>
        {dist.bins.map((b) => (
          <rect
            key={b.start}
            x={x(b.start)}
            width={Math.max(0.5, x(b.end) - x(b.start) - 0.3)}
            y={H - (b.count / maxCount) * (H - 2)}
            height={(b.count / maxCount) * (H - 2)}
            style={{ fill: b.end <= score ? 'var(--ink-2)' : 'var(--line)' }}
          />
        ))}
        <line x1={x(score)} x2={x(score)} y1={0} y2={H} style={{ stroke: 'var(--accent)', strokeWidth: 2 }} />
      </svg>
      <p className="num mt-1 text-[10px] text-ink-2">
        лучше ≈{fmtPct(pct)} сценариев · макс {fmt2(dist.best)}
      </p>
    </section>
  )
}
