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
  warmupFor?(barSeconds: number): number // når warmup avhenger av intervallet
  trailAtr?: number // strategien bruker trailing stop på N × ATR
  prepare(c: Candle[], opts: { allowShort: boolean }): StrategyRunner
}

// Sekunder per lys, utledet fra dataene
export const barSeconds = (c: Candle[]) => (c.length > 1 ? c[1].time - c[0].time : 86400)
export const warmupOf = (s: Strategy, c: Candle[]) => s.warmupFor?.(barSeconds(c)) ?? s.warmup

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
    trailAtr: M,
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

// Ligg inne så lenge den store trenden er opp, gå til cash når den knekker.
// Snittet er alltid 50 dager, uansett intervall (på 4t = 300 lys).
const REGIME_DAYS = 50
const REGIME_BUFFER = 0.03
const regimeBars = (sec: number) => Math.max(1, Math.round((REGIME_DAYS * 86400) / sec))

const trendRegime: Strategy = {
  id: 'trend-regime',
  name: 'Trendregime (hold, men unngå nedtrender)',
  interval: '1d',
  rules: [
    `Inne (long) når kursen lukker over ${REGIME_DAYS}-dagers snitt`,
    `Ut i cash når kursen lukker mer enn ${REGIME_BUFFER * 100} % under snittet`,
    'Ingen stop, ingen short: målet er å fange oppturene og slippe de store fallene',
  ],
  warmup: REGIME_DAYS,
  warmupFor: regimeBars,
  prepare(c) {
    const cl = closes(c)
    const ma = smaValues(cl, regimeBars(barSeconds(c)))
    return {
      decide(i, pos) {
        if (Number.isNaN(ma[i])) return null
        if (pos) return cl[i] < ma[i] * (1 - REGIME_BUFFER) ? { type: 'exit', reason: `Under ${REGIME_DAYS}d-snitt` } : null
        return cl[i] > ma[i] ? { type: 'enter', side: 'long', stop: 0, reason: `Over ${REGIME_DAYS}d-snitt` } : null
      },
    }
  },
}

export interface FvgParams {
  maxStopAtr?: number // hopp over oppsett der stopen ligger lenger unna enn dette × ATR
  maxTargetAtr?: number // mål = laveste av 2R og dette × ATR
}

export function makeFvgStructure(p: FvgParams = {}): Strategy {
  const fmt = (n: number) => String(n).replace('.', ',')
  const stopRule = p.maxStopAtr ? ` Hopper over oppsett der stopen er mer enn ${fmt(p.maxStopAtr)} × ATR unna.` : ''
  const targetRule = p.maxTargetAtr ? `Mål: 2R, men maks ${fmt(p.maxTargetAtr)} × ATR` : 'Mål: 2 × risikoen (2R)'
  const variant = [p.maxStopAtr && `stop≤${p.maxStopAtr}`, p.maxTargetAtr && `mål≤${p.maxTargetAtr}`].filter(Boolean).join('-')
  return {
  id: variant ? `fvg-structure-${variant}` : 'fvg-structure',
  name: 'FVG-retest i trendretning',
  interval: '1h',
  rules: [
    'Struktur: brudd over siste bekreftede topp = opptrend, under siste bunn = nedtrend',
    'Kjøp: i opptrend, kursen tester et åpent bullish FVG og lukker over det',
    'Short: i nedtrend, kursen tester et åpent bearish FVG og lukker under det',
    `Stop: rett utenfor gapet.${stopRule} ${targetRule}. Exit også hvis strukturen snur`,
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
            if (p.maxStopAtr && x.close - stop > p.maxStopAtr * atr[i]) continue // for bredt: målet blir urealistisk
            const reach = Math.min(2 * (x.close - stop), p.maxTargetAtr ? p.maxTargetAtr * atr[i] : Infinity)
            return { type: 'enter', side: 'long', stop, target: x.close + reach, reason: 'Retest av bullish FVG' }
          }
          if (allowShort && g.side === 'bear' && trend === 'down' && x.high >= g.bottom && x.close < g.bottom) {
            gaps = gaps.filter((o) => o !== g)
            const stop = g.top + 0.1 * atr[i]
            if (p.maxStopAtr && stop - x.close > p.maxStopAtr * atr[i]) continue
            const reach = Math.min(2 * (stop - x.close), p.maxTargetAtr ? p.maxTargetAtr * atr[i] : Infinity)
            return { type: 'enter', side: 'short', stop, target: x.close - reach, reason: 'Retest av bearish FVG' }
          }
        }
        return null
      },
    }
  },
}
}

const fvgStructure = makeFvgStructure()

// ---------- ICT-modell ----------
// Liquidity sweep → market structure shift med displacement → inngang på 50 % av FVG-en i discount,
// i retning av strukturen på høyere tidsramme. Stop under sweepen, mål på motsatt likviditet.

