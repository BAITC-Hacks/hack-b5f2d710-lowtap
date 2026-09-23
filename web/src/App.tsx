import { useEffect } from 'react'
import { probeBackend } from './lib/api'
import { buildHash, parseHash } from './lib/permalink'
import { Pult } from './screens/Pult'
import { useScenario } from './store/scenario'
import { useUi } from './store/ui'

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

export default function App() {
  useHashSync()
  useEffect(() => {
    void probeBackend()
  }, [])

  return <Pult />
}
