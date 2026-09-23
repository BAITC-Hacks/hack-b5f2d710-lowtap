import { DISTRICTS, RULES, districtName } from '../../engine/catalog'
import { DISTRICT_COLOR, MAP_STEPS } from '../../lib/colors'
import { useUi, type MapIndicator } from '../../store/ui'
import { INDICATOR_CODES } from '../../types/data'

const OPTIONS: { key: MapIndicator; label: string; title: string }[] = [
  { key: 'D', label: 'D', title: 'Индекс района D = Σ w·I' },
  ...INDICATOR_CODES.map((code) => ({ key: code, label: code, title: RULES.indicators.find((i) => i.code === code)!.name_ru })),
  { key: 'delta', label: 'Δ', title: 'Изменение D района к базе' },
]

/** Плавающая легенда: показатель заливки, шкала 40–80, образец штриховки «<40». */
export function MapLegend() {
  const indicator = useUi((s) => s.indicator)
  const setIndicator = useUi((s) => s.setIndicator)
  const lang = useUi((s) => s.lang)

  return (
    <div className="absolute bottom-3 left-3 flex flex-col gap-1.5 rounded-chip border border-line bg-panel px-2 py-1.5">
      <div className="flex" role="radiogroup" aria-label="Показатель на карте">
        {OPTIONS.map((o, idx) => {
          const active = o.key === indicator
          const gap = idx === 1 || idx === OPTIONS.length - 1
          return (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={active}
              title={o.title}
              onClick={() => setIndicator(o.key)}
              className="num h-5 min-w-[22px] px-1 text-[10px]"
              style={{
                marginLeft: gap ? 6 : 0,
                color: active ? 'var(--panel)' : 'var(--ink-2)',
                background: active ? 'var(--accent)' : 'transparent',
                borderRadius: 3,
              }}
            >
              {o.label}
            </button>
          )
        })}
      </div>
      <div className="flex items-end gap-3">
        {indicator === 'D' ? (
          <div className="flex flex-wrap gap-x-2.5 gap-y-1" style={{ maxWidth: 230 }}>
            {DISTRICTS.map((d) => (
              <span key={d.id} className="flex items-center gap-1 text-[10px] text-ink-2">
                <span
                  className="h-2.5 w-2.5 rounded-[2px]"
                  style={{ background: DISTRICT_COLOR[d.id].fill, outline: `1px solid ${DISTRICT_COLOR[d.id].line}` }}
                />
                {districtName(d.id, lang)}
              </span>
            ))}
          </div>
        ) : indicator === 'delta' ? (
          <div className="flex flex-col gap-0.5">
            <div className="h-2 w-[150px] rounded-[2px]" style={{ background: 'linear-gradient(90deg, #C2452F, #FFFFFF, #1F8A64)', outline: '1px solid var(--line)' }} />
            <div className="num flex justify-between text-[9px] text-ink-2">
              <span>−3</span>
              <span>0</span>
              <span>+3</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            <div className="flex">
              {MAP_STEPS.map((c) => (
                <span key={c} className="h-2 w-[30px]" style={{ background: c }} />
              ))}
            </div>
            <div className="num flex w-[150px] justify-between text-[9px] text-ink-2">
              {[40, 48, 56, 64, 72, 80].map((v) => (
                <span key={v}>{v}</span>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center gap-1.5 pb-2.5">
          <svg width="14" height="10" aria-hidden>
            <defs>
              <pattern id="legend-hatch" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="4" style={{ stroke: 'var(--down)', strokeWidth: 1.5 }} />
              </pattern>
            </defs>
            <rect width="14" height="10" fill="url(#legend-hatch)" style={{ stroke: 'var(--down)', strokeWidth: 0.5 }} />
          </svg>
          <span className="text-[10px] text-ink-2">&lt;40 критично</span>
        </div>
      </div>
    </div>
  )
}
