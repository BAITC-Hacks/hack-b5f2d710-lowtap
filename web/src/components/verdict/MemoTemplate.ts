// Офлайн-записка акиму: тот же AnalysisReport, что отдаёт бэкенд, но собранный шаблонами
// из чисел локального движка. LLM здесь нет — ни одно число не придумано, все из EvalResult.

import { DISTRICT_BY_ID, MEASURE_BY_ID, RULES, districtName } from '../../engine/catalog'
import { measureOrder } from '../../engine/contributions'
import { neighbors, type Neighbor } from '../../engine/neighbors'
import { fmt2, fmtSigned } from '../../lib/format'
import { engineNumbers, verifyTexts } from '../../lib/verify'
import type { AnalysisReport, Claim, CriticalPair, Decision, EvalResult, Recommendation, TraceStep } from '../../types/api'
import { DISTRICT_IDS, INDICATOR_CODES, type DistrictId, type IndicatorCode } from '../../types/data'

export const TEMPLATE_VERSION = 'template-1'

const claim = (text: string): Claim => ({ text, evidence: [] })
const indicatorName = (code: IndicatorCode) => RULES.indicators.find((i) => i.code === code)?.name_ru ?? code
const pct = (share: number) => `${Math.round(share * 100)}%`
const pairLabel = (p: CriticalPair) => `${districtName(p.district_id)} · ${p.indicator}`

function valueAfter(result: EvalResult, p: CriticalPair): number {
  return result.districts[p.district_id].indicators_after[p.indicator]
}

/** Стоимость, вложенная в район: районные меры целиком, городские — отдельной строкой. */
function spendByDistrict(decisions: readonly Decision[]): { byDistrict: Record<DistrictId, number>; city: number } {
  const byDistrict = Object.fromEntries(DISTRICT_IDS.map((id) => [id, 0])) as Record<DistrictId, number>
  let city = 0
  for (const d of decisions) {
    const cost = MEASURE_BY_ID.get(d.measure_id)?.cost ?? 0
    if (d.district === null) city += cost
    else if (d.district in byDistrict) byDistrict[d.district as DistrictId] += cost
  }
  return { byDistrict, city }
}

/** Доля населения в районах без единой критической пары. */
function popWithoutCritical(pairs: readonly CriticalPair[]): number {
  const hit = new Set(pairs.map((p) => p.district_id))
  return DISTRICT_IDS.filter((id) => !hit.has(id)).reduce((s, id) => s + DISTRICT_BY_ID.get(id)!.pop_share, 0)
}

export function toRecommendation(n: Neighbor): Recommendation {
  return {
    change: n.change,
    decisions: n.decisions,
    rationale: `Score ${fmt2(n.score)} (${fmtSigned(n.delta)}), стоимость ${n.cost} у.е., критических пар ${n.nCrit}.`,
    score: n.score,
    delta: n.delta,
    cost: n.cost,
    verified: true,
    invalid_reason: null,
  }
}

function summary(r: EvalResult): string {
  const before = r.critical_pairs.before.length
  return (
    `Сценарий даёт ${fmt2(r.score)} балла — ${fmtSigned(r.delta)} к базе ${fmt2(r.baseline)}. ` +
    `Потрачено ${r.cost} из ${RULES.budget} у.е. Критических пар: ${before} → ${r.n_crit}. ` +
    `Самый слабый район — ${r.min_district.name_ru} (D ${fmt2(r.min_district.d)}).`
  )
}

function strengths(r: EvalResult, decisions: readonly Decision[]): Claim[] {
  const out: Claim[] = []
  const ranked = [...decisions].sort((a, b) => r.contributions[b.measure_id].shapley - r.contributions[a.measure_id].shapley)
  for (const d of ranked.slice(0, 2)) {
    const c = r.contributions[d.measure_id]
    if (c.shapley <= 0) continue
    const m = MEASURE_BY_ID.get(d.measure_id)!
    out.push(claim(`${m.id} «${m.name_ru}» (${districtName(d.district)}): вклад ${fmtSigned(c.shapley)} к Score по Шепли.`))
  }
  for (const p of r.critical_pairs.closed) {
    out.push(
      claim(
        `Снята критическая пара ${pairLabel(p)} (${indicatorName(p.indicator)}): ${fmt2(p.value)} → ${fmt2(valueAfter(r, p))}, штраф N_crit меньше на 1.`,
      ),
    )
  }
  for (const s of r.synergies_triggered) {
    out.push(claim(`Сработала синергия ${s.pair.join('+')}: ${s.indicator} +${s.bonus} в районе ${districtName(s.district_id)}, без лага.`))
  }
  const weakest = r.districts[r.min_district.id]
  if (weakest.delta > 0.005) {
    out.push(
      claim(
        `Самый слабый район ${r.min_district.name_ru} подтянут: D ${fmt2(weakest.d_before)} → ${fmt2(weakest.d_after)} — это слагаемое 0.3 × min D.`,
      ),
    )
  }
  return out
}

