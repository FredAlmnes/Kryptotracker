import type { Candle } from './indicators'
import { barSeconds, warmupOf, type Action, type Position, type Side, type Strategy } from './strategies'
import { planPosition, SPOT_COSTS, stopBeforeLiq, type CostModel, type Sizing } from './sizing'

export interface Trade {
  side: Side
  entryIndex: number
  exitIndex: number
  entry: number
  exit: number
  ret: number // endring i kontoen fra handelen, etter kostnader
  pnl: number // i samme enhet som kontoen (start = 1)
  r: number | null // gevinst/tap målt i risiko-enheter (R)
  leverage: number
  fees: number
  funding: number
  entryReason: string
  exitReason: string
}

interface OpenPosition extends Position {
  reason: string
  qty: number
  margin: number
  liq: number
  leverage: number
  riskUSD: number | null
  equityAtEntry: number
  fees: number
  funding: number
}

export interface BacktestOptions {
  allowShort: boolean
  sizing?: Sizing
  costs?: CostModel
}

export interface BacktestResult {
  trades: Trade[]
  open: OpenPosition | null
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
  cagr: number
  calmar: number // årlig avkastning / største fall
  longestLosingStreak: number
  liquidations: number
  totalFees: number
  totalFunding: number
  avgR: number | null
  ruined: boolean
}

function maxDrawdown(curve: number[]) {
  let peak = -Infinity
  let dd = 0
  for (const v of curve) {
    peak = Math.max(peak, v)
    dd = Math.max(dd, peak > 0 ? 1 - v / peak : 1)
  }
  return Math.min(dd, 1)
}

