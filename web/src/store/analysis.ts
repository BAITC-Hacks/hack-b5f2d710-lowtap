// Результат «Рассчитать» / «AI-анализ»: EvalResult + записка + трасса.
// Этап F1 — всё локально (движок + шаблон); сервер и SSE подключаются на этапе F2.

import { create } from 'zustand'
import { buildTemplateReport } from '../components/verdict/MemoTemplate'
import { evaluateLocal } from '../engine/evaluate'
import { canonicalScenario } from '../engine/hash'
import type { AnalysisReport, Decision, EvalResult, Violation } from '../types/api'

export type AnalysisMode = 'calc' | 'ai'
export type ReportSource = 'template' | 'rules' | 'llm' | 'cache'

interface AnalysisState {
  open: boolean
  mode: AnalysisMode
  /** Канонический набор, для которого посчитан отчёт (изменили набор — отчёт устарел). */
  key: string | null
  result: EvalResult | null
  report: AnalysisReport | null
  source: ReportSource
  violations: Violation[]

  run: (mode: AnalysisMode, decisions: Decision[]) => void
  close: () => void
}

export const useAnalysis = create<AnalysisState>()((set) => ({
  open: false,
  mode: 'calc',
  key: null,
  result: null,
  report: null,
  source: 'template',
  violations: [],

  run: (mode, decisions) => {
    const outcome = evaluateLocal(decisions)
    if (!outcome.ok) {
      set({ open: false, violations: outcome.violations, result: null, report: null, key: null })
      return
    }
    set({
      open: true,
      mode,
      key: canonicalScenario(decisions),
      result: outcome.data,
      report: buildTemplateReport(outcome.data, decisions),
      source: 'template',
      violations: [],
    })
  },
  close: () => set({ open: false }),
}))
