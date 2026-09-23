// Валидатор правил ТЗ: 12 кодов, все нарушения сразу (не первое), сообщения по-русски.
// Плюс то, что нужно только UI: 6 маркеров полосы валидатора и одна приоритетная
// причина блокировки карточки меры.

import type { Decision, Violation, ViolationCode } from '../types/api'
import { DIRECTION_CODES, type DirectionCode } from '../types/data'
import { MEASURE_BY_ID, RULES, directionName, districtName, isDistrictId } from './catalog'

function violation(code: ViolationCode, message: string, decisionIdx: number | null = null, measures: string[] = []): Violation {
  return { code, message, decision_idx: decisionIdx, measures }
}

/** Стоимость набора: сумма стоимостей известных мер. */
export function decisionsCost(decisions: readonly Decision[]): number {
  return decisions.reduce((sum, d) => sum + (MEASURE_BY_ID.get(d.measure_id)?.cost ?? 0), 0)
}

/** Проверка структурно корректного набора решений по правилам ТЗ. */
export function validateDecisions(decisions: readonly Decision[]): Violation[] {
  const out: Violation[] = []
  const required = RULES.decisions_required

  if (decisions.length !== required) {
    out.push(violation('NOT_FIVE', `Нужно ровно ${required} решений, сейчас ${decisions.length}.`))
  }

  const seen = new Set<string>()
  decisions.forEach((dec, idx) => {
    const measure = MEASURE_BY_ID.get(dec.measure_id)
    if (!measure) {
      out.push(violation('UNKNOWN_MEASURE', `Неизвестная мера «${dec.measure_id}».`, idx, [dec.measure_id]))
      return
    }
    if (measure.type === 'city') {
      if (dec.district !== null) {
        out.push(violation('DISTRICT_FORBIDDEN', `${measure.id} — городская мера, район не указывается.`, idx, [measure.id]))
        if (!isDistrictId(dec.district)) {
          out.push(violation('UNKNOWN_DISTRICT', `Неизвестный район «${dec.district}».`, idx, [measure.id]))
        }
      }
    } else if (dec.district === null) {
      out.push(violation('DISTRICT_REQUIRED', `Для меры ${measure.id} нужно указать район.`, idx, [measure.id]))
    } else if (!isDistrictId(dec.district)) {
      out.push(violation('UNKNOWN_DISTRICT', `Неизвестный район «${dec.district}».`, idx, [measure.id]))
    }
    if (seen.has(measure.id)) {
      out.push(violation('DUPLICATE', `Мера ${measure.id} выбрана повторно.`, idx, [measure.id]))
    }
    seen.add(measure.id)
  })

  const byDirection = new Map<DirectionCode, string[]>()
  for (const id of seen) {
    const dir = MEASURE_BY_ID.get(id)!.direction
    byDirection.set(dir, [...(byDirection.get(dir) ?? []), id])
  }
  for (const dir of DIRECTION_CODES) {
    const ids = byDirection.get(dir) ?? []
    if (ids.length > RULES.max_per_direction) {
      out.push(
        violation(
          'DIRECTION_LIMIT',
          `Направление «${directionName(dir)}»: ${ids.length} меры, допускается не более ${RULES.max_per_direction}.`,
          null,
          ids,
        ),
      )
    }
  }

  for (const rule of RULES.incompatibilities) {
    const [a, b] = rule.pair
    const decA = decisions.find((d) => d.measure_id === a)
    const decB = decisions.find((d) => d.measure_id === b)
    if (!decA || !decB) continue
    if (rule.scope === 'any') {
      out.push(violation(rule.code, `${a} и ${b} несовместимы: ${rule.reason_ru}.`, null, [a, b]))
    } else if (decA.district !== null && decA.district === decB.district && isDistrictId(decA.district)) {
      out.push(
        violation(rule.code, `${a} и ${b} в одном районе (${districtName(decA.district)}): ${rule.reason_ru}.`, null, [a, b]),
      )
    }
  }

  const cost = decisionsCost(decisions)
  if (cost > RULES.budget) {
    out.push(
      violation(
        'BUDGET_EXCEEDED',
        `Бюджет превышен: ${cost} из ${RULES.budget} у.е., превышение на ${cost - RULES.budget} у.е.`,
        null,
        decisions.map((d) => d.measure_id).filter((id) => MEASURE_BY_ID.has(id)),
      ),
    )
  }

  return out
}

/** Проверка произвольного JSON (тело запроса): структурные ошибки → BAD_REQUEST той же формы. */
export function validateScenario(raw: unknown): Violation[] {
  const decisions = parseScenario(raw)
  if (typeof decisions === 'string') return [violation('BAD_REQUEST', decisions)]
  return validateDecisions(decisions)
}

