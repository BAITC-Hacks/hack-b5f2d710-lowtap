import { MINUS } from '../../lib/format'
import type { Measure } from '../../types/data'

/** Полные эффекты меры «S1 +16» (до учёта лага). */
export function EffectChips({ effects }: { effects: Measure['effects'] }) {
  return (
    <span className="flex min-w-0 gap-1 overflow-hidden">
      {Object.entries(effects).map(([code, value]) => (
        <span
          key={code}
          className="num whitespace-nowrap text-[10px]"
          style={{ color: value! < 0 ? 'var(--down)' : 'var(--ink)' }}
        >
          {code} {value! < 0 ? `${MINUS}${-value!}` : `+${value}`}
        </span>
      ))}
    </span>
  )
}
