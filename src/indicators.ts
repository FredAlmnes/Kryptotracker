import type { LineData, UTCTimestamp } from 'lightweight-charts'

export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
}

// Alle *Values-funksjoner returnerer et array like langt som input, med NaN før de er "varme".

export const closes = (c: Candle[]) => c.map((x) => x.close)

export function smaValues(v: number[], period: number): number[] {
  const out = new Array<number>(v.length).fill(NaN)
  let sum = 0
  for (let i = 0; i < v.length; i++) {
    sum += v[i]
    if (i >= period) sum -= v[i - period]
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

export function emaValues(v: number[], period: number): number[] {
  const out = new Array<number>(v.length).fill(NaN)
  if (v.length < period) return out
  const k = 2 / (period + 1)
  let prev = v.slice(0, period).reduce((a, b) => a + b, 0) / period
  out[period - 1] = prev
  for (let i = period; i < v.length; i++) {
    prev = v[i] * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

// Wilders utjevning, startet med snittet av de første `period` verdiene fra `start`
function wilder(v: number[], period: number, start: number): number[] {
  const out = new Array<number>(v.length).fill(NaN)
  if (v.length < start + period) return out
  let prev = 0
  for (let i = start; i < start + period; i++) prev += v[i]
  prev /= period
  out[start + period - 1] = prev
  for (let i = start + period; i < v.length; i++) {
    prev = (prev * (period - 1) + v[i]) / period
    out[i] = prev
  }
  return out
}

export function rsiValues(v: number[], period = 14): number[] {
  const gains = v.map((x, i) => (i === 0 ? 0 : Math.max(x - v[i - 1], 0)))
  const losses = v.map((x, i) => (i === 0 ? 0 : Math.max(v[i - 1] - x, 0)))
  const g = wilder(gains, period, 1)
  const l = wilder(losses, period, 1)
  return g.map((gi, i) => (Number.isNaN(gi) ? NaN : l[i] === 0 ? 100 : 100 - 100 / (1 + gi / l[i])))
}

const trueRange = (c: Candle[]) =>
  c.map((x, i) =>
    i === 0
      ? x.high - x.low
      : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1].close), Math.abs(x.low - c[i - 1].close)),
  )

export function atrValues(c: Candle[], period = 14): number[] {
  return wilder(trueRange(c), period, 1)
}

// ADX: styrken på trenden (ikke retningen). Over ~20–25 = trendende marked.
export function adxValues(c: Candle[], period = 14): number[] {
  const plusDM = c.map((x, i) => {
    if (i === 0) return 0
    const up = x.high - c[i - 1].high
    const down = c[i - 1].low - x.low
    return up > down && up > 0 ? up : 0
  })
  const minusDM = c.map((x, i) => {
    if (i === 0) return 0
    const up = x.high - c[i - 1].high
    const down = c[i - 1].low - x.low
    return down > up && down > 0 ? down : 0
  })
  const tr = wilder(trueRange(c), period, 1)
  const pdm = wilder(plusDM, period, 1)
  const mdm = wilder(minusDM, period, 1)
  const dx = tr.map((t, i) => {
    if (Number.isNaN(t) || t === 0) return NaN
    const pdi = (100 * pdm[i]) / t
    const mdi = (100 * mdm[i]) / t
    return pdi + mdi === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / (pdi + mdi)
  })
  const first = dx.findIndex((x) => !Number.isNaN(x))
  if (first < 0) return dx
  const adx = wilder(dx.slice(first), period, 0)
  return [...new Array<number>(first).fill(NaN), ...adx]
}

// Topper og bunner: en topp har `n` lavere lys på hver side.
// NB: den er først kjent n lys senere (confirmedAt) – bruk det i backtester.
export interface Swing {
  index: number
  confirmedAt: number
  price: number
  type: 'high' | 'low'
}

export function swings(c: Candle[], n = 5): Swing[] {
  const out: Swing[] = []
  for (let i = n; i < c.length - n; i++) {
    let high = true
    let low = true
    for (let j = i - n; j <= i + n && (high || low); j++) {
      if (j === i) continue
      // likt nivå: den første teller
      if (j < i ? c[j].high >= c[i].high : c[j].high > c[i].high) high = false
      if (j < i ? c[j].low <= c[i].low : c[j].low < c[i].low) low = false
    }
    if (high) out.push({ index: i, confirmedAt: i + n, price: c[i].high, type: 'high' })
    if (low) out.push({ index: i, confirmedAt: i + n, price: c[i].low, type: 'low' })
  }
  return out
}

// Fair value gap: gap mellom lys i-2 og lys i som lys i-1 hoppet over.
export interface Fvg {
  index: number // lyset som fullfører gapet
  side: 'bull' | 'bear'
  top: number
  bottom: number
  filledAt: number | null // når kursen har lukket gapet helt
}

export function fvgs(c: Candle[], minAtr = 0.3): Fvg[] {
  const atr = atrValues(c)
  const out: Fvg[] = []
  for (let i = 2; i < c.length; i++) {
    const min = Number.isNaN(atr[i]) ? 0 : atr[i] * minAtr
    let gap: Fvg | null = null
    if (c[i].low - c[i - 2].high > min)
      gap = { index: i, side: 'bull', bottom: c[i - 2].high, top: c[i].low, filledAt: null }
    else if (c[i - 2].low - c[i].high > min)
      gap = { index: i, side: 'bear', bottom: c[i].high, top: c[i - 2].low, filledAt: null }
    if (!gap) continue
    for (let j = i + 1; j < c.length; j++) {
      if (gap.side === 'bull' ? c[j].low <= gap.bottom : c[j].high >= gap.top) {
        gap.filledAt = j
        break
      }
    }
    out.push(gap)
  }
  return out
}

// --- Til grafen ---
export const toLine = (c: Candle[], values: number[]): LineData<UTCTimestamp>[] =>
  values.flatMap((value, i) =>
    Number.isFinite(value) ? [{ time: c[i].time as UTCTimestamp, value }] : [],
  )

export const sma = (c: Candle[], period: number) => toLine(c, smaValues(closes(c), period))
export const ema = (c: Candle[], period: number) => toLine(c, emaValues(closes(c), period))
export const rsi = (c: Candle[], period = 14) => toLine(c, rsiValues(closes(c), period))
