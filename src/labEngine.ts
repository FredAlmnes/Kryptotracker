import { backtest, type BacktestOptions, type BacktestResult } from './backtest'
import type { Candle } from './indicators'
import type { CostModel, Sizing } from './sizing'
import { warmupOf, type Strategy } from './strategies'

export interface Segment {
  result: BacktestResult | null // null = for lite data i perioden
  from: number
  to: number
}

export interface LabRow {
  strategy: Strategy
  symbol: string
  full: Segment
  inSample: Segment
  outSample: Segment
}

// Kjører strategien bare på lysene i [fromTime, toTime), men gir den `warmup` lys før
// perioden så indikatorene er klare fra første dag.
export function runSegment(
  c: Candle[],
  strategy: Strategy,
  opts: BacktestOptions,
  fromTime: number,
  toTime = Infinity,
): Segment {
  const first = c.findIndex((x) => x.time >= fromTime)
  let last = c.findIndex((x) => x.time >= toTime)
  if (last < 0) last = c.length
  if (first < 0 || last - first < 50) return { result: null, from: fromTime, to: toTime }
  const warmup = warmupOf(strategy, c)
  const start = Math.max(0, first - warmup)
  const slice = c.slice(start, last)
  if (slice.length <= warmup + 50) return { result: null, from: fromTime, to: toTime }
  return {
    result: backtest(slice, strategy, opts),
    from: slice[Math.min(warmup, slice.length - 1)].time,
    to: slice.at(-1)!.time,
  }
}

export function runLab(
  data: Record<string, Candle[]>,
  strategies: Strategy[],
  opts: BacktestOptions & { split: number },
): LabRow[] {
  const rows: LabRow[] = []
  for (const strategy of strategies) {
    for (const [symbol, c] of Object.entries(data)) {
      if (!c.length) continue
      rows.push({
        strategy,
        symbol,
        full: runSegment(c, strategy, opts, 0),
        inSample: runSegment(c, strategy, opts, 0, opts.split),
        outSample: runSegment(c, strategy, opts, opts.split),
      })
    }
  }
  return rows
}

// Samme strategi med nabotall: holder resultatet seg, eller var standardtallene flaks?
export function runGrid(
  data: Record<string, Candle[]>,
  make: (a: number, b: number) => Strategy,
  xs: number[],
  ys: number[],
  opts: BacktestOptions & { from: number },
) {
  return xs.map((x) =>
    ys.map((y) => {
      const strategy = make(x, y)
      const results = Object.values(data)
        .map((c) => runSegment(c, strategy, opts, opts.from).result)
        .filter((r): r is BacktestResult => r !== null)
      const avg = (f: (r: BacktestResult) => number) =>
        results.length ? results.reduce((s, r) => s + f(r), 0) / results.length : NaN
      return {
        x,
        y,
        avgReturn: avg((r) => r.totalReturn),
        avgBuyHold: avg((r) => r.buyHold),
        avgDrawdown: avg((r) => r.maxDrawdown),
        beatHold: results.filter((r) => r.totalReturn > r.buyHold).length,
        profitable: results.filter((r) => r.totalReturn > 0).length,
        n: results.length,
      }
    }),
  )
}

// Samme strategi med ulike størrelser/giring: hvor mye avkastning per fall får du?
export function runSizing(
  data: Record<string, Candle[]>,
  strategy: Strategy,
  configs: { sizing: Sizing; costs: CostModel }[],
  opts: { allowShort: boolean; from: number },
) {
  return configs.map(({ sizing, costs }) => {
    const perCoin = Object.entries(data).map(([symbol, c]) => ({
      symbol,
      result: runSegment(c, strategy, { allowShort: opts.allowShort, sizing, costs }, opts.from).result,
    }))
    const ok = perCoin.flatMap((x) => (x.result ? [x.result] : []))
    const avg = (f: (r: BacktestResult) => number) => (ok.length ? ok.reduce((s, r) => s + f(r), 0) / ok.length : NaN)
    return {
      sizing,
      costs,
      perCoin,
      avgCagr: avg((r) => r.cagr),
      avgDrawdown: avg((r) => r.maxDrawdown),
      avgCalmar: avg((r) => r.calmar),
      liquidations: ok.reduce((s, r) => s + r.liquidations, 0),
      ruined: ok.filter((r) => r.ruined).length,
      longestStreak: Math.max(0, ...ok.map((r) => r.longestLosingStreak)),
    }
  })
}
