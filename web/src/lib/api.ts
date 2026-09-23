// Клиент бэкенда (docs/tasks/CODEX_BACKEND.md §7). Фронт работает и без него:
// недоступный /api помечает связь «офлайн», а withFallback прозрачно уходит в локальный движок.

import { useUi } from '../store/ui'
import type {
  AnalysisReport,
  ApiConfig,
  Health,
  InvalidResponse,
  Scenario,
  TraceStep,
  ValidateResponse,
  Violation,
} from '../types/api'
import { readSSE } from './sse'

const BASE = '/api'
const TIMEOUT_MS = 8000
const PROBE_TIMEOUT_MS = 1500
/** Как часто при офлайне снова пробовать бэкенд. */
const RETRY_OFFLINE_MS = 15000

/** Бэкенд недоступен: сеть, таймаут, 5xx или не-JSON вместо API (например, dev-сервер без прокси). */
export class OfflineError extends Error {}

/** Бэкенд ответил, но не так, как ждали (4xx кроме 422). */
export class ApiError extends Error {
  readonly status: number
  readonly body: unknown
  constructor(status: number, body: unknown) {
    super(`API ${status}`)
    this.status = status
    this.body = body
  }
}

/** Ответ на набор: результат или причины невалидности (422, Score не считается). */
export type Outcome<T> = { ok: true; data: T } | { ok: false; violations: Violation[] }

let lastOfflineAt = 0

function markOffline() {
  lastOfflineAt = Date.now()
  useUi.getState().setBackend('offline')
}

function markOnline(health?: Health) {
  useUi.getState().setBackend('online', health)
}

interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  query?: Record<string, string>
  timeoutMs?: number
  signal?: AbortSignal
}

async function send(path: string, opts: RequestOptions = {}): Promise<Response> {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS)
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
  const query = opts.query ? `?${new URLSearchParams(opts.query)}` : ''
  let response: Response
  try {
    response = await fetch(`${BASE}${path}${query}`, {
      method: opts.method ?? 'GET',
      headers: opts.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal,
    })
  } catch (err) {
    if (opts.signal?.aborted) throw err
    markOffline()
    throw new OfflineError(err instanceof Error ? err.message : String(err))
  }
  if (response.status >= 500) {
    markOffline()
    throw new OfflineError(`API ${response.status}`)
  }
  return response
}

async function json<T>(response: Response): Promise<T> {
  if (!response.headers.get('content-type')?.includes('json')) {
    markOffline()
    throw new OfflineError('ответ не JSON')
  }
  return (await response.json()) as T
}

async function outcome<T>(response: Response): Promise<Outcome<T>> {
  if (response.status === 422) return { ok: false, violations: (await json<InvalidResponse>(response)).violations }
  if (!response.ok) throw new ApiError(response.status, await response.text())
  markOnline()
  return { ok: true, data: await json<T>(response) }
}

/** Быстрая проверка связи; результат пишется в useUi().backend. */
export async function probeBackend(): Promise<Health | null> {
  try {
    const response = await send('/health', { timeoutMs: PROBE_TIMEOUT_MS })
    if (!response.ok) throw new OfflineError(`API ${response.status}`)
    const health = await json<Health>(response)
    markOnline(health)
    return health
  } catch {
    markOffline()
    return null
  }
}

export async function getConfig(): Promise<ApiConfig> {
  const response = await send('/config')
  if (!response.ok) throw new ApiError(response.status, await response.text())
  return json<ApiConfig>(response)
}

export async function validate(scenario: Scenario): Promise<ValidateResponse> {
  const response = await send('/validate', { method: 'POST', body: scenario })
  if (response.status !== 200 && response.status !== 422) throw new ApiError(response.status, await response.text())
  return json<ValidateResponse>(response)
}

export async function evaluate<T>(scenario: Scenario): Promise<Outcome<T>> {
  return outcome<T>(await send('/evaluate', { method: 'POST', body: scenario }))
}

export type AnalyzeProvider = 'auto' | 'rules'

export async function analyze(scenario: Scenario, provider: AnalyzeProvider = 'auto'): Promise<Outcome<AnalysisReport>> {
  const response = await send('/analyze', {
    method: 'POST',
    body: scenario,
    query: { stream: '0', provider },
    // LLM-цепочка на сервере сама падает в rules; здесь ждём дольше обычного.
    timeoutMs: provider === 'rules' ? TIMEOUT_MS : 130_000,
  })
  return outcome<AnalysisReport>(response)
}

export interface AnalyzeHandlers {
  onTrace?: (step: TraceStep) => void
  onReport?: (report: AnalysisReport) => void
}

/** AI-анализ со стримингом трассы: события trace → report → done. */
export async function analyzeStream(
  scenario: Scenario,
  handlers: AnalyzeHandlers = {},
  opts: { provider?: AnalyzeProvider; signal?: AbortSignal } = {},
): Promise<Outcome<AnalysisReport>> {
  const response = await send('/analyze', {
    method: 'POST',
    body: scenario,
    query: { stream: '1', provider: opts.provider ?? 'auto' },
    timeoutMs: 130_000,
    signal: opts.signal,
  })
  if (response.status === 422 || !response.body || !response.headers.get('content-type')?.includes('event-stream')) {
    return outcome<AnalysisReport>(response)
  }
  markOnline()
  const result: { report?: AnalysisReport } = {}
  try {
    await readSSE(response.body, ({ event, data }) => {
      if (event === 'trace') handlers.onTrace?.(JSON.parse(data) as TraceStep)
      if (event === 'report') {
        result.report = JSON.parse(data) as AnalysisReport
        handlers.onReport?.(result.report)
      }
    })
  } catch (err) {
    if (opts.signal?.aborted) throw err
    throw new OfflineError(err instanceof Error ? err.message : String(err))
  }
  if (!result.report) throw new OfflineError('поток анализа закончился без отчёта')
  return { ok: true, data: result.report }
}

export type Source = 'server' | 'local'

/**
 * Сервер, если он доступен, иначе — локальный движок. Пока бэкенд недавно был офлайн,
 * сеть не дёргаем: ответ приходит сразу из локального режима.
 */
export async function withFallback<T>(remote: () => Promise<T>, local: () => T | Promise<T>): Promise<{ data: T; source: Source }> {
  const offline = useUi.getState().backend === 'offline' && Date.now() - lastOfflineAt < RETRY_OFFLINE_MS
  if (!offline) {
    try {
      return { data: await remote(), source: 'server' }
    } catch (err) {
      if (!(err instanceof OfflineError)) throw err
    }
  }
  return { data: await local(), source: 'local' }
}
