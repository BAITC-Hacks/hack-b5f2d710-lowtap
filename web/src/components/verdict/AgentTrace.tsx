import { Check, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { TraceStep } from '../../types/api'

interface Props {
  steps: TraceStep[]
  running?: boolean
  /** Переключатель «офлайн-режим» (записка по шаблону, без сети) — ответ на «что если ключ отвалится». */
  offline?: boolean
  onOfflineChange?: (value: boolean) => void
}

/** Полоса трассы: шаги сервера (серые) и вызовы инструментов агентом (--accent) — только из реального trace[]. */
export function AgentTrace({ steps, running = false, offline, onOfflineChange }: Props) {
  return (
    <div className="flex min-h-9 shrink-0 items-center gap-3 border-b border-line bg-panel px-4 py-1.5">
      <ol className="num flex flex-1 flex-wrap items-center gap-x-1 gap-y-0.5 text-[11px]" aria-label="Трасса анализа" aria-live="polite">
        <AnimatePresence initial={false}>
          {steps.map((s, i) => (
            <motion.li
              key={`${s.n}-${s.tool}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-1"
              title={typeof s.input === 'object' && s.input ? JSON.stringify(s.input) : undefined}
            >
              {i > 0 && <span className="px-0.5 text-line">·</span>}
              <span style={{ color: s.kind === 'agent' ? 'var(--accent)' : 'var(--ink)' }}>{s.tool}</span>
              {s.ok ? <Check size={12} className="text-up" /> : <X size={12} className="text-down" />}
              <span className="text-ink-2">{s.output_summary}</span>
            </motion.li>
          ))}
        </AnimatePresence>
        {running && <li className="text-ink-2">{steps.length ? '· …' : 'агент получает факты движка …'}</li>}
      </ol>
      {onOfflineChange && (
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px] text-ink-2" title="Записка по шаблону на числах движка, без сети и LLM">
          <input type="checkbox" checked={offline} onChange={(e) => onOfflineChange(e.target.checked)} className="accent-[var(--accent)]" />
          офлайн-режим
        </label>
      )}
    </div>
  )
}
