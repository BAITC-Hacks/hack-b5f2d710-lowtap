import { useMemo } from 'react'
import { computeState, type EngineState } from '../engine/score'
import { HORIZON, useUi } from '../store/ui'
import { useEvaluation } from './useEvaluation'

/**
 * Что показывает Пульт: итог по формуле ТЗ (Q8) или промежуточный квартал q
 * (эффект × max(0, q − L)/8) — при проигрывании и перетаскивании скраббера.
 */
export function useDisplayState(): { display: EngineState; quarter: number; intermediate: boolean } {
  const { state, decisions } = useEvaluation()
  const quarter = useUi((s) => s.quarter)
  const display = useMemo(() => (quarter >= HORIZON ? state : computeState(decisions, { quarter })), [state, decisions, quarter])
  return { display, quarter, intermediate: quarter < HORIZON }
}
