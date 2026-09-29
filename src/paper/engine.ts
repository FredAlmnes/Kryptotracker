import { coinBySymbol, roundStep } from '../coins'
import { FUTURES_COSTS, liquidationPrice, stopBeforeLiq, type Side } from '../sizing'
import type { CloseReason, PaperPosition, PaperState } from './types'

// Papirhandel bruker samme kostnader som futures-backtesten
export const TAKER_FEE = 0.0005
export const SLIPPAGE = 0.0005
export const MMR = FUTURES_COSTS.mmr

const sign = (s: Side) => (s === 'long' ? 1 : -1)
const id = () => Math.random().toString(36).slice(2, 10)

export const unrealizedPnl = (p: PaperPosition, price: number) =>
  Math.max(-p.margin, sign(p.side) * p.qty * (price - p.entry))

export const usedMargin = (s: PaperState) => s.positions.reduce((sum, p) => sum + p.margin, 0)

// Market-fill: litt dårligere pris enn mark (slippage)
export const fillPrice = (side: Side, mark: number, opening: boolean) =>
  mark * (1 + (sign(side) * (opening ? 1 : -1) * SLIPPAGE))

export interface OpenInput {
  symbol: string
  side: Side
  qty: number
  leverage: number
  mark: number
  stop?: number
  target?: number
  trail?: { atrMult: number }
  strategyId?: string
  signalId?: string
}

export function openPosition(s: PaperState, input: OpenInput, now = Date.now()) {
  const coin = coinBySymbol(input.symbol)
  const qty = coin ? roundStep(input.qty, coin.step) : input.qty
  const entry = fillPrice(input.side, input.mark, true)
  const notional = qty * entry
  const margin = notional / input.leverage
  const fee = notional * TAKER_FEE
  s.balance -= fee
  s.positions.push({
    id: id(),
    symbol: input.symbol,
    side: input.side,
    qty,
    entry,
    leverage: input.leverage,
    margin,
    liq: liquidationPrice(input.side, entry, input.leverage, MMR),
    stop: input.stop,
    target: input.target,
    trail: input.trail ? { atrMult: input.trail.atrMult, updatedAt: now } : undefined,
    openedAt: now,
    fees: fee,
    funding: 0,
    lastFundingTime: now,
    riskUSD: input.stop ? qty * Math.abs(entry - input.stop) : null,
    strategyId: input.strategyId,
    signalId: input.signalId,
  })
  if (input.signalId) s.takenSignals = [...s.takenSignals.slice(-200), input.signalId]
}

export function closePosition(
  s: PaperState,
  positionId: string,
  price: number,
  reason: CloseReason,
  time = Date.now(),
  replayed = false,
) {
  const p = s.positions.find((x) => x.id === positionId)
  if (!p) return
  const liquidated = reason === 'Likvidert'
  const gross = liquidated ? -p.margin : sign(p.side) * p.qty * (price - p.entry)
  const exitFee = liquidated ? 0 : p.qty * price * TAKER_FEE
  s.balance += gross - exitFee
  const fees = p.fees + exitFee
  const pnl = gross - fees - p.funding
  s.positions = s.positions.filter((x) => x.id !== positionId)
  s.journal.push({
    id: p.id,
    symbol: p.symbol,
    side: p.side,
    qty: p.qty,
    leverage: p.leverage,
    entry: p.entry,
    exit: price,
    openedAt: p.openedAt,
    closedAt: time,
    reason,
    pnl,
    fees,
    funding: p.funding,
    r: p.riskUSD ? pnl / p.riskUSD : null,
    strategyId: p.strategyId,
    replayed,
  })
}

// Samme rekkefølge som backtesten: likvidasjon/stop (det mest pessimistiske) før mål.
export function checkBar(
  p: PaperPosition,
  open: number,
  high: number,
  low: number,
): { price: number; reason: CloseReason } | null {
  const long = p.side === 'long'
  const liqHit = long ? p.liq > 0 && low <= p.liq : high >= p.liq
  const stopHit = p.stop !== undefined && (long ? low <= p.stop : high >= p.stop)
  const gapPastLiq = long ? p.liq > 0 && open <= p.liq : open >= p.liq
  if (liqHit && (p.stop === undefined || !stopBeforeLiq(p.side, p.stop, p.liq) || gapPastLiq))
    return { price: p.liq, reason: 'Likvidert' }
  if (stopHit)
    return { price: long ? Math.min(open, p.stop!) : Math.max(open, p.stop!), reason: p.trail ? 'Trailing stop' : 'Stop' }
  if (p.target !== undefined && (long ? high >= p.target : low <= p.target))
    return { price: long ? Math.max(open, p.target) : Math.min(open, p.target), reason: 'Mål' }
  return null
}

export function applyFunding(s: PaperState, positionId: string, rate: number, markPrice: number, time: number) {
  const p = s.positions.find((x) => x.id === positionId)
  if (!p || time <= p.lastFundingTime) return
  const amount = sign(p.side) * p.qty * markPrice * rate // positiv = du betaler
  s.balance -= amount
  p.funding += amount
  p.lastFundingTime = time
}

// Journalstatistikk til porteføljesiden
export function journalStats(s: PaperState) {
  const t = s.journal
  const wins = t.filter((x) => x.pnl > 0)
  const grossWin = wins.reduce((a, x) => a + x.pnl, 0)
  const grossLoss = -t.filter((x) => x.pnl <= 0).reduce((a, x) => a + x.pnl, 0)
  const rs = t.flatMap((x) => (x.r === null ? [] : [x.r]))
  let eq = s.settings.startBalance
  let peak = eq
  let dd = 0
  for (const x of [...t].sort((a, b) => a.closedAt - b.closedAt)) {
    eq += x.pnl
    peak = Math.max(peak, eq)
    dd = Math.max(dd, 1 - eq / peak)
  }
  return {
    count: t.length,
    winRate: t.length ? wins.length / t.length : 0,
    profitFactor: grossLoss ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
    fees: t.reduce((a, x) => a + x.fees, 0),
    funding: t.reduce((a, x) => a + x.funding, 0),
    maxDrawdown: dd,
    liquidations: t.filter((x) => x.reason === 'Likvidert').length,
  }
}
