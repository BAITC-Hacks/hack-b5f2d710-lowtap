import { geoArea } from 'd3-geo'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUi } from '../store/ui'
import { DISTRICT_IDS } from '../types/data'
import { OfflineError, evaluate, withFallback } from './api'
import { extractDecimals, fmt1, fmt2, fmtSigned, normalizeNumber } from './format'
import { districtShapes, fitMap, pinOffset } from './geo'
import { buildHash, decodeDecisions, encodeDecisions, parseHash } from './permalink'
import { createSSEParser, type SSEMessage } from './sse'

describe('format', () => {
  it('Score, дельты и показатели', () => {
    expect(fmt2(56.543)).toBe('56.54')
    expect(fmtSigned(3.9853)).toBe('+3.99')
    expect(fmtSigned(-0.871)).toBe('−0.87')
    expect(fmtSigned(-0.001)).toBe('0.00')
    expect(fmt1(43.75)).toBe('43.8')
  })

  it('числа в тексте записки: запятая, минусы, знак', () => {
    const found = extractDecimals('Score 56,54 (+3.99); Нура −0.87 и –1.5; 100 у.е. не число')
    expect(found.map((m) => m.value)).toEqual([56.54, 3.99, -0.87, -1.5])
    expect(normalizeNumber('−3,98')).toBe(-3.98)
  })
})

describe('permalink', () => {
  const decisions = [
    { measure_id: 'M7', district: 'nura' },
    { measure_id: 'M8', district: 'nura' },
    { measure_id: 'M10', district: 'nura' },
    { measure_id: 'M12', district: null },
    { measure_id: 'M5', district: 'saryarka' },
  ]

  it('формат из контракта', () => {
    expect(buildHash('pult', decisions)).toBe('#/pult?d=M7:nura,M8:nura,M10:nura,M12,M5:saryarka')
    expect(decodeDecisions(encodeDecisions(decisions))).toEqual(decisions)
  })

  it('разбор hash', () => {
    expect(parseHash('#/verdict?d=M12,M3:esil')).toEqual({
      screen: 'verdict',
      decisions: [
        { measure_id: 'M12', district: null },
        { measure_id: 'M3', district: 'esil' },
      ],
    })
    expect(parseHash('')).toEqual({ screen: 'pult', decisions: null })
    expect(parseHash('#/unknown?d=')).toEqual({ screen: 'pult', decisions: [] })
  })
})

describe('geo', () => {
  const shapes = districtShapes()

  it('5 районов в порядке DISTRICT_IDS, крупнейший полигон — «внутренний» для d3', () => {
    expect(shapes.map((s) => s.id)).toEqual([...DISTRICT_IDS])
    for (const s of shapes) {
      const area = geoArea(s.main)
      expect(area).toBeGreaterThan(0)
      expect(area).toBeLessThan(1e-4) // район, а не вся сфера без района
      for (const ex of s.exclaves) expect(geoArea(ex)).toBeLessThanOrEqual(area)
    }
  })

  it('проекция вписывается в кадр с отступом', () => {
    const { path, anchors } = fitMap(shapes, 716, 556, 40)
    const [[x0, y0], [x1, y1]] = path.bounds({ type: 'FeatureCollection', features: shapes.map((s) => s.main) })
    expect(x0).toBeGreaterThanOrEqual(39.5)
    expect(y0).toBeGreaterThanOrEqual(39.5)
    expect(x1).toBeLessThanOrEqual(676.5)
    expect(y1).toBeLessThanOrEqual(516.5)
    // Есиль южнее Байконура (ось y экрана вниз).
    expect(anchors.esil[1]).toBeGreaterThan(anchors.baikonur[1])
  })

  it('смещения пинов 0 / +26 / −26', () => {
    expect([0, 1, 2].map(pinOffset)).toEqual([
      [0, 0],
      [26, 0],
      [-26, 0],
    ])
  })
})

describe('sse', () => {
  it('события в любом разбиении на куски, CRLF, комментарии', () => {
    const got: SSEMessage[] = []
    const parser = createSSEParser((m) => got.push(m))
    const stream = ': ping\r\nevent: trace\r\ndata: {"n":1}\r\n\r\nevent: report\ndata: {"a":\ndata: 2}\n\nevent: done\ndata: {}'
    for (let i = 0; i < stream.length; i += 7) parser.push(stream.slice(i, i + 7))
    parser.end()
    expect(got).toEqual([
      { event: 'trace', data: '{"n":1}' },
      { event: 'report', data: '{"a":\n2}' },
      { event: 'done', data: '{}' },
    ])
  })
})

describe('api: локальный режим без бэкенда', () => {
  beforeEach(() => useUi.setState({ backend: 'unknown' }))
  afterEach(() => vi.unstubAllGlobals())

  it('сетевая ошибка → офлайн и локальный результат', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const result = await withFallback(() => evaluate({ decisions: [] }), () => ({ ok: true as const, data: 'local' }))
    expect(result).toEqual({ data: { ok: true, data: 'local' }, source: 'local' })
    expect(useUi.getState().backend).toBe('offline')
  })

  it('422 — не ошибка связи: причины невалидности приходят с сервера', async () => {
    const violations = [{ code: 'BUDGET_EXCEEDED', message: 'x', decision_idx: null, measures: [] }]
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: false, violations }), { status: 422, headers: { 'content-type': 'application/json' } }),
      ),
    )
    const result = await withFallback(() => evaluate({ decisions: [] }), () => {
      throw new OfflineError('не должно вызываться')
    })
    expect(result).toEqual({ data: { ok: false, violations }, source: 'server' })
  })
})