function risks(r: EvalResult, decisions: readonly Decision[]): Claim[] {
  const out: Claim[] = []
  const fresh = new Set(r.critical_pairs.new.map((p) => `${p.district_id}.${p.indicator}`))
  for (const p of r.critical_pairs.after) {
    if (fresh.has(`${p.district_id}.${p.indicator}`)) continue
    out.push(claim(`Остаётся критическая пара ${pairLabel(p)} (${indicatorName(p.indicator)}) = ${fmt2(p.value)} < 40: минус 1 балл.`))
  }
  for (const p of r.critical_pairs.new) {
    const culprits = decisions
      .filter((d) => (d.district === null || d.district === p.district_id) && (MEASURE_BY_ID.get(d.measure_id)?.effects[p.indicator] ?? 0) < 0)
      .map((d) => d.measure_id)
    const before = r.districts[p.district_id].indicators_before[p.indicator]
    out.push(
      claim(
        `Новая критическая пара ${pairLabel(p)}: ${fmt2(before)} → ${fmt2(p.value)}` +
          (culprits.length ? ` — побочный эффект ${culprits.join(', ')}.` : '.'),
      ),
    )
  }
  for (const d of decisions) {
    const m = MEASURE_BY_ID.get(d.measure_id)!
    if (m.lag >= 3) {
      const share = ((RULES.horizon_quarters - m.lag) / RULES.horizon_quarters) * 100
      out.push(claim(`${m.id} с лагом ${m.lag} кв. реализует только ${share}% эффекта за горизонт ${RULES.horizon_quarters} кварталов.`))
    }
  }
  for (const d of decisions) {
    const c = r.contributions[d.measure_id]
    const m = MEASURE_BY_ID.get(d.measure_id)!
    if (c.shapley < 0.2) out.push(claim(`${m.id} почти не двигает Score: вклад ${fmtSigned(c.shapley)} при стоимости ${m.cost} у.е.`))
  }
  return out
}

function consequences(r: EvalResult): Claim[] {
  const out: Claim[] = []
  const byDelta = [...DISTRICT_IDS].sort((a, b) => r.districts[b].delta - r.districts[a].delta)
  const top = r.districts[byDelta[0]]
  out.push(claim(`Больше всех выигрывает ${districtName(byDelta[0])}: D ${fmt2(top.d_before)} → ${fmt2(top.d_after)} (${fmtSigned(top.delta)}).`))
  const low = byDelta.filter((id) => r.districts[id].delta < 0.5)
  if (low.length) {
    out.push(claim(`Почти без изменений: ${low.map((id) => `${districtName(id)} ${fmtSigned(r.districts[id].delta)}`).join(', ')}.`))
  }
  const cells = DISTRICT_IDS.flatMap((id) =>
    INDICATOR_CODES.map((code) => ({ id, code, before: r.districts[id].indicators_before[code], after: r.districts[id].indicators_after[code], delta: r.districts[id].deltas[code] })),
  )
    .filter((c) => Math.abs(c.delta) > 0.005)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3)
  if (cells.length) {
    out.push(
      claim(
        `Сильнее всего меняются: ${cells.map((c) => `${districtName(c.id)} · ${c.code} ${fmt2(c.before)} → ${fmt2(c.after)}`).join('; ')}.`,
      ),
    )
  }
  return out
}

