import { useEffect, useState } from 'react'
import { COINS } from '../coins'

// Lukkekurser for siste 24 timer (96 x 15m-lys) per coin, oppdatert hvert minutt
export function useDayTrends() {
  const [trends, setTrends] = useState<Record<string, number[]>>({})

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const entries = await Promise.all(
        COINS.map(async (c) => {
          const res = await fetch(
            `https://api.binance.com/api/v3/klines?symbol=${c.symbol}&interval=15m&limit=96`,
          )
          const data: string[][] = await res.json()
          return [c.symbol, data.map((k) => parseFloat(k[4]))] as const
        }),
      )
      if (!cancelled) setTrends(Object.fromEntries(entries))
    }
    const run = () => load().catch(console.error)
    run()
    const id = setInterval(run, 60_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  return trends
}
