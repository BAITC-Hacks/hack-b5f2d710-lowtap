import { DISTRICTS, RULES } from '../../engine/catalog'
import type { EngineState } from '../../engine/score'
import { MAP_DOMAIN, signColor } from '../../lib/colors'
import { fmt1, fmtShare, fmtSigned } from '../../lib/format'
import { DISTRICT_IDS } from '../../types/data'

const BAR = 60

/** Пять районов по доле населения: pop, bullet-bar D (40–80, тик базы), дельта и крит-пары прямо в строке. */
export function DistrictRows({ state, base }: { state: EngineState; base: EngineState }) {
  const rows = [...DISTRICTS].sort((a, b) => b.pop_share - a.pop_share)
  const x = (v: number) => (Math.min(Math.max(v, MAP_DOMAIN[0]), MAP_DOMAIN[1]) - MAP_DOMAIN[0]) / (MAP_DOMAIN[1] - MAP_DOMAIN[0]) * BAR

  return (
    <section aria-label="Районы">
      <h2 className="caps mb-1 text-[10px]">Районы · D</h2>
      {rows.map((d) => {
        const i = DISTRICT_IDS.indexOf(d.id)
        const delta = state.d[i] - base.d[i]
        const critBefore = base.critical.filter((p) => p.district_id === d.id)
        const critNow = state.critical.filter((p) => p.district_id === d.id)
        const closed = critBefore.filter((p) => !critNow.some((q) => q.indicator === p.indicator))
        return (
          <div key={d.id} className="flex h-[22px] items-center gap-1.5 text-[11px]">
            <span className="w-[60px] truncate">{d.name_ru}</span>
            <span className="num flex w-[26px] flex-col text-[9px] leading-none text-ink-2" title="доля населения — вес района в D_avg">
              {fmtShare(d.pop_share)}
              <span className="mt-0.5 h-[2px] bg-line" style={{ width: `${d.pop_share * 100}%` }} />
            </span>
            <svg width={BAR} height={8} aria-hidden className="shrink-0">
              <rect width={BAR} height={8} y={0} style={{ fill: 'var(--bg)' }} />
              <rect width={x(state.d[i])} height={4} y={2} style={{ fill: 'var(--accent)', transition: 'width 300ms var(--ease-data)' }} />
              <line x1={x(base.d[i])} x2={x(base.d[i])} y1={0} y2={8} style={{ stroke: 'var(--ink)', strokeWidth: 1 }} />
            </svg>
            <span className="num w-[36px] text-right text-[11px]" style={{ color: signColor(delta) }}>
              {Math.abs(delta) < 0.005 ? '·' : fmtSigned(delta)}
            </span>
            <span className="num flex flex-1 justify-end gap-1 whitespace-nowrap text-[9px]">
              {critNow.map((p) => (
                <span key={p.indicator} className="text-down" title={`${p.indicator} ${fmt1(p.value)} < ${RULES.critical_threshold}`}>
                  {p.indicator} {Number.isInteger(p.value) ? p.value : fmt1(p.value)}
                </span>
              ))}
              {closed.map((p) => (
                <span key={p.indicator} className="text-up line-through" title={`${p.indicator}: критическая пара снята`}>
                  {p.indicator}
                </span>
              ))}
            </span>
          </div>
        )
      })}
    </section>
  )
}