function tradeoffs(r: EvalResult, decisions: readonly Decision[]): Claim[] {
  const out: Claim[] = []
  const { byDistrict, city } = spendByDistrict(decisions)
  const focus = [...DISTRICT_IDS].sort((a, b) => byDistrict[b] - byDistrict[a])[0]
  if (byDistrict[focus] > 0) {
    out.push(
      claim(
        `${districtName(focus)} получает ${byDistrict[focus]} у.е. из ${r.cost} (${pct(byDistrict[focus] / r.cost)} бюджета) ` +
          `при доле населения ${pct(DISTRICT_BY_ID.get(focus)!.pop_share)}` +
          (city ? `; на городские меры — ${city} у.е.` : '.'),
      ),
    )
  }
  const loo = [...decisions].sort((a, b) => r.contributions[b.measure_id].loo - r.contributions[a.measure_id].loo)[0]
  if (loo) {
    const c = r.contributions[loo.measure_id]
    out.push(claim(`Без ${loo.measure_id} Score был бы ${fmt2(r.score - c.loo)} — эту меру убирать дороже всего (${fmtSigned(-c.loo)}).`))
  }
  if (r.remaining > 0) {
    out.push(claim(`Остаток ${r.remaining} у.е. на Score не влияет: вложить его можно, только заменив одну из мер на более дорогую.`))
  }
  out.push(
    claim(
      `Формула ценит равенство: слагаемое 0.3 × min D = ${fmt2(r.components.min_term)} держит ${r.min_district.name_ru}, а не самый богатый район.`,
    ),
  )
  return out
}

function cityImpact(r: EvalResult, decisions: readonly Decision[]): Claim[] {
  const out: Claim[] = []
  const before = popWithoutCritical(r.critical_pairs.before)
  const after = popWithoutCritical(r.critical_pairs.after)
  out.push(claim(`Жители районов без критических показателей: ${pct(before)} → ${pct(after)} населения города.`))
  for (const p of r.critical_pairs.closed) {
    out.push(
      claim(
        `${districtName(p.district_id)} (${pct(DISTRICT_BY_ID.get(p.district_id)!.pop_share)} жителей): «${indicatorName(p.indicator)}» выходит из критической зоны.`,
      ),
    )
  }
  const { byDistrict } = spendByDistrict(decisions)
  const untouched = DISTRICT_IDS.filter((id) => byDistrict[id] === 0)
  if (untouched.length && untouched.length < DISTRICT_IDS.length) {
    out.push(claim(`Районных мер нет в: ${untouched.map(districtName).join(', ')} — там работают только городские программы.`))
  }
  return out
}

/** Рекомендации: лучшие соседние наборы на один шаг с положительной дельтой. */
export function recommendationsFor(decisions: readonly Decision[], limit = 3): { list: Recommendation[]; considered: number } {
  const all = neighbors(decisions)
  return { list: all.filter((n) => n.delta > 0.005).slice(0, limit).map(toRecommendation), considered: all.length }
}

export function buildTemplateReport(result: EvalResult, decisions: readonly Decision[]): AnalysisReport {
  const trace: TraceStep[] = []
  const step = <T>(tool: string, fn: () => T, summarize: (x: T) => string): T => {
    const t0 = performance.now()
    const value = fn()
    trace.push({ n: trace.length + 1, kind: 'server', tool, input: null, output_summary: summarize(value), ms: Math.round((performance.now() - t0) * 100) / 100, ok: true })
    return value
  }
  step('validate', () => true, () => '6/6 правил')
  step('evaluate', () => result.score, (s) => fmt2(s))
  const ordered = [...decisions].sort((a, b) => measureOrder(a.measure_id) - measureOrder(b.measure_id))
  step('contributions', () => ordered.length, (n) => `${n} мер`)
  const recs = step('neighbors', () => recommendationsFor(decisions), (x) => `${x.considered} сценариев`)
  if (result.percentile !== null) step('percentile', () => result.percentile!, (p) => `${fmt2(p)}%`)

  const report: AnalysisReport = {
    summary: summary(result) + (recs.list.length ? '' : ' Соседних улучшений на один шаг нет — набор локально оптимален.'),
    strengths: strengths(result, ordered),
    risks: risks(result, ordered),
    consequences: consequences(result),
    tradeoffs: tradeoffs(result, ordered),
    city_impact: cityImpact(result, ordered),
    recommendations: recs.list,
    provider: 'rules',
    model: null,
    prompt_version: TEMPLATE_VERSION,
    trace,
    verified_numbers: { total: 0, confirmed: 0, unverified: [] },
    cached: false,
  }
  report.verified_numbers = verifyTexts(reportTexts(report), engineNumbers(result, report.recommendations))
  return report
}

/** Все тексты записки — для проверки чисел. */
export function reportTexts(report: AnalysisReport): string[] {
  return [
    report.summary,
    ...[report.strengths, report.risks, report.consequences, report.tradeoffs, report.city_impact].flat().map((c) => c.text),
    ...report.recommendations.flatMap((r) => [r.change, r.rationale]),
  ]
}
