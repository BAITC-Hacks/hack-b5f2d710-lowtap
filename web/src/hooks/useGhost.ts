import { useEffect, useMemo, useState } from 'react'
import { MEASURE_BY_ID, districtName } from '../engine/catalog'
import { computeState, type EngineState } from '../engine/score'
import { blockReason } from '../engine/validate'
import { whatIf, withDecision } from '../engine/whatif'
import { useScenario } from '../store/scenario'
import { useUi, type Ghost } from '../store/ui'
import type { Decision } from '../types/api'

export interface GhostPreview {
  decisions: Decision[]
  state: EngineState
  /** «M3 → Нура (лучший)» — что именно примеряется. */
  label: string
}

/** Задержка перед превью: мышь, пролетающая над каталогом, не дёргает карту. */
const DEBOUNCE_MS = 60

/** Значение «устоялось» ms миллисекунд — иначе null. Сброс превью мгновенный, появление — с задержкой. */
function useSettled<T>(value: T | null, ms: number): T | null {
  const [settled, setSettled] = useState<T | null>(null)
  useEffect(() => {
    if (value === null) return
    const t = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return settled === value ? value : null
}

/**
 * «Что если» при наведении: мера из каталога (в выбранный район, иначе — в лучший),
 * район в режиме постановки. Считается локальным движком за доли миллисекунды.
 */
export function useGhost(): GhostPreview | null {
  const ghost = useSettled<Ghost>(
    useUi((s) => s.ghost),
    DEBOUNCE_MS,
  )
  const decisions = useScenario((s) => s.decisions)

  return useMemo(() => {
    if (!ghost) return null
    const measure = MEASURE_BY_ID.get(ghost.measureId)
    if (!measure) return null
    const placed = decisions.some((d) => d.measure_id === measure.id)
    if (!placed && blockReason(decisions, measure.id)) return null

    let district = ghost.district
    let best = false
    if (measure.type === 'district' && !district) {
      const top = whatIf(decisions, measure.id).find((o) => o.best) ?? whatIf(decisions, measure.id).find((o) => !o.blocked)
      if (!top?.district) return null
      district = top.district
      best = true
    }
    if (placed && decisions.find((d) => d.measure_id === measure.id)?.district === district) return null
    const next = withDecision(decisions, measure.id, measure.type === 'city' ? null : district)
    return {
      decisions: next,
      state: computeState(next),
      label: `${measure.id} → ${districtName(measure.type === 'city' ? null : district)}${best ? ' (лучший)' : ''}`,
    }
  }, [ghost, decisions])
}
