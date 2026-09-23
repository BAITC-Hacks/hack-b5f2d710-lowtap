import { useEffect, useState } from 'react'
import type { EngineState } from '../engine/score'
import type { CriticalPair } from '../types/api'
import { DISTRICT_IDS, INDICATOR_CODES } from '../types/data'

export interface ClosedPair extends CriticalPair {
  /** Значение после снятия (≥ 40). */
  now: number
}

const SHOW_MS = 1500
const key = (p: CriticalPair) => `${p.district_id}.${p.indicator}`

/**
 * Критические пары, снятые последним изменением состояния (квартал таймлайна или новая мера):
 * на 1.5 с у района появляется подпись «S1 40.0 ✓» — без тостов и плашек по центру.
 */
export function useClosedPairs(state: EngineState): ClosedPair[] {
  const [prev, setPrev] = useState(state)
  const [closed, setClosed] = useState<ClosedPair[]>([])
  if (state !== prev) {
    const now = new Set(state.critical.map(key))
    const gone = prev.critical
      .filter((p) => !now.has(key(p)))
      .map((p) => ({ ...p, now: state.values[DISTRICT_IDS.indexOf(p.district_id)][INDICATOR_CODES.indexOf(p.indicator)] }))
    setPrev(state)
    if (gone.length) setClosed(gone)
  }
  useEffect(() => {
    if (!closed.length) return
    const t = setTimeout(() => setClosed([]), SHOW_MS)
    return () => clearTimeout(t)
  }, [closed])
  return closed
}

/** Предыдущее значение, если новое меньше, — держится 1.5 с для зачёркивания «− N_crit 2 → 1». */
export function useStruckPrevious(value: number): number | null {
  const [prev, setPrev] = useState(value)
  const [struck, setStruck] = useState<number | null>(null)
  if (value !== prev) {
    setStruck(value < prev ? prev : null)
    setPrev(value)
  }
  useEffect(() => {
    if (struck === null) return
    const t = setTimeout(() => setStruck(null), SHOW_MS)
    return () => clearTimeout(t)
  }, [struck])
  return struck
}
