import { atrValues } from '../indicators'
import { subscribePrices } from '../prices'
import { applyFunding, checkBar, closePosition } from './engine'
import { getLastSeen, getPaper, setLastSeen, updatePaper } from './store'
import type { PaperPosition } from './types'

// Motoren som utfører stop/mål/likvidasjon, trailing stop og funding.
// Bare én fane kjører den (Web Locks), de andre får oppdateringene via localStorage.

const FAPI = 'https://fapi.binance.com/fapi/v1'
const H4 = 4 * 3600_000
const H8 = 8 * 3600_000

type FKline = [number, string, string, string, string, ...unknown[]]

async function futuresKlines(symbol: string, interval: string, startTime: number, endTime: number) {
  const out: FKline[] = []
  let from = startTime
  while (from < endTime) {
    const res = await fetch(`${FAPI}/klines?symbol=${symbol}&interval=${interval}&startTime=${from}&endTime=${endTime}&limit=1500`)
    if (!res.ok) throw new Error(`Binance futures svarte ${res.status}`)
    const data = (await res.json()) as FKline[]
    if (!data.length) break
    out.push(...data)
    from = data.at(-1)![0] + 1
    if (data.length < 1500) break
  }
  return out
}

// Lukkede 4t-lys med ATR, til trailing stop
async function trailPoints(symbol: string, since: number, until: number) {
  const k = await futuresKlines(symbol, '4h', since - 40 * H4, until)
  const candles = k.map((x) => ({ time: x[0] / 1000, open: +x[1], high: +x[2], low: +x[3], close: +x[4] }))
  const atr = atrValues(candles, 14)
  return candles
    .map((c, i) => ({ closeTime: c.time * 1000 + H4, close: c.close, atr: atr[i] }))
    .filter((p) => p.closeTime > since && p.closeTime <= until && Number.isFinite(p.atr))
}

function trailedStop(p: PaperPosition, close: number, atr: number) {
  const m = p.trail!.atrMult
  if (p.stop === undefined) return undefined
  return p.side === 'long' ? Math.max(p.stop, close - m * atr) : Math.min(p.stop, close + m * atr)
}

function applyTrail(positionId: string, points: { closeTime: number; close: number; atr: number }[]) {
  if (!points.length) return
  updatePaper((s) => {
    const p = s.positions.find((x) => x.id === positionId)
    if (!p?.trail) return
    for (const pt of points) {
      if (pt.closeTime <= p.trail.updatedAt) continue
      p.stop = trailedStop(p, pt.close, pt.atr)
      p.trail.updatedAt = pt.closeTime
    }
  })
}

async function catchUpFunding(p: PaperPosition, now: number) {
  // funding skjer 00, 08 og 16 UTC: hent bare når vi har passert et slikt tidspunkt
  if (Math.floor(now / H8) <= Math.floor(p.lastFundingTime / H8)) return
  const res = await fetch(`${FAPI}/fundingRate?symbol=${p.symbol}&startTime=${p.lastFundingTime + 1}&endTime=${now}&limit=100`)
  if (!res.ok) return
  const rows = (await res.json()) as { fundingTime: number; fundingRate: string; markPrice: string }[]
  if (!rows.length) return
  updatePaper((s) => {
    for (const r of rows) applyFunding(s, p.id, +r.fundingRate, +r.markPrice || p.entry, r.fundingTime)
  })
}

// Gå gjennom 1m-lys siden sist fanen var åpen, i riktig rekkefølge
async function replay(p: PaperPosition, from: number, now: number) {
  const points = p.trail ? await trailPoints(p.symbol, p.trail.updatedAt, now) : []
  const bars = await futuresKlines(p.symbol, '1m', from, now)
  let pi = 0
  for (const b of bars) {
    const openTime = b[0]
    const upTo: typeof points = []
    while (pi < points.length && points[pi].closeTime <= openTime) upTo.push(points[pi++])
    applyTrail(p.id, upTo)
    const current = getPaper().positions.find((x) => x.id === p.id)
    if (!current) return
    const hit = checkBar(current, +b[1], +b[2], +b[3])
    if (hit) {
      updatePaper((s) => closePosition(s, p.id, hit.price, hit.reason, openTime + 60_000, true))
      return
    }
  }
  applyTrail(p.id, points.slice(pi))
}

async function minuteTick() {
  const now = Date.now()
  for (const p of getPaper().positions) {
    try {
      if (p.trail && Math.floor(now / H4) > Math.floor(p.trail.updatedAt / H4))
        applyTrail(p.id, await trailPoints(p.symbol, p.trail.updatedAt, now))
      await catchUpFunding(p, now)
    } catch (e) {
      console.warn('Papirmotor:', e)
    }
  }
}

function onPrice(symbol: string, price: number) {
  for (const p of getPaper().positions) {
    if (p.symbol !== symbol) continue
    const hit = checkBar(p, price, price, price)
    if (hit) updatePaper((s) => closePosition(s, p.id, hit.price, hit.reason))
  }
}

async function run() {
  const now = Date.now()
  const lastSeen = getLastSeen() ?? now
  setLastSeen(now)
  for (const p of getPaper().positions) {
    const from = Math.max(p.openedAt, lastSeen - 60_000)
    if (now - from > 90_000) {
      try {
        await replay(p, from, now)
      } catch (e) {
        console.warn('Papirmotor: klarte ikke gjennomgang', e)
      }
    }
  }
  subscribePrices(onPrice)
  minuteTick()
  setInterval(minuteTick, 60_000)
  setInterval(() => setLastSeen(Date.now()), 10_000)
}

let started = false
export function startPaperEngine() {
  if (started) return
  started = true
  if (navigator.locks) {
    navigator.locks.request('kt-paper-engine', () => {
      run()
      return new Promise(() => {}) // hold låsen så lenge fanen lever
    })
  } else run()
}
