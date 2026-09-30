import { coinBySymbol, roundStep } from '../coins'
import { FUTURES_COSTS, liquidationPrice, type Side } from '../sizing'
import type { PaperPosition, PaperState } from './types'

// Utførelsen (stop/mål/likvidasjon, trailing, funding) skjer på serveren: supabase/functions/paper-engine.
// Her ligger det nettleseren trenger for å åpne ordre og vise tall.

export const TAKER_FEE = 0.0005 // må stemme med paper_close i databasen
export const SLIPPAGE = 0.0005
export const MMR = FUTURES_COSTS.mmr

const sign = (s: Side) => (s === 'long' ? 1 : -1)

export const unrealizedPnl = (p: PaperPosition, price: number) =>
  Math.max(-p.margin, sign(p.side) * p.qty * (price - p.entry))

export const usedMargin = (s: PaperState) => s.positions.reduce((sum, p) => sum + p.margin, 0)

// Market-fill: litt dårligere pris enn mark (slippage)
export const fillPrice = (side: Side, mark: number, opening: boolean) =>
  mark * (1 + sign(side) * (opening ? 1 : -1) * SLIPPAGE)

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

// Raden som sendes til paper_open i databasen
export function buildOpenPayload(input: OpenInput, now = Date.now()) {
  const coin = coinBySymbol(input.symbol)
  const qty = coin ? roundStep(input.qty, coin.step) : input.qty
  const entry = fillPrice(input.side, input.mark, true)
  const notional = qty * entry
  return {
    symbol: input.symbol,
    side: input.side,
    qty,
    entry,
    leverage: input.leverage,
    margin: notional / input.leverage,
    liq: liquidationPrice(input.side, entry, input.leverage, MMR),
    stop: input.stop ?? null,
    target: input.target ?? null,
    trail_atr_mult: input.trail?.atrMult ?? null,
    opened_at: now,
    fees: notional * TAKER_FEE,
    risk_usd: input.stop ? qty * Math.abs(entry - input.stop) : null,
    strategy_id: input.strategyId ?? null,
    signal_id: input.signalId ?? null,
  }
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
  for (const x of t) {
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
