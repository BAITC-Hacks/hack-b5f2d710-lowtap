// Единый формат чисел проекта (VISUAL_SPEC §2.2): Score и дельты — 2 знака со знаком,
// показатели — 1 знак, стоимость — целое. Минус — типографский U+2212.

export const MINUS = '−'

function fixed(x: number, digits: number): string {
  const s = x.toFixed(digits)
  // −0.00 → 0.00: знак у нуля ничего не сообщает.
  if (Number(s) === 0) return (0).toFixed(digits)
  return s.replace('-', MINUS)
}

/** 56.543 → «56.54». */
export function fmt2(x: number): string {
  return fixed(x, 2)
}

/** Показатель: 43.75 → «43.8». */
export function fmt1(x: number): string {
  return fixed(x, 1)
}

/** Дельта со знаком: 3.985 → «+3.99», −0.87 → «−0.87», 0 → «0.00». */
export function fmtSigned(x: number, digits = 2): string {
  const s = fixed(x, digits)
  return Number(s.replace(MINUS, '-')) > 0 ? `+${s}` : s
}

/** Стоимость в у.е.: целое. */
export function fmtCost(x: number): string {
  return Math.round(x).toString()
}

/** Проценты: 99.9234 → «99.92%»; у самой вершины (> 99.99) — больше знаков, чтобы не округлить в «100%». */
export function fmtPct(x: number, digits = 2): string {
  const d = x > 99.99 && x < 100 ? Math.max(digits, 4) : digits
  return `${fixed(x, d)}%`
}

/** Доля населения: 0.27 → «27%». */
export function fmtShare(x: number): string {
  return `${Math.round(x * 100)}%`
}

/**
 * Десятичные числа в тексте записки — тот же регэксп, что в guard бэкенда:
 * `[+−\-–]?\d+[.,]\d{1,2}`; целые не проверяются.
 */
export const DECIMAL_RE = /[+−\-–]?\d+[.,]\d{1,2}/g

/** «−3,98» / «–3.98» / «+3.98» → число. */
export function normalizeNumber(raw: string): number {
  return Number(raw.replace(',', '.').replace(/[−–]/, '-').replace('+', ''))
}

export interface DecimalMatch {
  raw: string
  value: number
  index: number
}

export function extractDecimals(text: string): DecimalMatch[] {
  return [...text.matchAll(DECIMAL_RE)].map((m) => ({ raw: m[0], value: normalizeNumber(m[0]), index: m.index }))
}
