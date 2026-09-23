import { ArrowLeft, ExternalLink } from 'lucide-react'
import { motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { BudgetTicks } from '../components/score/BudgetTicks'
import { MapAstana } from '../components/map/MapAstana'
import { MEASURE_BY_ID, RULES, districtName } from '../engine/catalog'
import { DISTRIBUTION, percentileOf } from '../engine/distribution'
import { presetById } from '../engine/presets'
import { BASE_STATE, computeState, type EngineState } from '../engine/score'
import { decisionsCost, validateDecisions } from '../engine/validate'
import { DIRECTION_COLOR, signColor } from '../lib/colors'
import { fmt2, fmtPct, fmtSigned } from '../lib/format'
import { useHotkeys } from '../lib/hotkeys'
import { useSize } from '../hooks/useSize'
import { useAnalysis } from '../store/analysis'
import { useScenario } from '../store/scenario'
import { useUi } from '../store/ui'
import type { Decision } from '../types/api'

interface Row {
  id: string
  label: string
  decisions: Decision[]
  state: EngineState
  cost: number
  valid: boolean
  percentile: number | null
}

function makeRow(id: string, label: string, decisions: Decision[]): Row {
  const valid = decisions.length > 0 && validateDecisions(decisions).length === 0
  const state = computeState(decisions)
  return { id, label, decisions, state, cost: decisionsCost(decisions), valid, percentile: valid ? percentileOf(state.score) : null }
}

/** Пять сценариев одной таблицей в одной шкале: база, пример ТЗ, самый дешёвый, оптимум перебора и ваш. */
export function Compare() {
  const current = useScenario((s) => s.decisions)
  const load = useScenario((s) => s.load)
  const setScreen = useUi((s) => s.setScreen)
  const run = useAnalysis((s) => s.run)
  const [hover, setHover] = useState<string | null>(null)
  useHotkeys(useMemo(() => ({ escape: () => setScreen('pult') }), [setScreen]))

  const rows = useMemo<Row[]>(
    () => [
      makeRow('base', 'Базовый', []),
      makeRow('example_tz', 'Пример ТЗ', presetById('example_tz')?.decisions ?? []),
      makeRow('cheapest', 'Самый дешёвый', presetById('cheapest')?.decisions ?? []),
      makeRow('optimum', 'Оптимум перебора', presetById('optimum')?.decisions ?? []),
      makeRow('yours', 'Ваш сценарий', current),
    ],
    [current],
  )
  const best = rows.filter((r) => r.valid).reduce<Row | null>((a, r) => (!a || r.state.score > a.state.score ? r : a), null)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
      className="grid h-full min-h-[720px] min-w-[1280px] grid-rows-[56px_1fr_104px] overflow-hidden bg-panel"
    >
      <header className="flex items-center gap-5 border-b border-line px-5">
        <button
          type="button"
          onClick={() => setScreen('pult')}
          className="flex h-8 items-center gap-1.5 rounded-chip border border-line px-2.5 text-[12px] hover:border-accent"
          title="На Пульт (Esc)"
        >
          <ArrowLeft size={14} /> Пульт
        </button>
        <h1 className="font-display text-[20px] font-medium tracking-[-0.01em]">СРАВНЕНИЕ</h1>
        <span className="num text-[12px] text-ink-2">
          {rows.length} сценариев · одна шкала D 40–80 · бюджет {RULES.budget} у.е.
        </span>
      </header>

      <ol className="grid min-h-0 grid-rows-5">
        {rows.map((r) => {
          const empty = r.id === 'yours' && r.decisions.length === 0
          const dim = hover !== null && hover !== r.id
          return (
            <li
              key={r.id}
              onMouseEnter={() => setHover(r.id)}
              onMouseLeave={() => setHover(null)}
              className="relative grid min-h-0 grid-cols-[210px_1fr_300px] items-center border-b border-line"
              style={{ opacity: dim ? 0.55 : 1, transition: 'opacity 150ms var(--ease-data)' }}
            >
              {best?.id === r.id && <span className="absolute inset-y-0 left-0 w-[3px] bg-accent" aria-label="лучший" />}
              <div className="relative h-full border-r border-line">
                <MapAstana state={r.state} compact padding={8} />
              </div>

              <div className="flex min-w-0 flex-col gap-2 px-5">
                <div className="flex items-baseline gap-3">
                  <span className="text-[14px] font-semibold">{r.label}</span>
                  {r.id === 'yours' && !empty && !r.valid && <span className="text-[11px] text-down">набор не по правилам — Score не считается</span>}
                </div>
                {r.decisions.length ? (
                  <ol className="flex flex-wrap gap-1.5">
                    {r.decisions.map((d) => {
                      const m = MEASURE_BY_ID.get(d.measure_id)
                      return (
                        <li key={d.measure_id} className="num flex h-[22px] items-center overflow-hidden rounded-chip border border-line text-[10px]" title={m?.name_ru}>
                          <span className="h-full w-[3px]" style={{ background: m ? DIRECTION_COLOR[m.direction] : 'var(--down)' }} />
                          <span className="px-1.5">
                            {d.measure_id} · {districtName(d.district)}
                          </span>
                        </li>
                      )
                    })}
                  </ol>
                ) : (
                  <p className="text-[12px] text-ink-2">{empty ? 'На Пульте пока нет решений.' : 'Без решений — стартовое состояние города.'}</p>
                )}
                <div className="flex items-center gap-3">
                  <div className="w-[300px]">
                    <BudgetTicks decisions={r.decisions} cost={r.cost} />
                  </div>
                  <span className="num text-[11px] text-ink-2">
                    <span className="text-gold">{r.cost}</span> / {RULES.budget} у.е.
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-4 pr-5">
                <div className="text-right">
                  <div
                    className="font-display text-[28px] font-medium leading-none tabular-nums"
                    style={{ color: r.valid || r.id === 'base' ? 'var(--ink)' : 'var(--ink-2)' }}
                  >
                    {fmt2(r.state.score)}
                  </div>
                  <div className="num mt-1 flex justify-end gap-2 text-[11px]">
                    {r.id !== 'base' && <span style={{ color: signColor(r.state.score - BASE_STATE.score) }}>{fmtSigned(r.state.score - BASE_STATE.score)}</span>}
                    <span style={{ color: r.state.nCrit ? 'var(--down)' : 'var(--up)' }}>КРИТ {r.state.nCrit}</span>
                  </div>
                  <div className="num text-[10px] text-ink-2">{r.percentile !== null ? `лучше ≈${fmtPct(r.percentile)}` : r.id === 'base' ? 'база ТЗ' : 'предварительно'}</div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    disabled={!r.valid}
                    onClick={() => void run('calc', r.decisions)}
                    className="h-7 rounded-chip border border-accent px-2.5 text-[11px] font-medium text-accent disabled:border-line disabled:text-ink-2"
                  >
                    Вердикт
                  </button>
                  <button
                    type="button"
                    disabled={r.id === 'yours'}
                    onClick={() => {
                      load(r.decisions)
                      setScreen('pult')
                    }}
                    className="flex h-7 items-center justify-center gap-1 rounded-chip border border-line px-2.5 text-[11px] disabled:text-line"
                    title="Загрузить этот набор на Пульт"
                  >
                    <ExternalLink size={12} /> на Пульт
                  </button>
                </div>
              </div>
            </li>
          )
        })}
      </ol>

      <DistributionStrip rows={rows} hover={hover} />
    </motion.div>
  )
}

