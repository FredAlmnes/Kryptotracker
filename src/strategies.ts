import {
  adxValues,
  atrValues,
  closes,
  emaValues,
  rsiValues,
  smaValues,
  swings,
  type Candle,
  type Swing,
} from './indicators'

export type Side = 'long' | 'short'

export interface Position {
  side: Side
  entryIndex: number
  entry: number
  stop: number
  target?: number
}

export type Action =
  | { type: 'enter'; side: Side; stop: number; target?: number; reason: string }
  | { type: 'exit'; reason: string }
  | { type: 'stop'; stop: number } // flytt stop (trailing)
  | null

export interface StrategyRunner {
  update?(i: number): void // kalles én gang per lukket lys, før decide
  decide(i: number, pos: Position | null): Action
}

export interface Strategy {
  id: string
  name: string
  interval: string // intervallet strategien er laget for
  rules: string[]
  warmup: number
  prepare(c: Candle[], opts: { allowShort: boolean }): StrategyRunner
}

const crossUp = (a: number[], b: number[], i: number) => a[i - 1] <= b[i - 1] && a[i] > b[i]
const crossDown = (a: number[], b: number[], i: number) => a[i - 1] >= b[i - 1] && a[i] < b[i]

export interface EmaTrendParams {
  fast: number
  slow: number
  atrMult: number
}
export const EMA_DEFAULTS: EmaTrendParams = { fast: 20, slow: 50, atrMult: 2.5 }

export function makeEmaTrend(p: EmaTrendParams = EMA_DEFAULTS): Strategy {
  const { fast, slow, atrMult: M } = p
  const isDefault = fast === EMA_DEFAULTS.fast && slow === EMA_DEFAULTS.slow && M === EMA_DEFAULTS.atrMult
  return {
    id: isDefault ? 'ema-trend' : `ema-trend-${fast}-${slow}-${M}`,
    name: isDefault ? 'Filtrert EMA-trend' : `EMA-trend ${fast}/${slow}`,
    interval: '4h',
    rules: [
      `Kjøp: EMA ${fast} krysser over EMA ${slow} og kursen er over SMA 200`,
      `Short: EMA ${fast} krysser under EMA ${slow}, kursen under SMA 200 og ADX > 20`,
      `Stop: ${String(M).replace('.', ',')} × ATR, flyttes etter kursen (trailing)`,
      'Exit: stop eller motsatt EMA-kryss',
    ],
    warmup: Math.max(200, slow),
    prepare(c, { allowShort }) {
      const cl = closes(c)
      const eF = emaValues(cl, fast)
      const eS = emaValues(cl, slow)
      const s200 = smaValues(cl, 200)
      const atr = atrValues(c, 14)
      const adx = adxValues(c, 14)
      return {
        decide(i, pos) {
          const close = cl[i]
          if (pos) {
            if (pos.side === 'long' && crossDown(eF, eS, i)) return { type: 'exit', reason: 'EMA-kryss ned' }
            if (pos.side === 'short' && crossUp(eF, eS, i)) return { type: 'exit', reason: 'EMA-kryss opp' }
            const trail =
              pos.side === 'long' ? Math.max(pos.stop, close - M * atr[i]) : Math.min(pos.stop, close + M * atr[i])
            return trail !== pos.stop ? { type: 'stop', stop: trail } : null
          }
          if (crossUp(eF, eS, i) && close > s200[i])
            return { type: 'enter', side: 'long', stop: close - M * atr[i], reason: `EMA ${fast}/${slow} kryss opp over SMA 200` }
          if (allowShort && crossDown(eF, eS, i) && close < s200[i] && adx[i] > 20)
            return { type: 'enter', side: 'short', stop: close + M * atr[i], reason: `EMA ${fast}/${slow} kryss ned under SMA 200` }
          return null
        },
      }
    },
  }
}

const emaTrend = makeEmaTrend()

