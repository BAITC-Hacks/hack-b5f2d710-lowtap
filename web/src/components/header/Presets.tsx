import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { PRESETS } from '../../engine/presets'
import { fmt2 } from '../../lib/format'
import { useScenario } from '../../store/scenario'
import { useUi } from '../../store/ui'

/** Меню пресетов: числа в строках посчитаны движком при загрузке, не захардкожены. */
export function Presets() {
  const [open, setOpen] = useState(false)
  const load = useScenario((s) => s.load)
  const cancel = useUi((s) => s.cancel)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-[26px] items-center gap-1 rounded-chip border border-line px-2 text-[12px] text-ink hover:border-accent"
      >
        Пресеты <ChevronDown size={14} />
      </button>
      {open && (
        <ul role="menu" className="absolute right-0 top-[30px] z-40 w-[250px] border border-line bg-panel py-1">
          {PRESETS.map((p) => (
            <li key={p.id} role="none">
              <button
                type="button"
                role="menuitem"
                data-preset={p.id}
                onClick={() => {
                  cancel()
                  load(p.decisions)
                  setOpen(false)
                }}
                className="flex h-7 w-full items-center justify-between px-3 text-left text-[12px] hover:bg-bg"
              >
                <span style={{ color: p.score === null ? 'var(--down)' : undefined }}>{p.label}</span>
                <span className="num text-[11px] text-ink-2">
                  {p.score === null ? '—' : fmt2(p.score)} / <span className="text-gold">{p.cost}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
