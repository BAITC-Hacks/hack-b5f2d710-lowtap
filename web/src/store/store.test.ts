import { beforeEach, describe, expect, it } from 'vitest'
import { useScenario } from './scenario'
import { useUi } from './ui'

describe('scenario store', () => {
  beforeEach(() => useScenario.setState({ decisions: [], past: [] }))

  it('городская мера ставится без района, районная — в свой район', () => {
    const { place } = useScenario.getState()
    place('M12', 'nura')
    place('M7', 'nura')
    expect(useScenario.getState().decisions).toEqual([
      { measure_id: 'M12', district: null },
      { measure_id: 'M7', district: 'nura' },
    ])
  })

  it('перестановка сохраняет гнездо, undo откатывает по шагу', () => {
    const s = useScenario.getState()
    s.place('M7', 'esil')
    s.place('M8', 'nura')
    s.place('M7', 'nura')
    expect(useScenario.getState().decisions[0]).toEqual({ measure_id: 'M7', district: 'nura' })
    s.undo()
    expect(useScenario.getState().decisions[0]).toEqual({ measure_id: 'M7', district: 'esil' })
    s.remove('M8')
    s.reset()
    expect(useScenario.getState().decisions).toEqual([])
    s.undo()
    s.undo()
    expect(useScenario.getState().decisions.map((d) => d.measure_id)).toEqual(['M7', 'M8'])
  })

  it('повтор того же набора не засоряет историю', () => {
    const s = useScenario.getState()
    s.load([{ measure_id: 'M12', district: null }])
    s.load([{ measure_id: 'M12', district: null }])
    expect(useScenario.getState().past).toHaveLength(1)
  })
})

describe('ui store', () => {
  it('Esc: сначала выход из постановки, потом снятие выбора района', () => {
    useUi.setState({ mode: { kind: 'placing', measureId: 'M7' }, selectedDistrict: 'nura' })
    useUi.getState().cancel()
    expect(useUi.getState().mode).toEqual({ kind: 'idle' })
    expect(useUi.getState().selectedDistrict).toBe('nura')
    useUi.getState().cancel()
    expect(useUi.getState().selectedDistrict).toBeNull()
  })

  it('Space: проигрывание с Q0, пауза, Esc — на итог Q8', () => {
    useUi.setState({ mode: { kind: 'idle' }, quarter: 8 })
    useUi.getState().togglePlay()
    expect(useUi.getState().mode).toEqual({ kind: 'playing' })
    expect(useUi.getState().quarter).toBe(0)
    useUi.getState().setQuarter(3)
    useUi.getState().togglePlay()
    expect(useUi.getState().mode).toEqual({ kind: 'idle' })
    useUi.getState().togglePlay()
    expect(useUi.getState().quarter).toBe(3)
    useUi.getState().stopPlaying()
    expect(useUi.getState()).toMatchObject({ mode: { kind: 'idle' }, quarter: 8 })
  })

  it('квартал ограничен 0..8', () => {
    useUi.getState().setQuarter(11)
    expect(useUi.getState().quarter).toBe(8)
    useUi.getState().setQuarter(-2)
    expect(useUi.getState().quarter).toBe(0)
  })
})
