import { RULES } from '../../engine/catalog'

/** 8 сегментов горизонта: первые L — лаг (серые), остальные — реализованный эффект. */
export function LagStrip({ lag }: { lag: number }) {
  const h = RULES.horizon_quarters
  const share = Math.round(((h - lag) / h) * 1000) / 10
  return (
    <span className="flex items-center gap-1.5" title={`Лаг ${lag} кв.: реализуется ${share}% эффекта за ${h} кварталов`}>
      <span className="flex gap-px">
        {Array.from({ length: h }, (_, i) => (
          <span key={i} className="h-[3px] w-[6px]" style={{ background: i < lag ? 'var(--ink-2)' : 'var(--accent)' }} />
        ))}
      </span>
      <span className="num whitespace-nowrap text-[10px] text-ink-2">
        лаг {lag} · {share}%
      </span>
    </span>
  )
}