// Signal på lukket lys i → handel på åpningen av lys i+1. Kontoen starter på 1.
// Send kun inn lukkede lys.
export function backtest(c: Candle[], strategy: Strategy, opts: BacktestOptions): BacktestResult {
  const sizing = opts.sizing ?? { mode: 'spot' }
  const costs = opts.costs ?? SPOT_COSTS
  const fundingPerBar = costs.fundingPer8h * (barSeconds(c) / (8 * 3600))
  const runner = strategy.prepare(c, { allowShort: opts.allowShort })
  const trades: Trade[] = []
  const equity: number[] = []
  let cash = 1
  let pos: OpenPosition | null = null
  let pending: Action[] = []
  let inMarket = 0
  let ruined = false
  const start = Math.min(warmupOf(strategy, c), c.length - 1)

  const sign = (s: Side) => (s === 'long' ? 1 : -1)
  const unrealized = (p: OpenPosition, price: number) => Math.max(-p.margin, sign(p.side) * p.qty * (price - p.entry))

  const close = (i: number, price: number, reason: string, liquidated = false) => {
    if (!pos) return
    const exitFee = liquidated ? 0 : pos.qty * price * costs.feePerSide
    const gross = liquidated ? -pos.margin : sign(pos.side) * pos.qty * (price - pos.entry)
    cash += gross - exitFee
    const fees = pos.fees + exitFee
    const pnl = gross - fees - pos.funding
    trades.push({
      side: pos.side,
      entryIndex: pos.entryIndex,
      exitIndex: i,
      entry: pos.entry,
      exit: price,
      ret: pnl / pos.equityAtEntry,
      pnl,
      r: pos.riskUSD ? pnl / pos.riskUSD : null,
      leverage: pos.leverage,
      fees,
      funding: pos.funding,
      entryReason: pos.reason,
      exitReason: reason,
    })
    pos = null
    if (cash <= 1e-9) {
      cash = 0
      ruined = true
    }
  }

  for (let i = 0; i < c.length; i++) {
    const x = c[i]
    // 1. utfør signaler fra forrige lys på åpningen
    for (const a of pending) {
      if (a?.type === 'exit') close(i, x.open, a.reason)
      if (a?.type === 'enter' && !pos && !ruined) {
        const plan = planPosition(a.side, cash, x.open, a.stop, sizing, costs)
        if (plan && plan.qty > 0) {
          cash -= plan.entryFee
          pos = {
            side: a.side,
            entryIndex: i,
            entry: x.open,
            stop: a.stop,
            target: a.target,
            reason: a.reason,
            qty: plan.qty,
            margin: plan.margin,
            liq: plan.liq,
            leverage: plan.leverage,
            riskUSD: plan.riskUSD,
            equityAtEntry: cash + plan.entryFee,
            fees: plan.entryFee,
            funding: 0,
          }
        }
      }
    }
    pending = []

    // 2. likvidasjon, stop og mål inne i lyset (det mest pessimistiske først)
    if (pos) {
      const p: OpenPosition = pos
      const long = p.side === 'long'
      const hasLiq = long ? p.liq > 0 : Number.isFinite(p.liq)
      const hasStop = p.stop > 0
      const liqHit = hasLiq && (long ? x.low <= p.liq : x.high >= p.liq)
      const stopHit = hasStop && (long ? x.low <= p.stop : x.high >= p.stop)
      const gapPastLiq = hasLiq && (long ? x.open <= p.liq : x.open >= p.liq)
      // likvidert hvis det ikke finnes stop, stopen ligger bak likvidasjonen, eller kursen gapet forbi begge
      if (liqHit && (!hasStop || !stopBeforeLiq(p.side, p.stop, p.liq) || gapPastLiq)) {
        close(i, p.liq, 'Likvidert', true)
      } else if (stopHit) {
        close(i, long ? Math.min(x.open, p.stop) : Math.max(x.open, p.stop), 'Stop')
      } else if (p.target && (long ? x.high >= p.target : x.low <= p.target)) {
        close(i, long ? Math.max(x.open, p.target) : Math.min(x.open, p.target), 'Mål')
      }
    }

    // 3. funding for lyset posisjonen var åpen
    if (pos && fundingPerBar) {
      const f = sign(pos.side) * pos.qty * x.close * fundingPerBar
      cash -= f
      pos.funding += f
    }

    // 4. strategien ser på det lukkede lyset og bestemmer hva som skjer ved neste åpning
    if (i >= start && i >= 2 && !ruined) {
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
    equity.push(pos ? cash + unrealized(pos, x.close) : cash)
  }

  const curve = equity.slice(start)
  const bhCurve = c.slice(start).map((x) => x.close)
  const wins = trades.filter((t) => t.pnl > 0)
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0)
  const grossLoss = -trades.filter((t) => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0)
  let streak = 0
  let longest = 0
  for (const t of trades) {
    streak = t.pnl <= 0 ? streak + 1 : 0
    longest = Math.max(longest, streak)
  }
  const final = equity.at(-1) ?? 1
  const days = c.length > start ? (c.at(-1)!.time - c[start].time) / 86400 : 0
  const cagr = days > 0 && final > 0 ? final ** (365 / days) - 1 : final > 0 ? 0 : -1
  const dd = maxDrawdown(curve)
  const rs = trades.flatMap((t) => (t.r === null ? [] : [t.r]))

  return {
    trades,
    open: pos,
    pending,
    equity,
    start,
    totalReturn: final - 1,
    buyHold: c.length > start ? (c.at(-1)!.close / c[start].open) * (1 - SPOT_COSTS.feePerSide) ** 2 - 1 : 0,
    maxDrawdown: dd,
    buyHoldDrawdown: maxDrawdown(bhCurve),
    winRate: trades.length ? wins.length / trades.length : 0,
    profitFactor: grossLoss === 0 ? (grossWin > 0 ? Infinity : 0) : grossWin / grossLoss,
    avgTrade: trades.length ? trades.reduce((s, t) => s + t.ret, 0) / trades.length : 0,
    exposure: c.length > start ? inMarket / (c.length - start) : 0,
    cagr,
    calmar: dd > 0 ? cagr / dd : 0,
    longestLosingStreak: longest,
    liquidations: trades.filter((t) => t.exitReason === 'Likvidert').length,
    totalFees: trades.reduce((s, t) => s + t.fees, 0) + (pos ? pos.fees : 0),
    totalFunding: trades.reduce((s, t) => s + t.funding, 0) + (pos ? pos.funding : 0),
    avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
    ruined,
  }
}
