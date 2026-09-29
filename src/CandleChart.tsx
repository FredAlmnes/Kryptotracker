import { useEffect, useRef } from 'react'
import {
  CandlestickSeries,
  ColorType,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineData,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import { ema, fvgs, rsi, sma, swings, type Candle } from './indicators'
import { fetchKlines, toCandle, type ChartCandle } from './binance'
import { backtest } from './backtest'
import { warmupOf, type Strategy } from './strategies'
import { ZonesPrimitive } from './zones'

export const INTERVALS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'] as const
export type Interval = (typeof INTERVALS)[number]

export const TOGGLES = [
  ['sma20', 'SMA 20'],
  ['sma50', 'SMA 50'],
  ['sma200', 'SMA 200'],
  ['ema', 'EMA 20/50'],
  ['rsi', 'RSI 14'],
  ['fvg', 'FVG'],
  ['swings', 'Topper/bunner'],
] as const
export type Indicators = Record<(typeof TOGGLES)[number][0], boolean>

const LINES: { key: keyof Indicators; title: string; color: string; calc: (c: Candle[]) => LineData<UTCTimestamp>[] }[] = [
  { key: 'sma20', title: 'SMA 20', color: '#f0b90b', calc: (c) => sma(c, 20) },
  { key: 'sma50', title: 'SMA 50', color: '#3b82f6', calc: (c) => sma(c, 50) },
  { key: 'sma200', title: 'SMA 200', color: '#e5e7eb', calc: (c) => sma(c, 200) },
  { key: 'ema', title: 'EMA 20', color: '#22d3ee', calc: (c) => ema(c, 20) },
  { key: 'ema', title: 'EMA 50', color: '#f472b6', calc: (c) => ema(c, 50) },
]

const GREEN = '#16c784'
const RED = '#ea3943'

type Line = { series: ISeriesApi<'Line'>; calc: (c: Candle[]) => LineData<UTCTimestamp>[] }

export default function CandleChart({
  symbol,
  interval,
  indicators,
  strategy,
  allowShort,
  priceLines = [],
}: {
  symbol: string
  interval: Interval
  indicators: Indicators
  strategy: Strategy | null
  allowShort: boolean
  priceLines?: { price: number; color: string; title: string }[]
}) {
  const box = useRef<HTMLDivElement>(null)
  const chart = useRef<IChartApi | null>(null)
  const series = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const zones = useRef<ZonesPrimitive | null>(null)
  const candles = useRef<ChartCandle[]>([])
  const lines = useRef<Line[]>([])
  const history = useRef({ gen: 0, loading: false, done: false })

  // siste props, så WebSocket-handleren alltid ser gjeldende valg
  const overlayOpts = useRef({ indicators, strategy, allowShort })
  overlayOpts.current = { indicators, strategy, allowShort }
  const source = useRef({ symbol, interval })
  source.current = { symbol, interval }

  const loadOlder = async () => {
    const h = history.current
    const cs = candles.current
    if (h.loading || h.done || !cs.length) return
    h.loading = true
    const gen = h.gen
    const { symbol: sym, interval: iv } = source.current
    try {
      const data = await fetchKlines(sym, iv, 1000, (cs[0].time as number) * 1000 - 1)
      if (gen !== history.current.gen) return // byttet coin/intervall imens
      if (data.length < 1000) h.done = true
      if (!data.length) return
      const older = data.map(toCandle)
      const ts = chart.current?.timeScale()
      const range = ts?.getVisibleLogicalRange()
      candles.current = [...older, ...candles.current]
      series.current?.setData(candles.current)
      // hold utsnittet i ro: alt forskyves med antall nye lys
      if (range) ts?.setVisibleLogicalRange({ from: range.from + older.length, to: range.to + older.length })
      refreshLines()
      refreshOverlays()
    } catch (e) {
      console.error(e)
    } finally {
      if (gen === history.current.gen) h.loading = false
    }
  }

  const refreshLines = () => {
    for (const l of lines.current) l.series.setData(l.calc(candles.current))
  }

  // Markører og soner endres bare når et lys lukkes, ikke for hvert tick
  const refreshOverlays = () => {
    const { indicators: ind, strategy: strat, allowShort: short } = overlayOpts.current
    const cs = candles.current
    const closed = cs.slice(0, -1) // siste lys er fortsatt åpent
    const list: SeriesMarker<Time>[] = []

    if (ind.swings) {
      for (const s of swings(closed, 5)) {
        list.push({
          time: cs[s.index].time,
          position: s.type === 'high' ? 'aboveBar' : 'belowBar',
          shape: 'circle',
          color: '#848e9c',
          size: 0.4,
        })
      }
    }

    if (strat && closed.length > warmupOf(strat, closed)) {
      const r = backtest(closed, strat, { allowShort: short })
      for (const t of r.trades) {
        list.push(entryMarker(cs[t.entryIndex].time, t.side))
        list.push({
          time: cs[t.exitIndex].time,
          position: t.side === 'long' ? 'aboveBar' : 'belowBar',
          shape: 'square',
          color: t.ret > 0 ? GREEN : RED,
          size: 0.6,
          text: `${t.exitReason === 'Stop' ? 'Stop' : t.exitReason === 'Mål' ? 'Mål' : 'Exit'} ${(t.ret * 100).toFixed(1)}%`,
        })
      }
      if (r.open) list.push(entryMarker(cs[r.open.entryIndex].time, r.open.side))
      // nytt signal på siste lukkede lys: handel skjer når dette lyset åpnet
      for (const a of r.pending) {
        if (a?.type === 'enter') list.push({ ...entryMarker(cs[cs.length - 1].time, a.side), text: a.side === 'long' ? 'KJØP nå' : 'SHORT nå' })
      }
    }

    list.sort((a, b) => (a.time as number) - (b.time as number))
    markers.current?.setMarkers(list)

    // bare nylige gap, ellers fylles grafen av gamle bånd
    const off = Math.max(0, closed.length - 400)
    zones.current?.setZones(
      ind.fvg
        ? fvgs(closed.slice(off), 0.3)
            .filter((g) => closed.length - off - (g.filledAt ?? g.index) < 150)
            .map((g) => ({
              from: cs[off + g.index - 2].time,
              to: g.filledAt === null ? null : cs[off + g.filledAt].time,
              top: g.top,
              bottom: g.bottom,
              color: g.side === 'bull' ? 'rgba(22,199,132,0.16)' : 'rgba(234,57,67,0.16)',
            }))
        : [],
    )
  }

  useEffect(() => {
    const c = createChart(box.current!, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#0b0e11' }, textColor: '#848e9c' },
      grid: { vertLines: { color: '#1e2329' }, horzLines: { color: '#1e2329' } },
      rightPriceScale: { borderColor: '#1e2329' },
      timeScale: { borderColor: '#1e2329', timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    })
    const s = c.addSeries(CandlestickSeries, {
      upColor: GREEN,
      downColor: RED,
      borderUpColor: GREEN,
      borderDownColor: RED,
      wickUpColor: GREEN,
      wickDownColor: RED,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    })
    // hent eldre lys når du drar mot venstre kant
    c.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range && range.from < 50) loadOlder()
    })
    const z = new ZonesPrimitive()
    s.attachPrimitive(z)
    markers.current = createSeriesMarkers(s, [])
    zones.current = z
    series.current = s
    chart.current = c
    return () => {
      c.remove()
      chart.current = null
      series.current = null
      markers.current = null
      zones.current = null
    }
  }, [])

  // linjer og RSI-panel
  const lineKey = LINES.map((l) => (indicators[l.key] ? 1 : 0)).join('') + (indicators.rsi ? 1 : 0)
  useEffect(() => {
    const c = chart.current!
    const added: Line[] = []
    for (const l of LINES) {
      if (!indicators[l.key]) continue
      const line = c.addSeries(LineSeries, {
        color: l.color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        title: l.title,
      })
      added.push({ series: line, calc: l.calc })
    }
    if (indicators.rsi) {
      const line = c.addSeries(LineSeries, { color: '#a78bfa', lineWidth: 2, priceLineVisible: false, title: 'RSI 14' }, 1)
      line.createPriceLine({ price: 70, color: RED, lineStyle: 2, lineWidth: 1, axisLabelVisible: true, title: '' })
      line.createPriceLine({ price: 30, color: GREEN, lineStyle: 2, lineWidth: 1, axisLabelVisible: true, title: '' })
      added.push({ series: line, calc: (cs) => rsi(cs, 14) })
      try {
        c.panes()[1]?.setHeight(140)
      } catch {
        /* ignorer */
      }
    }
    lines.current = added
    refreshLines()
    return () => {
      lines.current = []
      for (const l of added) {
        try {
          c.removeSeries(l.series)
        } catch {
          /* grafen er allerede fjernet */
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineKey])

  // entry/SL/TP/likvidasjon for papirposisjoner og ordren du holder på med
  useEffect(() => {
    const s = series.current
    if (!s) return
    const created = priceLines.map((l) =>
      s.createPriceLine({ price: l.price, color: l.color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: l.title }),
    )
    return () => {
      for (const pl of created) {
        try {
          s.removePriceLine(pl)
        } catch {
          /* grafen er fjernet */
        }
      }
    }
  }, [priceLines])

  useEffect(() => {
    refreshOverlays()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicators.fvg, indicators.swings, strategy, allowShort])

  useEffect(() => {
    let cancelled = false
    let ws: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout>
    let attempt = 0
    const s = series.current!
    history.current = { gen: history.current.gen + 1, loading: true, done: false }
    s.setData([])
    candles.current = []
    refreshLines()
    refreshOverlays()

    const load = async () => {
      const data = await fetchKlines(symbol, interval, 1000)
      if (cancelled) return
      const loaded = data.map(toCandle)
      // finere prisformat for billige coins
      const last = loaded.at(-1)?.close ?? 1
      const precision = last < 1 ? 5 : last < 100 ? 3 : 2
      s.applyOptions({ priceFormat: { type: 'price', precision, minMove: 10 ** -precision } })
      candles.current = loaded
      history.current.loading = false
      history.current.done = loaded.length < 1000
      s.setData(loaded)
      refreshLines()
      refreshOverlays()
      // vis de siste ~150 lysene, resten ligger klart hvis du drar bakover
      chart.current?.timeScale().setVisibleLogicalRange({ from: loaded.length - 150, to: loaded.length + 5 })
    }

    const connect = () => {
      ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${interval}`)
      ws.onopen = () => {
        attempt = 0
      }
      ws.onmessage = (ev) => {
        const { k } = JSON.parse(ev.data)
        const candle: ChartCandle = {
          time: Math.floor(k.t / 1000) as UTCTimestamp,
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
        }
        s.update(candle)
        const cs = candles.current
        const isNew = cs.at(-1)?.time !== candle.time
        if (isNew) cs.push(candle)
        else cs[cs.length - 1] = candle
        refreshLines()
        if (isNew) refreshOverlays()
      }
      ws.onclose = () => {
        if (!cancelled) retry = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 15000))
      }
      ws.onerror = () => ws?.close()
    }

    load()
      .then(() => !cancelled && connect())
      .catch(console.error)
    return () => {
      cancelled = true
      clearTimeout(retry)
      ws?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, interval])

  return (
    <div className="chart">
      <div ref={box} className="chart-inner" />
    </div>
  )
}

function entryMarker(time: Time, side: 'long' | 'short'): SeriesMarker<Time> {
  return side === 'long'
    ? { time, position: 'belowBar', shape: 'arrowUp', color: GREEN, text: 'KJØP' }
    : { time, position: 'aboveBar', shape: 'arrowDown', color: RED, text: 'SHORT' }
}
