import { Check, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { districtName } from '../../engine/catalog'
import { useUi } from '../../store/ui'
import type { BlockReason } from '../../engine/validate'
import { DIRECTION_COLOR } from '../../lib/colors'
import type { Decision } from '../../types/api'
import type { Measure } from '../../types/data'
import { EffectChips } from './EffectChips'
import { LagStrip } from './LagStrip'

export type CardState = 'default' | 'placing' | 'placed' | 'blocked'

interface Props {
  measure: Measure
  state: CardState
  placed: Decision | null
  blocked: BlockReason | null
  /** Подсказка «→ Нура»: куда встанет районная мера при клике (выбран район на карте). */
  target: string | null
  onActivate: () => void
  onRemove: () => void
  onHover: (hovered: boolean) => void
}

/** Строка каталога 44px; на hover и в режиме постановки раскрывается до 68px с лагом и эффектами. */
export function MeasureCard({ measure, state, placed, blocked, target, onActivate, onRemove, onHover }: Props) {
  const [hover, setHover] = useState(false)
  const lang = useUi((s) => s.lang)
  const expanded = hover || state === 'placing'
  const dim = state === 'blocked'

  let subline: { text: string; color: string } | null = null
  // «5/5» — состояние всего набора, его карточка объясняет при наведении; остальные причины видны всегда.
  if (state === 'blocked' && blocked && (blocked.kind !== 'full' || hover)) subline = { text: blocked.text, color: 'var(--down)' }
  else if (state === 'placing') subline = { text: 'выберите район на карте · Esc', color: 'var(--accent)' }
  else if (placed) subline = { text: `→ ${districtName(placed.district, lang)}`, color: 'var(--accent)' }
  else if (target && measure.type === 'district') subline = { text: `клик → ${target}`, color: 'var(--ink-2)' }

  return (
    <motion.div
      layout="position"
      className="group relative border-b border-line last:border-b-0"
      onMouseEnter={() => {
        setHover(true)
        onHover(true)
      }}
      onMouseLeave={() => {
        setHover(false)
        onHover(false)
      }}
    >
      <motion.button
        layout
        type="button"
        onClick={onActivate}
        aria-disabled={state === 'blocked'}
        aria-pressed={state === 'placing'}
        title={blocked?.text ?? measure.name_ru}
        transition={{ duration: 0.15, ease: [0.2, 0.8, 0.2, 1] }}
        className="flex w-full items-stretch text-left outline-offset-[-2px]"
        style={{
          height: expanded ? 'auto' : 44,
          minHeight: expanded ? 68 : 44,
          cursor: state === 'blocked' ? 'not-allowed' : 'pointer',
          background: state === 'placing' ? 'color-mix(in srgb, var(--accent) 6%, var(--panel))' : 'var(--panel)',
          boxShadow: state === 'placing' ? 'inset 0 0 0 1px var(--accent)' : undefined,
        }}
      >
        <span className="w-[3px] shrink-0" style={{ background: DIRECTION_COLOR[measure.direction], opacity: dim ? 0.4 : 1 }} />
        <span className="flex min-w-0 flex-1 flex-col justify-center gap-1 py-1.5 pl-2.5 pr-2">
          <span className="flex items-baseline gap-2" style={{ opacity: dim ? 0.45 : placed ? 0.7 : 1 }}>
            <span className="num w-7 shrink-0 text-[11px] text-ink-2">{measure.id}</span>
            <span className={`text-[12px] leading-tight text-ink ${expanded ? 'line-clamp-2' : 'truncate'}`}>{measure.name_ru}</span>
          </span>
          {subline && (
            <span className="truncate pl-9 text-[10px] leading-none" style={{ color: subline.color }}>
              {subline.text}
            </span>
          )}
          {expanded && (
            <span className="flex items-center gap-2 pl-9">
              <LagStrip lag={measure.lag} />
              <EffectChips effects={measure.effects} />
            </span>
          )}
        </span>
        <span className="flex w-11 shrink-0 flex-col items-end justify-center gap-0.5 pr-3" style={{ opacity: dim ? 0.45 : 1 }}>
          {placed ? (
            <Check size={14} className="text-up" aria-label="поставлена" />
          ) : (
            <span className="num text-[13px] text-gold">{measure.cost}</span>
          )}
          <span className="caps text-[9px] tracking-[0.06em]">{measure.type === 'city' ? 'Г' : 'Р'}</span>
        </span>
      </motion.button>
      {placed && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Снять ${measure.id}`}
          className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded-chip text-ink-2 hover:text-down group-hover:flex"
        >
          <X size={14} />
        </button>
      )}
    </motion.div>
  )
}
