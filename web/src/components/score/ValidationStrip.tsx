import { CHECKS, type CheckKey, type CheckStatus } from '../../engine/validate'
import type { Violation } from '../../types/api'

const COLOR: Record<CheckStatus, string> = { pending: 'var(--line)', ok: 'var(--up)', fail: 'var(--down)' }

/** Шесть маркеров правил ТЗ; текст причины — только при нарушении. */
export function ValidationStrip({ checks, violations }: { checks: Record<CheckKey, CheckStatus>; violations: Violation[] }) {
  const ok = CHECKS.filter((c) => checks[c.key] === 'ok').length
  const shown = violations.filter((v) => v.code !== 'NOT_FIVE')

  return (
    <section aria-label="Проверка правил">
      <div className="flex items-center gap-2">
        <h2 className="caps text-[10px]">Валидация</h2>
        <div className="flex gap-1">
          {CHECKS.map((c) => (
            <span
              key={c.key}
              title={`${c.label}: ${checks[c.key] === 'ok' ? 'ок' : checks[c.key] === 'fail' ? 'нарушено' : 'не проверено'}`}
              className="h-3 w-3 rounded-[2px]"
              style={{ background: COLOR[checks[c.key]], transition: 'background-color 150ms var(--ease-data)' }}
            />
          ))}
        </div>
        <span className="num ml-auto text-[11px]" style={{ color: ok === CHECKS.length ? 'var(--up)' : 'var(--ink-2)' }}>
          {ok}/{CHECKS.length}
        </span>
      </div>
      {shown.length > 0 && (
        <ul className="mt-1 flex flex-col gap-0.5 text-[11px] leading-snug text-down">
          {shown.map((v, i) => (
            <li key={i}>{v.message}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
