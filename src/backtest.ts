import type { Candle } from './indicators'
import { warmupOf, type Action, type Position, type Side, type Strategy } from './strategies'

// Kostnader per side (inn og ut): Binance spot-avgift + litt slippage
export const FEE = 0.001
export const SLIPPAGE = 0.0005
const COST = FEE + SLIPPAGE

export interface Trade {
  side: Side
  entryIndex: number
  exitIndex: number
  entry: number
  exit: number
  ret: number // netto avkastning, etter kostnader
  entryReason: string
  exitReason: string
}

export interface BacktestResult {
  trades: Trade[]
  open: (Position & { reason: string }) | null
  pending: Action[] // signaler fra siste lukkede lys, utføres ved neste åpning
  equity: number[]
  start: number // første handelbare lys (etter warmup)
  totalReturn: number
  buyHold: number
  maxDrawdown: number
  buyHoldDrawdown: number
  winRate: number
  profitFactor: number
  avgTrade: number
  exposure: number // andel av tiden med åpen posisjon
}

const grossReturn = (side: Side, entry: number, exit: number) =>
  side === 'long' ? exit / entry - 1 : (entry - exit) / entry

function maxDrawdown(curve: number[]) {
  let peak = -Infinity
  let dd = 0
  for (const v of curve) {
    peak = Math.max(peak, v)
    dd = Math.max(dd, 1 - v / peak)
  }
  return dd
}

// Signal på lukket lys i → handel på åpningen av lys i+1. Hele kapitalen per handel, ingen gearing.
// Send kun inn lukkede lys.
export function backtest(c: Candle[], strategy: Strategy, opts: { allowShort: boolean }): BacktestResult {
  const runner = strategy.prepare(c, opts)
  const trades: Trade[] = []
  const equity: number[] = []
  let cash = 1
  let pos: (Position & { reason: string }) | null = null
  let pending: Action[] = []
  let inMarket = 0
  const start = Math.min(warmupOf(strategy, c), c.length - 1)

  const close = (i: number, price: number, reason: string) => {
    if (!pos) return
    const ret = (1 + grossReturn(pos.side, pos.entry, price)) * (1 - COST) ** 2 - 1
    cash *= 1 + ret
    trades.push({
      side: pos.side,
      entryIndex: pos.entryIndex,
      exitIndex: i,
      entry: pos.entry,
      exit: price,
      ret,
      entryReason: pos.reason,
      exitReason: reason,
    })
    pos = null
  }

  for (let i = 0; i < c.length; i++) {
    const x = c[i]
    // 1. utfør signaler fra forrige lys på åpningen
    for (const a of pending) {
      if (a?.type === 'exit') close(i, x.open, a.reason)
      if (a?.type === 'enter' && !pos)
        pos = { side: a.side, entryIndex: i, entry: x.open, stop: a.stop, target: a.target, reason: a.reason }
    }
    pending = []

    // 2. stop/mål inne i lyset (stop sjekkes først – det mest pessimistiske)
    if (pos) {
      const p: Position = pos
      if (p.side === 'long') {
        if (x.low <= p.stop) close(i, Math.min(x.open, p.stop), 'Stop')
        else if (p.target && x.high >= p.target) close(i, Math.max(x.open, p.target), 'Mål')
      } else {
        if (x.high >= p.stop) close(i, Math.max(x.open, p.stop), 'Stop')
        else if (p.target && x.low <= p.target) close(i, Math.min(x.open, p.target), 'Mål')
      }
    }

    // 3. strategien ser på det lukkede lyset og bestemmer hva som skjer ved neste åpning
    if (i >= start && i >= 2) {
      runner.update?.(i)
      const a = runner.decide(i, pos)
      if (a?.type === 'stop' && pos) pos.stop = a.stop
      else if (a?.type === 'exit' && pos) {
        pending.push(a)
        const next = runner.decide(i, null) // snu posisjonen hvis det også er et nytt signal
        if (next?.type === 'enter') pending.push(next)
      } else if (a?.type === 'enter') pending.push(a)
    }

    if (pos) inMarket++
    equity.push(pos ? cash * (1 + grossReturn(pos.side, pos.entry, x.close)) : cash)
  }

  const curve = equity.slice(start)
  const bhCurve = c.slice(start).map((x) => x.close)
  const wins = trades.filter((t) => t.ret > 0)
  const grossWin = wins.reduce((s, t) => s + t.ret, 0)
  const grossLoss = -trades.filter((t) => t.ret <= 0).reduce((s, t) => s + t.ret, 0)

  return {
    trades,
    open: pos,
    pending,
    equity,
    start,
    totalReturn: (equity.at(-1) ?? 1) - 1,
    buyHold: c.length > start ? ((c.at(-1)!.close / c[start].open) * (1 - COST) ** 2 - 1) : 0,
    maxDrawdown: maxDrawdown(curve),
    buyHoldDrawdown: maxDrawdown(bhCurve),
    winRate: trades.length ? wins.length / trades.length : 0,
    profitFactor: grossLoss === 0 ? (grossWin > 0 ? Infinity : 0) : grossWin / grossLoss,
    avgTrade: trades.length ? trades.reduce((s, t) => s + t.ret, 0) / trades.length : 0,
    exposure: c.length > start ? inMarket / (c.length - start) : 0,
  }
}
