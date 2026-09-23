import { ArrowLeft, RefreshCw } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { AnimatedNumber } from '../components/score/ScoreHero'
import { AgentTrace } from '../components/verdict/AgentTrace'
import { ContributionWaterfall } from '../components/verdict/ContributionWaterfall'
import { DistrictSlope } from '../components/verdict/DistrictSlope'
import { MemoDocument } from '../components/verdict/MemoDocument'
import { QuarterPair } from '../components/verdict/QuarterPair'
import { VerifiedBadge } from '../components/verdict/VerifiedBadge'
import { MEASURE_BY_ID, RULES, districtName } from '../engine/catalog'
import { DISTRIBUTION } from '../engine/distribution'
import { canonicalScenario } from '../engine/hash'
import { computeState } from '../engine/score'
import { validateDecisions } from '../engine/validate'
import { DIRECTION_COLOR, signColor } from '../lib/colors'
import { fmt2, fmtPct, fmtSigned } from '../lib/format'
import { resolveHighlight } from '../lib/highlight'
import { useHotkeys } from '../lib/hotkeys'
import { engineNumbers, verifyTexts } from '../lib/verify'
import { reportTexts } from '../components/verdict/MemoTemplate'
import { useAnalysis } from '../store/analysis'
import { useScenario } from '../store/scenario'
import { useUi } from '../store/ui'
import type { Decision, Recommendation } from '../types/api'

function providerLabel(template: boolean, provider: string, model: string | null): string {
  if (template) return 'шаблон'
  if (provider === 'llm') return model ? `LLM · ${model}` : 'LLM'
  if (provider === 'cache') return 'кэш LLM'
  if (provider.startsWith('rules(fallback')) return 'rules · fallback'
  return provider
}

