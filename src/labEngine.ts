import { backtest, type BacktestResult } from './backtest'
import type { Candle } from './indicators'
import type { Strategy } from './strategies'

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
  allowShort: boolean,
  fromTime: number,
  toTime = Infinity,
): Segment {
  const first = c.findIndex((x) => x.time >= fromTime)
  let last = c.findIndex((x) => x.time >= toTime)
  if (last < 0) last = c.length
  if (first < 0 || last - first < 50) return { result: null, from: fromTime, to: toTime }
  const start = Math.max(0, first - strategy.warmup)
  const slice = c.slice(start, last)
  if (slice.length <= strategy.warmup + 50) return { result: null, from: fromTime, to: toTime }
  return {
    result: backtest(slice, strategy, { allowShort }),
    from: slice[Math.min(strategy.warmup, slice.length - 1)].time,
    to: slice.at(-1)!.time,
  }
}

export function runLab(
  data: Record<string, Candle[]>,
  strategies: Strategy[],
  opts: { allowShort: boolean; split: number },
): LabRow[] {
  const rows: LabRow[] = []
  for (const strategy of strategies) {
    for (const [symbol, c] of Object.entries(data)) {
      if (!c.length) continue
      rows.push({
        strategy,
        symbol,
        full: runSegment(c, strategy, opts.allowShort, 0),
        inSample: runSegment(c, strategy, opts.allowShort, 0, opts.split),
        outSample: runSegment(c, strategy, opts.allowShort, opts.split),
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
  opts: { allowShort: boolean; from: number },
) {
  return xs.map((x) =>
    ys.map((y) => {
      const strategy = make(x, y)
      const results = Object.values(data)
        .map((c) => runSegment(c, strategy, opts.allowShort, opts.from).result)
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