export interface IctParams {
  htfFactor: number // høyere tidsramme = så mange lys (1t × 4 = 4t, 4t × 6 = 1d)
  swingN: number // lys på hver side for topper/bunner
  sweepWindow: number // lys fra sweep til MSS
  entryWindow: number // lys fra MSS til inngang
  displacementAtr: number // minste kropp på MSS-lyset, i ATR
  minRR: number // minste avstand til mål, i R
  htfFilter: boolean // bare handle i retning av høyere tidsramme
  discount: boolean // long bare i nedre halvdel av området (short i øvre)
  fvgMinAtr: number // minste FVG-størrelse, i ATR
}
export const ICT_DEFAULTS: IctParams = {
  htfFactor: 4,
  swingN: 3,
  sweepWindow: 12,
  entryWindow: 24,
  displacementAtr: 1,
  minRR: 1.5,
  htfFilter: true,
  discount: true,
  fvgMinAtr: 0.2,
}

type Bar = Candle
const mirror = (c: Bar[]): Bar[] => c.map((x) => ({ time: x.time, open: -x.open, high: -x.low, low: -x.high, close: -x.close }))

// Retning på høyere tidsramme per lys: +1 opp, -1 ned, 0 ukjent. Bruker bare HTF-lys som er ferdige.
function htfBias(c: Bar[], factor: number, n: number): number[] {
  const sec = barSeconds(c)
  const span = sec * factor
  const buckets: (Bar & { last: number })[] = []
  for (let i = 0; i < c.length; i++) {
    const start = Math.floor(c[i].time / span) * span
    const b = buckets.at(-1)
    if (b && b.time === start) {
      b.high = Math.max(b.high, c[i].high)
      b.low = Math.min(b.low, c[i].low)
      b.close = c[i].close
      b.last = i
    } else buckets.push({ time: start, open: c[i].open, high: c[i].high, low: c[i].low, close: c[i].close, last: i })
  }
  // bare ferdige bøtter (siste lys i bøtta er det siste lyset i perioden)
  const done = buckets.filter((b) => c[b.last].time + sec >= b.time + span)
  const sw = swings(done, n)
  const byConfirm = new Map<number, Swing[]>()
  for (const x of sw) byConfirm.set(x.confirmedAt, [...(byConfirm.get(x.confirmedAt) ?? []), x])
  const biasAt: number[] = []
  let trend = 0
  let hi: number | null = null
  let lo: number | null = null
  for (let k = 0; k < done.length; k++) {
    for (const x of byConfirm.get(k) ?? []) {
      if (x.type === 'high') hi = x.price
      else lo = x.price
    }
    if (hi !== null && done[k].close > hi) trend = 1
    if (lo !== null && done[k].close < lo) trend = -1
    biasAt.push(trend)
  }
  const out = new Array<number>(c.length).fill(0)
  let k = -1
  for (let i = 0; i < c.length; i++) {
    while (k + 1 < done.length && done[k + 1].last <= i) k++
    out[i] = k >= 0 ? biasAt[k] : 0
  }
  return out
}

interface IctSetup {
  ce: number
  fvgBottom: number
  stop: number
  rangeHigh: number
  armedAt: number
}

