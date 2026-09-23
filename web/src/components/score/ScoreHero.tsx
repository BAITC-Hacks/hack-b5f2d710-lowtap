import { motion, useReducedMotion, useSpring, useTransform } from 'motion/react'
import { useEffect } from 'react'
import { RULES } from '../../engine/catalog'
import type { ScoreStatus } from '../../hooks/useEvaluation'
import { fmt2, fmtSigned } from '../../lib/format'
import { signColor } from '../../lib/colors'

interface Props {
  score: number
  delta: number
  status: ScoreStatus
  count: number
  /** Набор из 5 мер, но с нарушением правил: число только предварительное. */
  invalidFull: boolean
  /** «Что если» при наведении: число рядом пунктиром, без анимации. */
  ghost?: { score: number; label: string } | null
}

/** Число Score докатывается spring'ом только при подтверждённом изменении набора. */
export function AnimatedNumber({
  value,
  from,
  className,
  style,
}: {
  value: number
  /** Досчитать от этого числа при появлении (Вердикт: от базы 52.56 до итога). */
  from?: number
  className?: string
  style?: React.CSSProperties
}) {
  const reduced = useReducedMotion()
  const spring = useSpring(from ?? value, { stiffness: 120, damping: 20 })
  const text = useTransform(spring, (v) => fmt2(v))
  useEffect(() => {
    if (reduced) spring.jump(value)
    else spring.set(value)
  }, [value, reduced, spring])
  return (
    <motion.span className={className} style={style}>
      {text}
    </motion.span>
  )
}

export function ScoreHero({ score, delta, status, count, invalidFull, ghost = null }: Props) {
  const official = status === 'official'
  const required = RULES.decisions_required
  const caption =
    status === 'base'
      ? `база · 0/${required}`
      : official
        ? 'Astana Quality of Life Score'
        : invalidFull
          ? `предварительно · правила нарушены`
          : `предварительно · ${count}/${required}`

  return (
    <section aria-live="polite">
      <h2 className="caps text-[10px]" style={{ color: invalidFull ? 'var(--down)' : undefined }}>
        {caption}
      </h2>
      <div className="mt-1.5 flex items-baseline gap-3">
        <AnimatedNumber
          value={score}
          className="font-display text-[clamp(44px,3.6vw,56px)] font-medium leading-none tracking-[-0.02em] tabular-nums"
          style={{
            color: official ? 'var(--ink)' : 'var(--ink-2)',
            textDecorationLine: official ? 'none' : 'underline',
            textDecorationStyle: 'dashed',
            textDecorationThickness: '1px',
            textUnderlineOffset: '7px',
          }}
        />
        {ghost ? (
          <span className="num flex flex-col text-[13px] leading-tight" title={`Что если: ${ghost.label}`}>
            <span className="border-b border-dashed border-accent text-accent">→ {fmt2(ghost.score)}</span>
            <span className="text-[10px]" style={{ color: signColor(ghost.score - score) }}>
              {fmtSigned(ghost.score - score)}
            </span>
          </span>
        ) : (
          status !== 'base' && (
            <span className="num rounded-chip px-1 text-[13px]" style={{ color: signColor(delta) }}>
              {fmtSigned(delta)}
            </span>
          )
        )}
      </div>
      {ghost && <p className="num mt-1 truncate text-[10px] text-accent">что если: {ghost.label}</p>}
      {!official && status !== 'base' && (
        <p className="mt-1.5 text-[10px] text-ink-2">Score по ТЗ считается только для набора из 5 решений по правилам.</p>
      )}
    </section>
  )
}