const fvgStructure: Strategy = {
  id: 'fvg-structure',
  name: 'FVG-retest i trendretning',
  interval: '1h',
  rules: [
    'Struktur: brudd over siste bekreftede topp = opptrend, under siste bunn = nedtrend',
    'Kjøp: i opptrend, kursen tester et åpent bullish FVG og lukker over det',
    'Short: i nedtrend, kursen tester et åpent bearish FVG og lukker under det',
    'Stop: rett utenfor gapet. Mål: 2 × risikoen (2R). Exit også hvis strukturen snur',
  ],
  warmup: 50,
  prepare(c, { allowShort }) {
    const atr = atrValues(c, 14)
    const N = 5
    const byConfirm = new Map<number, Swing[]>()
    for (const s of swings(c, N)) byConfirm.set(s.confirmedAt, [...(byConfirm.get(s.confirmedAt) ?? []), s])

    let trend: 'up' | 'down' | null = null
    let lastHigh: number | null = null
    let lastLow: number | null = null
    let gaps: { side: 'bull' | 'bear'; top: number; bottom: number; index: number }[] = []

    return {
      update(i) {
        for (const s of byConfirm.get(i) ?? []) {
          if (s.type === 'high') lastHigh = s.price
          else lastLow = s.price
        }
        const close = c[i].close
        if (lastHigh !== null && close > lastHigh) {
          trend = 'up'
          lastHigh = null
        }
        if (lastLow !== null && close < lastLow) {
          trend = 'down'
          lastLow = null
        }
        const min = 0.3 * atr[i]
        if (c[i].low - c[i - 2].high > min) gaps.push({ side: 'bull', bottom: c[i - 2].high, top: c[i].low, index: i })
        if (c[i - 2].low - c[i].high > min) gaps.push({ side: 'bear', bottom: c[i].high, top: c[i - 2].low, index: i })
        // fjern gamle og ugyldige gap
        gaps = gaps.filter(
          (g) => i - g.index <= 30 && (g.side === 'bull' ? close >= g.bottom : close <= g.top),
        )
      },
      decide(i, pos) {
        const x = c[i]
        if (pos) {
          if (pos.side === 'long' && trend === 'down') return { type: 'exit', reason: 'Struktur snudde ned' }
          if (pos.side === 'short' && trend === 'up') return { type: 'exit', reason: 'Struktur snudde opp' }
          return null
        }
        for (const g of gaps) {
          if (g.index >= i) continue
          if (g.side === 'bull' && trend === 'up' && x.low <= g.top && x.close > g.top) {
            gaps = gaps.filter((o) => o !== g)
            const stop = g.bottom - 0.1 * atr[i]
            return { type: 'enter', side: 'long', stop, target: x.close + 2 * (x.close - stop), reason: 'Retest av bullish FVG' }
          }
          if (allowShort && g.side === 'bear' && trend === 'down' && x.high >= g.bottom && x.close < g.bottom) {
            gaps = gaps.filter((o) => o !== g)
            const stop = g.top + 0.1 * atr[i]
            return { type: 'enter', side: 'short', stop, target: x.close - 2 * (stop - x.close), reason: 'Retest av bearish FVG' }
          }
        }
        return null
      },
    }
  },
}

const rsiReversion: Strategy = {
  id: 'rsi-reversion',
  name: 'RSI 30/70 med trendfilter',
  interval: '1h',
  rules: [
    'Kjøp: RSI krysser opp over 30 og kursen er over SMA 200',
    'Short: RSI krysser ned under 70 og kursen er under SMA 200',
    'Exit: RSI tilbake til 55 (long) / 45 (short), eller stop på 2 × ATR',
  ],
  warmup: 200,
  prepare(c, { allowShort }) {
    const cl = closes(c)
    const r = rsiValues(cl, 14)
    const s200 = smaValues(cl, 200)
    const atr = atrValues(c, 14)
    return {
      decide(i, pos) {
        if (pos) {
          if (pos.side === 'long' && r[i] >= 55) return { type: 'exit', reason: 'RSI nådde 55' }
          if (pos.side === 'short' && r[i] <= 45) return { type: 'exit', reason: 'RSI nådde 45' }
          return null
        }
        if (r[i - 1] < 30 && r[i] >= 30 && cl[i] > s200[i])
          return { type: 'enter', side: 'long', stop: cl[i] - 2 * atr[i], reason: 'RSI opp over 30' }
        if (allowShort && r[i - 1] > 70 && r[i] <= 70 && cl[i] < s200[i])
          return { type: 'enter', side: 'short', stop: cl[i] + 2 * atr[i], reason: 'RSI ned under 70' }
        return null
      },
    }
  },
}

export const STRATEGIES: Strategy[] = [emaTrend, fvgStructure, rsiReversion]
