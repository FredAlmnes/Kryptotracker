import { useEffect, useState } from 'react'
import { COINS } from '../coins'

export interface Tick {
  price: number
  changePct: number // siste 24t
  high: number
  low: number
  volume: number // USDT
}

export type Status = 'connecting' | 'live' | 'reconnecting'

const URL =
  'wss://stream.binance.com:9443/stream?streams=' +
  COINS.map((c) => `${c.symbol.toLowerCase()}@ticker`).join('/')

export function useBinanceTickers() {
  const [ticks, setTicks] = useState<Record<string, Tick>>({})
  const [status, setStatus] = useState<Status>('connecting')

  useEffect(() => {
    let ws: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout>
    let closed = false
    let attempt = 0

    const connect = () => {
      ws = new WebSocket(URL)
      ws.onopen = () => {
        attempt = 0
        setStatus('live')
      }
      ws.onmessage = (ev) => {
        const { data } = JSON.parse(ev.data)
        if (!data?.s) return
        const price = parseFloat(data.c)
        setTicks((prev) => ({
          ...prev,
          [data.s]: {
            price,
            changePct: parseFloat(data.P),
            high: parseFloat(data.h),
            low: parseFloat(data.l),
            volume: parseFloat(data.q),
          },
        }))
      }
      ws.onclose = () => {
        if (closed) return
        setStatus('reconnecting')
        retry = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 15000))
      }
      ws.onerror = () => ws?.close()
    }

    connect()
    return () => {
      closed = true
      clearTimeout(retry)
      ws?.close()
    }
  }, [])

  return { ticks, status }
}
