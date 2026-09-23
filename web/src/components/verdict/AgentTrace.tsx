import { Check, X } from 'lucide-react'
import type { TraceStep } from '../../types/api'

/** Полоса трассы: шаги движка (серые) и вызовы инструментов агентом (--accent), только из реального trace[]. */
export function AgentTrace({ steps }: { steps: TraceStep[] }) {
  if (!steps.length) return null
  return (
    <ol className="num flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-panel px-4 text-[11px]" aria-label="Трасса анализа">
      {steps.map((s, i) => (
        <li key={s.n} className="flex shrink-0 items-center gap-1">
          {i > 0 && <span className="px-1 text-line">·</span>}
          <span style={{ color: s.kind === 'agent' ? 'var(--accent)' : 'var(--ink)' }}>{s.tool}</span>
          {s.ok ? <Check size={12} className="text-up" /> : <X size={12} className="text-down" />}
          <span className="text-ink-2">{s.output_summary}</span>
        </li>
      ))}
    </ol>
  )
}
