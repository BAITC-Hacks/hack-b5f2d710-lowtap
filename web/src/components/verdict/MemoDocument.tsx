import { Fragment } from 'react'
import { verifyText, type VerifiedChip } from '../../lib/verify'
import type { AnalysisReport, Claim, Recommendation } from '../../types/api'

const SECTIONS: { key: keyof Pick<AnalysisReport, 'strengths' | 'risks' | 'consequences' | 'tradeoffs' | 'city_impact'>; title: string }[] = [
  { key: 'strengths', title: 'Сильные стороны' },
  { key: 'risks', title: 'Риски и побочные эффекты' },
  { key: 'consequences', title: 'Последствия' },
  { key: 'tradeoffs', title: 'Компромиссы' },
  { key: 'city_impact', title: 'Что это значит для города' },
]

/** Абзац с числами-чипами: подтверждённые движком — mono с подчёркиванием, прочие — пунктиром. */
export function ChipText({ text, numbers }: { text: string; numbers: readonly number[] }) {
  const chips = verifyText(text, numbers)
  const parts: (string | VerifiedChip)[] = []
  let at = 0
  for (const chip of chips) {
    parts.push(text.slice(at, chip.index), chip)
    at = chip.index + chip.raw.length
  }
  parts.push(text.slice(at))
  return (
    <>
      {parts.map((p, i) =>
        typeof p === 'string' ? (
          <Fragment key={i}>{p}</Fragment>
        ) : (
          <span
            key={i}
            className="num whitespace-nowrap text-[0.93em]"
            title={p.kind === 'unverified' ? 'число не найдено среди чисел движка' : p.kind === 'confirmed' ? 'подтверждено движком' : 'константа ТЗ'}
            style={{
              textDecorationLine: p.kind === 'constant' ? 'none' : 'underline',
              textDecorationStyle: p.kind === 'unverified' ? 'dashed' : 'solid',
              textDecorationColor: p.kind === 'unverified' ? 'var(--down)' : 'var(--accent)',
              textUnderlineOffset: '3px',
            }}
          >
            {p.raw}
          </span>
        ),
      )}
    </>
  )
}

interface Props {
  report: AnalysisReport
  numbers: readonly number[]
  scenarioId: string
  onApply?: (rec: Recommendation) => void
}

/** Записка акиму на «листе»: шапка, разделы капителью, абзацы с проверенными числами. */
export function MemoDocument({ report, numbers, scenarioId, onApply }: Props) {
  const date = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <article className="bg-paper px-8 py-7 text-[15px] leading-[1.55] text-paper-ink">
      <header className="mb-5 border-b border-line pb-3 text-[12px] leading-relaxed text-ink-2">
        <div>
          <b className="font-semibold text-paper-ink">Кому:</b> Акиму г. Астаны · <b className="font-semibold text-paper-ink">От:</b> Аналитический штаб
        </div>
        <div className="num">
          Сценарий #{scenarioId} · {date}
        </div>
      </header>

      <MemoSection title="Итог">
        <p>
          <ChipText text={report.summary} numbers={numbers} />
        </p>
      </MemoSection>

      {SECTIONS.map(({ key, title }) =>
        report[key].length ? (
          <MemoSection key={key} title={title}>
            <ClaimList claims={report[key]} numbers={numbers} />
          </MemoSection>
        ) : null,
      )}

      {report.recommendations.length > 0 && (
        <MemoSection title="Рекомендации">
          <ol className="flex flex-col gap-2">
            {report.recommendations.map((r, i) => (
              <li key={i} className="flex items-start gap-3 border-l-2 border-accent pl-3">
                <div className="flex-1">
                  <div className="font-medium">{r.change}</div>
                  <div className="text-[13px] text-ink-2">
                    <ChipText text={r.rationale} numbers={numbers} />
                    {!r.verified && r.invalid_reason && <span className="text-down"> · {r.invalid_reason}</span>}
                  </div>
                </div>
                {onApply && r.verified && (
                  <button
                    type="button"
                    onClick={() => onApply(r)}
                    className="mt-0.5 h-7 shrink-0 rounded-chip border border-accent px-2.5 text-[12px] font-medium text-accent hover:bg-accent hover:text-panel"
                  >
                    Применить
                  </button>
                )}
              </li>
            ))}
          </ol>
        </MemoSection>
      )}
    </article>
  )
}

function MemoSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 last:mb-0">
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-2">{title}</h3>
      {children}
    </section>
  )
}

function ClaimList({ claims, numbers }: { claims: Claim[]; numbers: readonly number[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {claims.map((c, i) => (
        <li key={i} className="relative pl-4 before:absolute before:left-0 before:top-[0.7em] before:h-px before:w-2 before:bg-ink-2">
          <ChipText text={c.text} numbers={numbers} />
        </li>
      ))}
    </ul>
  )
}
