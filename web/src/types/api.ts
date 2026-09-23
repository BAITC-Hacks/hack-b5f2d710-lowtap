// Контракт с бэкендом (docs/ARCHITECTURE.md, «API и объяснения»), описан вручную.
// Когда бэкенд поднимет /api/openapi.json, эти типы заменяются сгенерированными:
//   npm run gen:api   (openapi-typescript → src/types/api.gen.ts)

import type { District, DistrictId, IndicatorCode, Measure, Rules } from './data'

export interface Decision {
  measure_id: string
  /** Для мер type=city — null (ТЗ: «для «Город» не указывается»). */
  district: string | null
}

export interface Scenario {
  decisions: Decision[]
}

export const VIOLATION_CODES = [
  'NOT_FIVE',
  'DUPLICATE',
  'UNKNOWN_MEASURE',
  'UNKNOWN_DISTRICT',
  'DISTRICT_REQUIRED',
  'DISTRICT_FORBIDDEN',
  'DIRECTION_LIMIT',
  'INCOMPATIBLE_M1_M3',
  'CONFLICT_M4_M7',
  'CONFLICT_M5_M13',
  'BUDGET_EXCEEDED',
  'BAD_REQUEST',
] as const
export type ViolationCode = (typeof VIOLATION_CODES)[number]

export interface Violation {
  code: ViolationCode
  message: string
  decision_idx: number | null
  measures: string[]
}

/** POST /api/validate — 200 при структурно корректном JSON. */
export interface ValidateResponse {
  ok: boolean
  violations: Violation[]
}

/** 422 от /api/evaluate и /api/analyze: Score не считается, валидатор возвращает причину. */
export interface InvalidResponse {
  ok: false
  violations: Violation[]
}

export interface CriticalPair {
  district_id: DistrictId
  indicator: IndicatorCode
  value: number
}

export interface DistrictResult {
  d_before: number
  d_after: number
  delta: number
  /** Показатели T1..C2 по кодам (так отдаёт бэкенд). */
  indicators_before: Record<IndicatorCode, number>
  indicators_after: Record<IndicatorCode, number>
  deltas: Record<IndicatorCode, number>
}

/** Три карточки формулы: 0.7·D_avg + 0.3·min D − N_crit, текущие и базовые. */
export interface Components {
  d_avg_term: number
  min_term: number
  crit_term: number
  d_avg_term_base: number
  min_term_base: number
  crit_term_base: number
}

export interface Contribution {
  shapley: number
  loo: number
  per_unit: number
}

export interface WaterfallItem {
  /** Название меры (name_ru). */
  label: string
  measure_id: string
  delta: number
}

export interface SynergyTriggered {
  pair: [string, string]
  district_id: DistrictId
  indicator: IndicatorCode
  bonus: number
}

export interface TimelinePoint {
  q: number
  score: number
  n_crit: number
  d: Record<DistrictId, number>
}

export interface EvalResult {
  ok: true
  scenario_id: string
  score: number
  baseline: number
  delta: number
  percentile: number | null
  cost: number
  remaining: number
  d_avg: number
  min_district: { id: DistrictId; name_ru: string; d: number }
  n_crit: number
  components: Components
  critical_pairs: {
    before: CriticalPair[]
    after: CriticalPair[]
    closed: CriticalPair[]
    new: CriticalPair[]
  }
  districts: Record<DistrictId, DistrictResult>
  contributions: Record<string, Contribution>
  waterfall: WaterfallItem[]
  synergies_triggered: SynergyTriggered[]
  timeline: TimelinePoint[]
  data_hash: string
  engine_version: string
}

export interface Fact {
  id: string
  key: string
  value: number | string
  text_ru: string
}

export interface Claim {
  text: string
  /** Ссылки на факты F1..Fn. */
  evidence: string[]
}

export interface Recommendation {
  change: string
  decisions: Decision[]
  rationale: string
  score: number | null
  delta: number | null
  cost: number | null
  verified: boolean
  invalid_reason: string | null
}

export interface TraceStep {
  n: number
  kind: 'server' | 'agent'
  tool: string
  input: unknown
  output_summary: string
  ms: number
  ok: boolean
}

export type Provider = 'llm' | 'cache' | 'rules' | `rules(fallback:${string})`

export interface VerifiedNumbers {
  total: number
  confirmed: number
  unverified: string[]
}

export interface AnalysisReport {
  summary: string
  strengths: Claim[]
  risks: Claim[]
  consequences: Claim[]
  tradeoffs: Claim[]
  city_impact: Claim[]
  recommendations: Recommendation[]
  provider: Provider
  model: string | null
  prompt_version: string
  trace: TraceStep[]
  verified_numbers: VerifiedNumbers
  cached: boolean
}

export interface Health {
  status: string
  provider: 'llm' | 'rules'
  ai_cache: 'first' | 'fallback' | '0'
  model: string | null
  model_fast: string | null
  has_key: boolean
  model_status: 'ok' | 'not_in_list' | 'unchecked'
  data_hash: string
  version: string
}

export interface DistributionBin {
  start: number
  end: number
  count: number
}

export interface TopPlan {
  score: number
  cost: number
  n_crit: number
  scenario_id: string
  decisions: Decision[]
}

/** data/plan_distribution.json и /api/config.distribution. */
export interface Distribution {
  count: number
  worse_than_baseline: number
  baseline: number
  best: number
  worst: number
  quantiles: number[]
  bins: DistributionBin[]
  top20: TopPlan[]
}

/** Выжимка распределения для бандла (vite.config.ts → virtual:plan-distribution). */
export interface ClientDistribution extends Omit<Distribution, 'quantiles'> {
  data_hash: string
  /** cum[i] — число планов со Score < start + i·step. */
  fine: { start: number; step: number; cum: number[] }
}

export interface ApiConfig {
  districts: District[]
  measures: Measure[]
  rules: Rules
  baseline: number
  distribution: Distribution
  data_hash: string
}

/** События SSE /api/analyze?stream=1. */
export type AnalyzeEvent =
  | { event: 'trace'; data: TraceStep }
  | { event: 'report'; data: AnalysisReport }
  | { event: 'done'; data: unknown }
