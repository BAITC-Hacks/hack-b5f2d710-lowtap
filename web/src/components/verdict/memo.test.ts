import { describe, expect, it } from 'vitest'
import { evaluateLocal } from '../../engine/evaluate'
import { presetById } from '../../engine/presets'
import { buildTemplateReport, reportTexts } from './MemoTemplate'

function reportFor(id: string) {
  const decisions = presetById(id)!.decisions
  const out = evaluateLocal(decisions)
  if (!out.ok) throw new Error(`${id}: ожидался валидный набор`)
  return { result: out.data, report: buildTemplateReport(out.data, decisions) }
}

describe('MemoTemplate: записка из чисел движка', () => {
  it.each(['example_tz', 'cheapest', 'naive_esil', 'worst_of_all', 'optimum'])('%s: все десятичные числа подтверждены движком', (id) => {
    const { report } = reportFor(id)
    expect(report.verified_numbers.unverified).toEqual([])
    expect(report.verified_numbers.total).toBeGreaterThan(5)
    expect(report.verified_numbers.confirmed).toBe(report.verified_numbers.total)
    for (const section of [report.strengths, report.risks, report.consequences, report.tradeoffs, report.city_impact]) {
      expect(section.length).toBeGreaterThan(0)
    }
  })

  it('пример ТЗ: итог, снятые пары, синергия', () => {
    const { report } = reportFor('example_tz')
    expect(report.summary).toContain('56.54')
    expect(report.summary).toContain('+3.99')
    const text = reportTexts(report).join('\n')
    expect(text).toContain('Снята критическая пара Нура · S1')
    expect(text).toContain('M10+M12')
    expect(report.recommendations.length).toBeGreaterThan(0)
    expect(report.recommendations.every((r) => r.verified && (r.delta ?? 0) > 0)).toBe(true)
  })

  it('худший набор: новая критическая пара — побочный эффект M11', () => {
    const text = reportTexts(reportFor('worst_of_all').report).join('\n')
    expect(text).toContain('Новая критическая пара Алматы · T1')
    expect(text).toContain('M11')
  })

  it('оптимум: соседних улучшений нет', () => {
    const { report } = reportFor('optimum')
    expect(report.recommendations).toEqual([])
    expect(report.summary).toContain('локально оптимален')
  })
})
