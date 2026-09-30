// Ren logikk for papirmotoren (ingen avhengigheter), så den kan testes med Node også.

export type Side = 'long' | 'short'
export type CloseReason = 'Stop' | 'Trailing stop' | 'Mål' | 'Likvidert'

export interface EnginePosition {
  id: string
  symbol: string
  side: Side
  liq: number
  stop: number | null
  target: number | null
  trail_atr_mult: number | null
  trail_updated_at: number | null
  checked_until: number
  last_funding_time: number
}

export type Kline = [number, string, string, string, string, ...unknown[]]
export interface TrailPoint {
  closeTime: number
  close: number
  atr: number
}

const MINUTE = 60_000
export const H4 = 4 * 3600_000
export const H8 = 8 * 3600_000

const stopBeforeLiq = (side: Side, stop: number, liq: number) => (side === 'long' ? stop > liq : stop < liq)

// Samme rekkefølge som backtesten: likvidasjon/stop (det mest pessimistiske) før mål
export function checkBar(p: EnginePosition, open: number, high: number, low: number): { price: number; reason: CloseReason } | null {
  const long = p.side === 'long'
  const hasLiq = long ? p.liq > 0 : Number.isFinite(p.liq)
  const liqHit = hasLiq && (long ? low <= p.liq : high >= p.liq)
  const gapPastLiq = hasLiq && (long ? open <= p.liq : open >= p.liq)
  const stopHit = p.stop !== null && (long ? low <= p.stop : high >= p.stop)
  if (liqHit && (p.stop === null || !stopBeforeLiq(p.side, p.stop, p.liq) || gapPastLiq)) return { price: p.liq, reason: 'Likvidert' }
  if (stopHit) return { price: long ? Math.min(open, p.stop!) : Math.max(open, p.stop!), reason: p.trail_atr_mult ? 'Trailing stop' : 'Stop' }
  if (p.target !== null && (long ? high >= p.target : low <= p.target))
    return { price: long ? Math.max(open, p.target) : Math.min(open, p.target), reason: 'Mål' }
  return null
}

export function trailedStop(p: EnginePosition, close: number, atr: number) {
  if (p.stop === null || !p.trail_atr_mult) return p.stop
  const d = p.trail_atr_mult * atr
  return p.side === 'long' ? Math.max(p.stop, close - d) : Math.min(p.stop, close + d)
}

// Wilders ATR(14) på 4t-lys, samme som i appen
export function trailPointsFrom(klines: Kline[], since: number, until: number): TrailPoint[] {
  const period = 14
  const out: TrailPoint[] = []
  let atr = NaN
  let sum = 0
  for (let i = 1; i < klines.length; i++) {
    const h = +klines[i][2]
    const l = +klines[i][3]
    const pc = +klines[i - 1][4]
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc))
    if (i <= period) {
      sum += tr
      if (i === period) atr = sum / period
    } else atr = (atr * (period - 1) + tr) / period
    const closeTime = klines[i][0] + H4
    if (Number.isFinite(atr) && closeTime > since && closeTime <= until) out.push({ closeTime, close: +klines[i][4], atr })
  }
  return out
}

export interface WalkResult {
  hit: { price: number; reason: CloseReason; time: number } | null
  stop: number | null
  trailUpdatedAt: number | null
  checkedUntil: number
}

// Går gjennom lukkede 1m-lys i rekkefølge; trailing flyttes ved hver 4t-lukk før neste minutt sjekkes
export function walk(p: EnginePosition, bars: Kline[], points: TrailPoint[]): WalkResult {
  const cur: EnginePosition = { ...p }
  let pi = 0
  let checkedUntil = p.checked_until
  for (const b of bars) {
    const openTime = b[0]
    if (openTime < p.checked_until) continue
    while (pi < points.length && points[pi].closeTime <= openTime) {
      const pt = points[pi++]
      if (cur.trail_updated_at === null || pt.closeTime > cur.trail_updated_at) {
        cur.stop = trailedStop(cur, pt.close, pt.atr)
        cur.trail_updated_at = pt.closeTime
      }
    }
    const hit = checkBar(cur, +b[1], +b[2], +b[3])
    if (hit) return { hit: { ...hit, time: openTime + MINUTE }, stop: cur.stop, trailUpdatedAt: cur.trail_updated_at, checkedUntil }
    checkedUntil = openTime + MINUTE
  }
  // 4t-lukk etter siste sjekkede minutt tas med neste gang
  return { hit: null, stop: cur.stop, trailUpdatedAt: cur.trail_updated_at, checkedUntil }
}
