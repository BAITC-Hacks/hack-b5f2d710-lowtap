import { useUi } from '../../store/ui'

const TABS = [
  { key: 'timeline', label: '8 кварталов' },
  { key: 'matrix', label: 'Матрица 5×10' },
] as const

/** Нижняя полоса (каркас F0): вкладки таймлайна и матрицы; содержимое — F3. */
export function BottomPanel() {
  const tab = useUi((s) => s.bottomTab)
  const toggle = useUi((s) => s.toggleBottomTab)

  return (
    <section className="col-span-3 flex flex-col border-t border-line bg-panel">
      <div className="flex h-7 items-center gap-4 border-b border-line px-4" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => tab !== t.key && toggle()}
            className="caps h-full border-b-2 text-[10px]"
            style={{ borderColor: tab === t.key ? 'var(--accent)' : 'transparent', color: tab === t.key ? 'var(--ink)' : undefined }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1" />
      <p className="num border-t border-line px-4 py-1 text-[10px] text-ink-2">
        к кварталу q: эффект × max(0, q−L)/8 · в Q8 = формула ТЗ · Space play · Esc отмена · Ctrl+Z undo · M матрица
      </p>
    </section>
  )
}
