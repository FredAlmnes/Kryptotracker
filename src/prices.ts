import { useSyncExternalStore } from 'react'
import { COINS } from './coins'

// Futures mark price for alle coins, én felles WebSocket (1 oppdatering per sekund per coin).
// NB: Binance flyttet markedsdata-strømmene til /market/ – den gamle stien kobler til, men sender ingenting.
// Ligger utenfor React så papirmotoren kan lese den uten re-rendering.
const prices = new Map<string, number>()
const listeners = new Set<(symbol: string, price: number) => void>()
let ws: WebSocket | null = null
let attempt = 0

function connect() {
  const streams = COINS.map((c) => `${c.symbol.toLowerCase()}@markPrice@1s`).join('/')
  ws = new WebSocket(`wss://fstream.binance.com/market/stream?streams=${streams}`)
  ws.onopen = () => {
    attempt = 0
  }
  ws.onmessage = (ev) => {
    const { data } = JSON.parse(ev.data)
    if (!data?.s || !data.p) return
    const price = parseFloat(data.p)
    prices.set(data.s, price)
    for (const l of listeners) l(data.s, price)
  }
  ws.onclose = () => {
    ws = null
    setTimeout(connect, Math.min(1000 * 2 ** attempt++, 15000))
  }
  ws.onerror = () => ws?.close()
}

export function subscribePrices(listener: (symbol: string, price: number) => void) {
  if (!ws) connect()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const getMarkPrice = (symbol: string) => prices.get(symbol)

export function useMarkPrice(symbol: string) {
  return useSyncExternalStore(
    (cb) => subscribePrices((s) => s === symbol && cb()),
    () => prices.get(symbol),
  )
}

// Alle priser, for sider som viser flere coins
let snapshot: Record<string, number> = {}
export function useMarkPrices() {
  return useSyncExternalStore(
    (cb) =>
      subscribePrices(() => {
        snapshot = Object.fromEntries(prices)
        cb()
      }),
    () => snapshot,
  )
}
