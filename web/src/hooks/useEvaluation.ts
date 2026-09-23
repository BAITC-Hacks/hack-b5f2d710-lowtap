import { useMemo } from 'react'
import { RULES } from '../engine/catalog'
import { computeState } from '../engine/score'
import { checklist, decisionsCost, validateDecisions } from '../engine/validate'
import { useScenario } from '../store/scenario'

/**
 * base — пустой набор (база ТЗ); preliminary — набор не прошёл валидатор, число подписано
 * «предварительно»; official — 6/6 правил, это Score по ТЗ.
 */
export type ScoreStatus = 'base' | 'preliminary' | 'official'

/** Текущий набор, посчитанный локальным движком (<1 мс, пересчёт на каждое изменение). */
export function useEvaluation() {
  const decisions = useScenario((s) => s.decisions)
  return useMemo(() => {
    const state = computeState(decisions)
    const violations = validateDecisions(decisions)
    const cost = decisionsCost(decisions)
    const status: ScoreStatus = decisions.length === 0 ? 'base' : violations.length === 0 ? 'official' : 'preliminary'
    return {
      decisions,
      state,
      violations,
      checks: checklist(decisions, violations),
      cost,
      remaining: RULES.budget - cost,
      status,
    }
  }, [decisions])
}