function DistributionStrip({ rows, hover }: { rows: Row[]; hover: string | null }) {
  const [ref, { width, height }] = useSize<HTMLDivElement>()
  const dist = DISTRIBUTION
  if (!dist) return <footer className="border-t border-line" />
  const lo = dist.bins[0].start
  const hi = dist.bins[dist.bins.length - 1].end
  const maxCount = Math.max(...dist.bins.map((b) => b.count))
  const top = 30
  const bottom = 16
  const H = Math.max(10, height - top - bottom)
  const x = (v: number) => 8 + ((v - lo) / (hi - lo)) * (width - 16)

  return (
    <footer className="flex items-stretch gap-5 border-t border-line px-5">
      <div className="flex w-[190px] shrink-0 flex-col justify-center">
        <div className="caps text-[10px]">Все допустимые наборы</div>
        <div className="num text-[11px] text-ink-2">
          {dist.count.toLocaleString('ru-RU')} · хуже базы {dist.worse_than_baseline.toLocaleString('ru-RU')}
        </div>
      </div>
      <div ref={ref} className="relative min-w-0 flex-1">
        {width > 0 && (
          <svg width={width} height={height} aria-label="Распределение Score всех допустимых наборов">
            {dist.bins.map((b) => (
              <rect
                key={b.start}
                x={x(b.start)}
                width={Math.max(0.5, x(b.end) - x(b.start) - 1)}
                y={top + H - (b.count / maxCount) * H}
                height={(b.count / maxCount) * H}
                style={{ fill: 'var(--line)' }}
              />
            ))}
            {[52, 53, 54, 55, 56, 57].map((v) => (
              <text key={v} x={x(v)} y={height - 3} textAnchor="middle" fontSize={10} style={{ fill: 'var(--ink-2)', fontFamily: 'var(--font-mono)' }}>
                {v}
              </text>
            ))}
            {placeLabels(rows.filter((r) => r.id !== 'yours' || r.decisions.length), x, width).map(({ row: r, level, anchor }) => {
              const active = hover === null || hover === r.id
              const color = hover === r.id ? 'var(--accent)' : 'var(--ink)'
              const labelY = 9 + level * 10
              return (
                <g key={r.id} transform={`translate(${x(r.state.score)},0)`} opacity={active ? 1 : 0.25}>
                  <line y1={labelY + 2} y2={top + H} style={{ stroke: color, strokeWidth: 2 }} />
                  <text y={labelY} textAnchor={anchor} fontSize={10} style={{ fill: color, fontFamily: 'var(--font-sans)' }}>
                    {r.label} {fmt2(r.state.score)}
                  </text>
                </g>
              )
            })}
          </svg>
        )}
      </div>
    </footer>
  )
}

/** Подписи маркеров без наложений: жадно по уровням, у правого края — выравнивание вправо. */
function placeLabels(rows: Row[], x: (v: number) => number, width: number) {
  const CHAR = 5.6
  const ends: number[] = []
  return [...rows]
    .sort((a, b) => a.state.score - b.state.score)
    .map((row) => {
      const w = (row.label.length + 6) * CHAR
      const cx = x(row.state.score)
      const anchor: 'start' | 'end' = cx + w > width - 4 ? 'end' : 'start'
      const [from, to] = anchor === 'end' ? [cx - w, cx] : [cx, cx + w]
      let level = ends.findIndex((end) => end < from - 6)
      if (level === -1) level = ends.length
      ends[level] = to
      return { row, level: Math.min(level, 2), anchor }
    })
}
