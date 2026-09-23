// «Рассчитать» и «AI-анализ». Сразу — локальный движок и записка по шаблону (0 мс, работает офлайн),
// затем, если бэкенд доступен: «Рассчитать» → /api/analyze?provider=rules, «AI-анализ» →
// /api/analyze?stream=1 (трасса приходит по SSE, записка — после guard). Нет бэкенда — остаётся шаблон.

import { create } from 'zustand'
import { buildTemplateReport } from '../components/verdict/MemoTemplate'
import { evaluateLocal } from '../engine/evaluate'
import { canonicalScenario } from '../engine/hash'
import { OfflineError, analyze, analyzeStream, evaluate } from '../lib/api'
import type { AnalysisReport, Decision, EvalResult, TraceStep, Violation } from '../types/api'
import { useUi } from './ui'

export type AnalysisMode = 'calc' | 'ai'
export type AnalysisStatus = 'idle' | 'running' | 'done'

interface AnalysisState {
  mode: AnalysisMode
  status: AnalysisStatus
  /** Канонический набор, для которого посчитан отчёт (изменили набор — отчёт устарел). */
  key: string | null
  decisions: Decision[]
  result: EvalResult | null
  report: AnalysisReport | null
  /** Шаги трассы по мере поступления (SSE); после отчёта — report.trace. */
  trace: TraceStep[]
  /** true — записка по шаблону на клиенте (бэкенд недоступен или офлайн-режим включён). */
  template: boolean
  /** Переключатель «офлайн-режим» на полосе трассы: только шаблон, без сети. */
  forceOffline: boolean
  violations: Violation[]

  run: (mode: AnalysisMode, decisions: Decision[]) => Promise<void>
  setForceOffline: (value: boolean) => void
}

let runId = 0

export const useAnalysis = create<AnalysisState>()((set, get) => ({
  mode: 'calc',
  status: 'idle',
  key: null,
  decisions: [],
  result: null,
  report: null,
  trace: [],
  template: true,
  forceOffline: false,
  violations: [],

  run: async (mode, decisions) => {
    const outcome = evaluateLocal(decisions)
    if (!outcome.ok) {
      set({ violations: outcome.violations })
      return
    }
    const id = ++runId
    const local = buildTemplateReport(outcome.data, decisions)
    set({
      mode,
      status: 'running',
      key: canonicalScenario(decisions),
      decisions,
      result: outcome.data,
      report: local,
      trace: mode === 'ai' ? [] : local.trace,
      template: true,
      violations: [],
    })
    useUi.getState().setScreen('verdict')

    const current = () => id === runId
    const finish = (patch: Partial<AnalysisState> = {}) => current() && set({ status: 'done', ...patch })
    if (get().forceOffline) {
      finish({ trace: local.trace })
      return
    }

    const scenario = { decisions }
    // Официальный Score и точный перцентиль — с сервера; расхождение с локальным движком — в консоль.
    void evaluate<EvalResult>(scenario)
      .then((server) => {
        if (!current() || !server.ok) return
        if (import.meta.env.DEV && Math.abs(server.data.score - outcome.data.score) > 1e-6) {
          console.warn('Score расходится: сервер', server.data.score, 'локально', outcome.data.score)
        }
        set({ result: server.data })
      })
      .catch(() => undefined)

    try {
      const response =
        mode === 'ai'
          ? await analyzeStream(scenario, { onTrace: (step) => current() && set({ trace: [...get().trace, step] }) })
          : await analyze(scenario, 'rules')
      if (!response.ok) {
        finish({ violations: response.violations, trace: local.trace })
        return
      }
      finish({ report: response.data, trace: response.data.trace, template: false })
    } catch (err) {
      if (!(err instanceof OfflineError)) console.error(err)
      finish({ trace: local.trace })
    }
  },
  setForceOffline: (forceOffline) => set({ forceOffline }),
}))
