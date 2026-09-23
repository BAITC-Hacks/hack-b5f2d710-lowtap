import type { VerifiedNumbers } from '../../types/api'

/** «11/11 чисел подтверждены движком» — или сколько не подтверждено. */
export function VerifiedBadge({ verified }: { verified: VerifiedNumbers }) {
  const all = verified.confirmed === verified.total
  return (
    <span
      className="num rounded-chip px-1.5 py-0.5 text-[10px] font-medium"
      title={all ? 'Каждое десятичное число записки найдено среди чисел движка' : `Не подтверждены: ${verified.unverified.join(', ')}`}
      style={{
        color: all ? 'var(--up)' : 'var(--down)',
        border: `1px ${all ? 'solid' : 'dashed'} currentColor`,
      }}
    >
      {all
        ? `${verified.confirmed}/${verified.total} чисел подтверждены движком`
        : `${verified.confirmed}/${verified.total} · ${verified.total - verified.confirmed} не подтверждено`}
    </span>
  )
}
