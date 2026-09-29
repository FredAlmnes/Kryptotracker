import type { CandlestickData, UTCTimestamp } from 'lightweight-charts'

export type Kline = [number, string, string, string, string, ...unknown[]]
export type ChartCandle = CandlestickData<UTCTimestamp>

export const toCandle = (k: Kline): ChartCandle => ({
  time: Math.floor(k[0] / 1000) as UTCTimestamp,
  open: parseFloat(k[1]),
  high: parseFloat(k[2]),
  low: parseFloat(k[3]),
  close: parseFloat(k[4]),
})

export async function fetchKlines(symbol: string, interval: string, limit = 1000, endTime?: number) {
  const end = endTime ? `&endTime=${endTime}` : ''
  const res = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}${end}`,
  )
  if (!res.ok) throw new Error(`Binance svarte ${res.status}`)
  return (await res.json()) as Kline[]
}

// Henter opptil `total` lys bakover i tid, 1000 per kall
export async function fetchHistory(
  symbol: string,
  interval: string,
  total = 5000,
  onProgress?: (loaded: number) => void,
  isCancelled?: () => boolean,
) {
  const pages: ChartCandle[][] = []
  let count = 0
  let end: number | undefined
  while (count < total && !isCancelled?.()) {
    const data = await fetchKlines(symbol, interval, 1000, end)
    if (!data.length) break
    pages.unshift(data.map(toCandle))
    count += data.length
    onProgress?.(count)
    end = data[0][0] - 1
    if (data.length < 1000) break // nådd starten av historikken
  }
  return pages.flat()
}
