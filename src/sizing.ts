// Posisjonsstørrelse, giring og likvidasjon for Binance USDT-M futures (isolated margin).
// Brukes både av backtesten og papirkontoen, så de regner likt.

export type Side = 'long' | 'short'

export interface CostModel {
  feePerSide: number // andel av posisjonsverdien per side (avgift + slippage)
  fundingPer8h: number // long betaler dette per 8 timer når det er positivt
  mmr: number // maintenance margin rate
}

// Dagens backtest: spot, 0,1 % avgift + 0,05 % slippage per side
export const SPOT_COSTS: CostModel = { feePerSide: 0.0015, fundingPer8h: 0, mmr: 0 }
// Futures: taker 0,05 % + slippage 0,05 %, funding 0,01 %/8t (Binance-standard), MMR 1 % (konservativt)
export const FUTURES_COSTS: CostModel = { feePerSide: 0.001, fundingPer8h: 0.0001, mmr: 0.01 }

export type Sizing =
  | { mode: 'spot' } // hele kontoen, ingen giring (som før)
  | { mode: 'fraction'; frac: number; leverage: number } // fast andel av kontoen som margin
  | { mode: 'risk'; riskPct: number; maxLeverage: number } // tap ved stop = riskPct av kontoen

export const sizingLabel = (s: Sizing) =>
  s.mode === 'spot'
    ? 'Spot 1x'
    : s.mode === 'fraction'
      ? `${Math.round(s.frac * 100)} % × ${s.leverage}x`
      : `${+(s.riskPct * 100).toFixed(2)} % risiko, maks ${s.maxLeverage}x`

// Likvidasjonspris for isolated margin (Binance-formelen, uten gjeldende tier-fradrag)
export function liquidationPrice(side: Side, entry: number, leverage: number, mmr: number) {
  if (side === 'long') return leverage <= 1 ? 0 : (entry * (1 - 1 / leverage)) / (1 - mmr)
  return (entry * (1 + 1 / leverage)) / (1 + mmr)
}

// Høyeste giring der likvidasjonen fortsatt ligger bak stopen (med litt buffer)
export function safeLeverage(entry: number, stop: number, mmr: number, buffer = 0.005) {
  return 1 / (Math.abs(entry - stop) / entry + mmr + buffer)
}

export const hasValidStop = (side: Side, entry: number, stop?: number) =>
  stop !== undefined && stop > 0 && (side === 'long' ? stop < entry : stop > entry)

// Stopen treffes før likvidasjon?
export const stopBeforeLiq = (side: Side, stop: number, liq: number) => (side === 'long' ? stop > liq : stop < liq)

export interface Plan {
  qty: number
  notional: number
  margin: number
  leverage: number
  liq: number
  riskUSD: number | null // hva du taper ved stop (uten avgifter)
  entryFee: number
}

export function planPosition(
  side: Side,
  equity: number,
  entry: number,
  stop: number | undefined,
  sizing: Sizing,
  costs: CostModel,
): Plan | null {
  if (equity <= 0 || entry <= 0) return null
  const validStop = hasValidStop(side, entry, stop)
  let notional: number
  let leverage: number
  if (sizing.mode === 'fraction') {
    leverage = sizing.leverage
    notional = equity * sizing.frac * leverage
  } else if (sizing.mode === 'risk' && validStop) {
    leverage = Math.max(1, Math.min(sizing.maxLeverage, safeLeverage(entry, stop!, costs.mmr)))
    notional = Math.min((equity * sizing.riskPct * entry) / Math.abs(entry - stop!), equity * leverage)
  } else {
    // spot, eller risikostyrt uten stop: hele kontoen uten giring
    leverage = 1
    notional = equity / (1 + costs.feePerSide)
  }
  const qty = notional / entry
  return {
    qty,
    notional,
    margin: notional / leverage,
    leverage,
    liq: liquidationPrice(side, entry, leverage, costs.mmr),
    riskUSD: validStop ? qty * Math.abs(entry - stop!) : null,
    entryFee: notional * costs.feePerSide,
  }
}

export interface SizingPreset {
  id: string
  label: string
  sizing: Sizing
  costs: CostModel
}

export const SIZING_PRESETS: SizingPreset[] = [
  { id: 'spot', label: 'Spot, hele kontoen, 1x', sizing: { mode: 'spot' }, costs: SPOT_COSTS },
  { id: 'r1', label: '1 % risiko, maks 3x', sizing: { mode: 'risk', riskPct: 0.01, maxLeverage: 3 }, costs: FUTURES_COSTS },
  { id: 'r2', label: '2 % risiko, maks 10x', sizing: { mode: 'risk', riskPct: 0.02, maxLeverage: 10 }, costs: FUTURES_COSTS },
  { id: 'r5', label: '5 % risiko, maks 20x', sizing: { mode: 'risk', riskPct: 0.05, maxLeverage: 20 }, costs: FUTURES_COSTS },
  { id: 'm2x10', label: '2 % som margin × 10x', sizing: { mode: 'fraction', frac: 0.02, leverage: 10 }, costs: FUTURES_COSTS },
  { id: 'f3', label: 'Hele kontoen × 3x', sizing: { mode: 'fraction', frac: 1, leverage: 3 }, costs: FUTURES_COSTS },
  { id: 'f10', label: 'Hele kontoen × 10x', sizing: { mode: 'fraction', frac: 1, leverage: 10 }, costs: FUTURES_COSTS },
]
