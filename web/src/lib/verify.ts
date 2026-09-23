// Проверка чисел записки против чисел движка (тот же принцип, что guard бэкенда):
// десятичные числа из текста сверяются с множеством чисел EvalResult с допуском ±0.005;
// константы ТЗ (0.7, 0.3, веса, доли населения, доли эффекта) — whitelist, в счётчике не участвуют.

import { DISTRICTS, MEASURES, RULES } from '../engine/catalog'
import type { EvalResult, Recommendation } from '../types/api'
import { extractDecimals, type DecimalMatch } from './format'

const TOLERANCE = 0.005 + 1e-9

const CONSTANTS: number[] = [
  RULES.score.d_avg_weight,
  RULES.score.min_weight,
  RULES.score.crit_penalty,
  RULES.score.baseline,
  ...RULES.indicators.map((i) => i.weight),
  ...RULES.directions.map((d) => d.weight),
  ...DISTRICTS.map((d) => d.pop_share),
  ...MEASURES.map((m) => ((RULES.horizon_quarters - m.lag) / RULES.horizon_quarters) * 100),
]

const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE

/** Все числа, которые движок «знает» о сценарии (со знаком). */
export function engineNumbers(result: EvalResult, recommendations: Recommendation[] = []): number[] {
  const out: number[] = [result.score, result.baseline, result.delta, result.d_avg, result.min_district.d]
  if (result.percentile !== null) out.push(result.percentile, 100 - result.percentile)
  const c = result.components
  out.push(c.d_avg_term, c.min_term, c.crit_term, c.d_avg_term_base, c.min_term_base, c.crit_term_base)
  for (const d of Object.values(result.districts)) {
    out.push(d.d_before, d.d_after, d.delta, ...Object.values(d.indicators_before), ...Object.values(d.indicators_after), ...Object.values(d.deltas))
  }
  for (const x of Object.values(result.contributions)) out.push(x.shapley, x.loo, -x.loo, x.per_unit, result.score - x.loo)
  for (const p of [...result.critical_pairs.before, ...result.critical_pairs.after]) out.push(p.value)
  for (const t of result.timeline) out.push(t.score, ...Object.values(t.d))
  for (const r of recommendations) if (r.score !== null && r.delta !== null) out.push(r.score, r.delta)
  return out
}

export type ChipKind = 'confirmed' | 'unverified' | 'constant'

export interface VerifiedChip extends DecimalMatch {
  kind: ChipKind
}

export function verifyText(text: string, numbers: readonly number[]): VerifiedChip[] {
  return extractDecimals(text).map((m) => {
    // Положительное число в тексте может быть модулем дельты («снижение на 0.87»), отрицательное — только со знаком.
    const kind: ChipKind = numbers.some((v) => near(v, m.value) || (m.value >= 0 && near(Math.abs(v), m.value)))
      ? 'confirmed'
      : CONSTANTS.some((v) => near(v, Math.abs(m.value)))
        ? 'constant'
        : 'unverified'
    return { ...m, kind }
  })
}

export interface VerifiedCount {
  total: number
  confirmed: number
  unverified: string[]
}

export function verifyTexts(texts: readonly string[], numbers: readonly number[]): VerifiedCount {
  const chips = texts.flatMap((t) => verifyText(t, numbers)).filter((c) => c.kind !== 'constant')
  return {
    total: chips.length,
    confirmed: chips.filter((c) => c.kind === 'confirmed').length,
    unverified: chips.filter((c) => c.kind === 'unverified').map((c) => c.raw),
  }
}