function parseScenario(raw: unknown): Decision[] | string {
  if (typeof raw !== 'object' || raw === null || !('decisions' in raw)) {
    return 'Ожидался объект {"decisions": [...]}.'
  }
  const list = (raw as { decisions: unknown }).decisions
  if (!Array.isArray(list)) return 'Поле decisions должно быть массивом.'
  const out: Decision[] = []
  for (const [idx, item] of list.entries()) {
    if (typeof item !== 'object' || item === null) return `Решение №${idx + 1}: ожидался объект.`
    const { measure_id, district } = item as Record<string, unknown>
    if (typeof measure_id !== 'string') return `Решение №${idx + 1}: measure_id должен быть строкой.`
    if (district !== null && district !== undefined && typeof district !== 'string') {
      return `Решение №${idx + 1}: district должен быть строкой или null.`
    }
    out.push({ measure_id, district: (district as string | null | undefined) ?? null })
  }
  return out
}

// ---------------------------------------------------------------- UI: полоса валидатора

export const CHECKS = [
  { key: 'count', label: 'ровно 5 решений' },
  { key: 'unique', label: 'без повторов' },
  { key: 'direction', label: '≤2 на направление' },
  { key: 'districts', label: 'меры и районы указаны' },
  { key: 'compat', label: 'несовместимости' },
  { key: 'budget', label: 'бюджет ≤100' },
] as const
export type CheckKey = (typeof CHECKS)[number]['key']
export type CheckStatus = 'pending' | 'ok' | 'fail'

const CHECK_OF_CODE: Record<Exclude<ViolationCode, 'BAD_REQUEST'>, CheckKey> = {
  NOT_FIVE: 'count',
  DUPLICATE: 'unique',
  DIRECTION_LIMIT: 'direction',
  UNKNOWN_MEASURE: 'districts',
  UNKNOWN_DISTRICT: 'districts',
  DISTRICT_REQUIRED: 'districts',
  DISTRICT_FORBIDDEN: 'districts',
  INCOMPATIBLE_M1_M3: 'compat',
  CONFLICT_M4_M7: 'compat',
  CONFLICT_M5_M13: 'compat',
  BUDGET_EXCEEDED: 'budget',
}

/**
 * Шесть маркеров: серый — ещё не проверяемо (пустой набор, «ровно 5» пока меньше 5),
 * зелёный — правило выполнено, красный — нарушено.
 */
export function checklist(decisions: readonly Decision[], violations = validateDecisions(decisions)): Record<CheckKey, CheckStatus> {
  const failed = new Set(violations.map((v) => (v.code === 'BAD_REQUEST' ? null : CHECK_OF_CODE[v.code])))
  const empty = decisions.length === 0
  const status = {} as Record<CheckKey, CheckStatus>
  for (const { key } of CHECKS) {
    if (failed.has(key)) {
      status[key] = key === 'count' && decisions.length < RULES.decisions_required ? 'pending' : 'fail'
    } else {
      status[key] = empty ? 'pending' : 'ok'
    }
  }
  return status
}

// ---------------------------------------------------------------- UI: блокировка карточки

export type BlockKind = 'full' | 'direction' | 'incompatible' | 'budget'
export interface BlockReason {
  kind: BlockKind
  text: string
}

/**
 * Ровно одна причина, почему меру нельзя добавить, — самая ранняя по приоритету:
 * (1) 5/5, (2) лимит направления, (3) несовместимость в любом районе, (4) бюджет.
 * Для уже поставленной меры — null (её можно переставить или снять).
 */
export function blockReason(decisions: readonly Decision[], measureId: string): BlockReason | null {
  const measure = MEASURE_BY_ID.get(measureId)
  if (!measure || decisions.some((d) => d.measure_id === measureId)) return null
  const required = RULES.decisions_required

  if (decisions.length >= required) {
    return { kind: 'full', text: `${required}/${required} — снимите меру` }
  }
  const sameDirection = decisions.filter((d) => MEASURE_BY_ID.get(d.measure_id)?.direction === measure.direction).length
  if (sameDirection >= RULES.max_per_direction) {
    return {
      kind: 'direction',
      text: `лимит: ${directionName(measure.direction)} ${sameDirection}/${RULES.max_per_direction}`,
    }
  }
  for (const rule of RULES.incompatibilities) {
    if (rule.scope !== 'any' || !rule.pair.includes(measureId)) continue
    const other = rule.pair[0] === measureId ? rule.pair[1] : rule.pair[0]
    if (decisions.some((d) => d.measure_id === other)) return { kind: 'incompatible', text: `несовместимо с ${other}` }
  }
  const total = decisionsCost(decisions) + measure.cost
  if (total > RULES.budget) {
    return { kind: 'budget', text: `+${measure.cost} → ${total}/${RULES.budget}` }
  }
  return null
}

/** Конфликт «в одном районе» (M4/M7, M5/M13): район для этой меры заблокирован. */
export function districtConflict(decisions: readonly Decision[], measureId: string, districtId: string): string | null {
  for (const rule of RULES.incompatibilities) {
    if (rule.scope !== 'same_district' || !rule.pair.includes(measureId)) continue
    const other = rule.pair[0] === measureId ? rule.pair[1] : rule.pair[0]
    if (decisions.some((d) => d.measure_id === other && d.district === districtId)) {
      return `${measureId} несовместим с ${other} здесь`
    }
  }
  return null
}