/** «Отчёт за смену»: итог сценария, откуда взялся Score, записка акиму и проверенные рекомендации. */
export function Verdict() {
  const { result, report, decisions, trace, status, template, mode, key, forceOffline, run, setForceOffline } = useAnalysis()
  const current = useScenario((s) => s.decisions)
  const load = useScenario((s) => s.load)
  const setScreen = useUi((s) => s.setScreen)
  const flashRecent = useUi((s) => s.flashRecent)
  const [chip, setChip] = useState<number | null>(null)
  const [tryOn, setTryOn] = useState<Recommendation | null>(null)

  // Прямой переход по ссылке #/verdict: считаем текущий набор, невалидный — обратно на Пульт.
  useEffect(() => {
    if (result) return
    if (current.length && validateDecisions(current).length === 0) void run('calc', current)
    else setScreen('pult')
  }, [result, current, run, setScreen])

  const hotkeys = useMemo(() => ({ escape: () => setScreen('pult') }), [setScreen])
  useHotkeys(hotkeys)

  const numbers = useMemo(() => (result && report ? engineNumbers(result, report.recommendations) : []), [result, report])
  const localCheck = useMemo(() => (report ? verifyTexts(reportTexts(report), numbers) : null), [report, numbers])
  const finalState = useMemo(() => computeState(decisions), [decisions])
  const tryState = useMemo(() => (tryOn ? computeState(tryOn.decisions) : null), [tryOn])
  const highlight = resolveHighlight(chip, result)

  if (!result || !report) return null
  const stale = key !== canonicalScenario(current)
  // Guard сервера — источник истины; пока он не проверял числа (total 0) — сверка на клиенте.
  const serverChecked = !template && report.verified_numbers.total > 0
  const verified = serverChecked ? report.verified_numbers : (localCheck ?? report.verified_numbers)
  const toOptimum = DISTRIBUTION ? result.score - DISTRIBUTION.best : null

  function apply(rec: Recommendation) {
    const key = (d: Decision) => `${d.measure_id}:${d.district}`
    const before = new Set(decisions.map(key))
    const incoming = rec.decisions.filter((d) => !before.has(key(d)))
    const kept = new Set(rec.decisions.map(key))
    // Новые меры встают в гнёзда заменённых — остальные гнёзда не прыгают.
    const queue = [...incoming]
    const next = decisions.map((d) => (kept.has(key(d)) ? d : (queue.shift() ?? d))).filter((d) => rec.decisions.some((r) => key(r) === key(d)))
    setTryOn(null)
    load([...next, ...queue])
    const changed = incoming.map((d) => d.measure_id)
    setScreen('pult')
    flashRecent(changed)
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
      className="grid h-full min-h-[720px] min-w-[1280px] grid-rows-[76px_1fr] overflow-hidden"
    >
      <header className="flex items-center gap-6 border-b border-line bg-panel px-5">
        <button
          type="button"
          onClick={() => setScreen('pult')}
          className="flex h-8 items-center gap-1.5 rounded-chip border border-line px-2.5 text-[12px] hover:border-accent"
          title="На Пульт (Esc)"
        >
          <ArrowLeft size={14} /> Пульт
        </button>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline gap-3">
            <h1 className="font-display text-[20px] font-medium tracking-[-0.01em]">ВЕРДИКТ</h1>
            <span className="num text-[12px] text-ink-2">
              Сценарий #{result.scenario_id} · <span className="text-gold">{result.cost}</span> / {RULES.budget} у.е.
            </span>
          </div>
          <ol className="flex gap-1.5">
            {decisions.map((d) => {
              const m = MEASURE_BY_ID.get(d.measure_id)!
              return (
                <li key={d.measure_id} className="num flex h-[22px] items-center overflow-hidden rounded-chip border border-line text-[10px]" title={m.name_ru}>
                  <span className="h-full w-[3px]" style={{ background: DIRECTION_COLOR[m.direction] }} />
                  <span className="px-1.5">
                    {d.measure_id} · {districtName(d.district)}
                  </span>
                </li>
              )
            })}
          </ol>
        </div>

        <div className="ml-auto flex items-center gap-4">
          <div className="text-right">
            <div className="caps text-[10px]">Astana Quality of Life Score</div>
            <div className="num text-[11px] text-ink-2">
              {result.percentile !== null && <>лучше ≈{fmtPct(result.percentile)} сценариев</>}
              {toOptimum !== null && <> · до оптимума {fmtSigned(toOptimum)}</>}
            </div>
          </div>
          <span className="num text-[16px] text-ink-2">{fmt2(result.baseline)} →</span>
          <AnimatedNumber value={result.score} from={result.baseline} className="font-display text-[44px] font-medium leading-none tracking-[-0.02em] tabular-nums" />
          <div className="num flex flex-col text-[13px] leading-tight">
            <span style={{ color: signColor(result.delta) }}>{fmtSigned(result.delta)}</span>
            {tryState && (
              <span className="border-b border-dashed border-accent text-accent" title={tryOn?.change}>
                → {fmt2(tryState.score)}
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="grid min-h-0 grid-cols-[54fr_46fr]">
        <section className="grid min-h-0 grid-rows-[1fr_auto_auto] border-r border-line bg-panel">
          <QuarterPair state={finalState} ghost={tryState} highlight={highlight.district} />
          <figure className="border-t border-line px-4 pb-1 pt-2">
            <figcaption className="flex items-baseline justify-between">
              <span className="caps text-[10px]">Вклад мер · Шепли</span>
              <span className="num text-[9px] text-ink-2">порядок M1…M14 · синергии и снятие крит. пар распределены по мерам · Σ = {fmtSigned(result.delta)}</span>
            </figcaption>
            <div className="h-[150px]">
              <ContributionWaterfall result={result} decisions={decisions} highlight={highlight.measure} />
            </div>
          </figure>
          <figure className="border-t border-line px-4 pb-2 pt-2">
            <figcaption className="caps text-[10px]">Районы · D до → после (толщина — доля населения)</figcaption>
            <div className="h-[130px]">
              <DistrictSlope result={result} highlight={highlight.district} />
            </div>
          </figure>
        </section>

        <section className="flex min-h-0 flex-col bg-bg">
          <AgentTrace steps={trace} running={status === 'running'} offline={forceOffline} onOfflineChange={setForceOffline} />
          <div className="flex items-center gap-2 border-b border-line bg-panel px-4 py-1.5">
            <span className="caps text-[10px]">Записка акиму</span>
            <span className="num rounded-chip border border-line px-1.5 text-[10px] text-ink-2">
              {providerLabel(template, report.provider, report.model)}
            </span>
            <VerifiedBadge verified={verified} />
            {status === 'running' && mode === 'ai' && <span className="text-[11px] text-ink-2">агент готовит записку — пока шаблон на числах движка</span>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <MemoDocument
              report={report}
              numbers={numbers}
              scenarioId={result.scenario_id}
              serverVerified={serverChecked}
              onApply={apply}
              onTry={setTryOn}
              onChipHover={setChip}
            />
          </div>
          <div className="flex items-center gap-2 border-t border-line bg-panel px-4 py-2">
            {stale && <span className="text-[11px] text-ink-2">набор на Пульте изменён</span>}
            <button
              type="button"
              onClick={() => void run(mode, stale && validateDecisions(current).length === 0 ? current : decisions)}
              className="ml-auto flex h-8 items-center gap-1.5 rounded-chip border border-line px-3 text-[12px] hover:border-accent"
            >
              <RefreshCw size={13} /> Переанализировать
            </button>
            {mode === 'calc' && (
              <button
                type="button"
                onClick={() => void run('ai', decisions)}
                className="h-8 rounded-chip bg-accent px-3 text-[12px] font-medium text-panel"
              >
                AI-анализ
              </button>
            )}
          </div>
        </section>
      </div>
    </motion.div>
  )
}