// Long-oppsett. Short = samme logikk på speilvendte priser.
function ictLongRunner(c: Bar[], bias: number[], p: IctParams) {
  const atr = atrValues(c, 14)
  const byConfirm = new Map<number, Swing[]>()
  for (const x of swings(c, p.swingN)) byConfirm.set(x.confirmedAt, [...(byConfirm.get(x.confirmedAt) ?? []), x])
  let lows: Swing[] = [] // urørt sell-side likviditet
  let highs: Swing[] = [] // urørt buy-side likviditet
  let lastHigh: Swing | null = null
  let sweep: { low: number; index: number } | null = null
  // brudd funnet; FVG-en fra displacement-lyset er først kjent 1 lys senere, så vi venter inntil 2 lys
  let mss: { index: number; sweepLow: number; sweepIndex: number; atr: number } | null = null
  let setup: IctSetup | null = null

  return {
    update(i: number) {
      const x = c[i]
      for (const s of byConfirm.get(i) ?? []) {
        if (s.type === 'low') lows.push(s)
        else {
          highs.push(s)
          lastHigh = s
        }
      }
      // sweep: wick under en urørt bunn, lukker tilbake over
      const swept = lows.filter((l) => x.low < l.price)
      if (swept.length && x.close > Math.min(...swept.map((l) => l.price))) sweep = { low: x.low, index: i }
      else if (sweep && x.close < sweep.low) sweep = null // ny bunn under sweepen: oppsettet er brutt
      lows = lows.filter((l) => x.low >= l.price && i - l.index < 200)
      highs = highs.filter((h) => x.high <= h.price && i - h.index < 500)

      if (setup && (i - setup.armedAt > p.entryWindow || x.close < setup.fvgBottom)) setup = null
      if (sweep && i - sweep.index > p.sweepWindow) sweep = null

      // MSS: displacement-lys lukker over siste topp etter sweepen
      if (sweep && lastHigh && i > sweep.index && x.close > lastHigh.price && x.close - x.open >= p.displacementAtr * atr[i]) {
        mss = { index: i, sweepLow: sweep.low, sweepIndex: sweep.index, atr: atr[i] }
        sweep = null
      }
      // ... og utslaget må ha etterlatt en FVG (sjekkes til og med 2 lys etter bruddet)
      if (mss) {
        let fvg: { top: number; bottom: number } | null = null
        for (let k = Math.max(mss.sweepIndex + 1, 2); k <= i; k++)
          if (c[k].low - c[k - 2].high > p.fvgMinAtr * atr[k]) fvg = { top: c[k].low, bottom: c[k - 2].high }
        if (fvg) {
          let rangeHigh = -Infinity
          for (let k = mss.sweepIndex; k <= i; k++) rangeHigh = Math.max(rangeHigh, c[k].high)
          const ce = (fvg.top + fvg.bottom) / 2
          if (!p.discount || ce <= (mss.sweepLow + rangeHigh) / 2)
            setup = { ce, fvgBottom: fvg.bottom, stop: mss.sweepLow - 0.1 * mss.atr, rangeHigh, armedAt: i }
          mss = null
        } else if (i - mss.index >= 2 || x.close < mss.sweepLow) mss = null
      }
    },
    // Inngang når kursen er tilbake på 50 % av FVG-en og holder bunnen
    entry(i: number): { stop: number; target: number } | null {
      const x = c[i]
      if (!setup || i <= setup.armedAt || (p.htfFilter && bias[i] !== 1)) return null
      if (!(x.low <= setup.ce && x.close >= setup.fvgBottom)) return null
      const risk = x.close - setup.stop
      if (risk <= 0) return null
      const liquidity = highs.filter((h) => h.price >= x.close + p.minRR * risk).map((h) => h.price)
      if (!liquidity.length) return null // ingen likviditet langt nok unna: dårlig R:R
      const s = setup
      setup = null
      return { stop: s.stop, target: Math.min(...liquidity) }
    },
  }
}

export function makeIctModel(params: Partial<IctParams> = {}): Strategy {
  const p = { ...ICT_DEFAULTS, ...params }
  const isDefault = Object.entries(params).every(([k, v]) => ICT_DEFAULTS[k as keyof IctParams] === v)
  return {
    id: isDefault ? 'ict-model' : `ict-model-${Object.values(p).join('-')}`,
    name: isDefault ? 'ICT-modell (sweep → MSS → FVG)' : `ICT ${JSON.stringify(params)}`,
    interval: '1h',
    rules: [
      `Retning: struktur på høyere tidsramme (${p.htfFactor} × dette intervallet)`,
      'Sweep: kursen stikker under en tidligere bunn og lukker tilbake over',
      `MSS: innen ${p.sweepWindow} lys bryter et kraftig lys (kropp ≥ ${p.displacementAtr} × ATR) siste topp og etterlater en FVG`,
      'Inngang: tilbake på 50 % av FVG-en (i discount) og lukker over gapet',
      `Stop under sweepen. Mål: nærmeste urørte topp minst ${p.minRR}R unna. Short er speilvendt`,
    ],
    warmup: 60,
    prepare(c, { allowShort }) {
      const bias = htfBias(c, p.htfFactor, p.swingN)
      const long = ictLongRunner(c, bias, p)
      const short = allowShort ? ictLongRunner(mirror(c), bias.map((b) => -b), p) : null
      return {
        update(i) {
          long.update(i)
          short?.update(i)
        },
        decide(i, pos) {
          if (pos) {
            if (p.htfFilter && pos.side === 'long' && bias[i] === -1) return { type: 'exit', reason: 'Høyere tidsramme snudde ned' }
            if (p.htfFilter && pos.side === 'short' && bias[i] === 1) return { type: 'exit', reason: 'Høyere tidsramme snudde opp' }
            return null
          }
          const l = long.entry(i)
          if (l) return { type: 'enter', side: 'long', stop: l.stop, target: l.target, reason: 'Sweep → MSS → retest av FVG' }
          const s = short?.entry(i)
          if (s) return { type: 'enter', side: 'short', stop: -s.stop, target: -s.target, reason: 'Sweep → MSS → retest av FVG (short)' }
          return null
        },
      }
    },
  }
}

const ictModel = makeIctModel()

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

export const STRATEGIES: Strategy[] = [trendRegime, emaTrend, ictModel, fvgStructure, rsiReversion]
