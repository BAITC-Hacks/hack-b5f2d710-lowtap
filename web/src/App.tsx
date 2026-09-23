import { MotionConfig } from 'motion/react'
import { Component, lazy, Suspense, useEffect, type ReactNode } from 'react'
import { probeBackend } from './lib/api'
import { buildHash, parseHash } from './lib/permalink'
import { Pult } from './screens/Pult'
import { useScenario } from './store/scenario'
import { useUi } from './store/ui'

// Вердикт и Сравнение подгружаются отдельным чанком: демо открывается сразу на Пульте.
const Verdict = lazy(() => import('./screens/Verdict').then((m) => ({ default: m.Verdict })))
const Compare = lazy(() => import('./screens/Compare').then((m) => ({ default: m.Compare })))

/** Экран и набор ↔ location.hash (пермалинк без роутера). */
function useHashSync() {
  useEffect(() => {
    const apply = () => {
      const { screen, decisions } = parseHash(window.location.hash)
      useUi.getState().setScreen(screen)
      if (decisions) useScenario.getState().load(decisions)
    }
    apply()
    window.addEventListener('hashchange', apply)

    const write = () => {
      const hash = buildHash(useUi.getState().screen, useScenario.getState().decisions)
      if (hash !== window.location.hash) window.history.replaceState(null, '', hash)
    }
    const unsubScenario = useScenario.subscribe(write)
    const unsubUi = useUi.subscribe((s, prev) => s.screen !== prev.screen && write())
    return () => {
      window.removeEventListener('hashchange', apply)
      unsubScenario()
      unsubUi()
    }
  }, [])
}

/** Сбой рендера не оставляет пустой экран: причина и возврат на Пульт. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex h-full items-center justify-center bg-bg">
        <div className="max-w-[420px] border border-line bg-panel p-6">
          <h1 className="caps mb-2 text-[11px] text-down">Сбой интерфейса</h1>
          <p className="mb-4 text-[13px] text-ink">
            Экран не отрисовался: <span className="num text-ink-2">{this.state.error.message}</span>. Набор решений сохранён в ссылке.
          </p>
          <button
            type="button"
            onClick={() => {
              useUi.getState().setScreen('pult')
              this.setState({ error: null })
            }}
            className="h-8 rounded-chip bg-accent px-3 text-[12px] font-medium text-panel"
          >
            Вернуться на Пульт
          </button>
        </div>
      </div>
    )
  }
}

export default function App() {
  useHashSync()
  useEffect(() => {
    void probeBackend()
  }, [])
  const screen = useUi((s) => s.screen)

  return (
    <MotionConfig reducedMotion="user">
      <ErrorBoundary>
        <Suspense fallback={null}>{screen === 'verdict' ? <Verdict /> : screen === 'compare' ? <Compare /> : <Pult />}</Suspense>
      </ErrorBoundary>
    </MotionConfig>
  )
}
