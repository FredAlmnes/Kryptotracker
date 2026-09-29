import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { COINS } from './coins'
import { useBinanceTickers } from './hooks/useBinanceTickers'
import CandleChart, { INTERVALS, TOGGLES, type Indicators, type Interval } from './CandleChart'
import BacktestPanel from './BacktestPanel'
import { STRATEGIES } from './strategies'
import OrderTicket, { type PreviewLine, type TicketPrefill } from './paper/OrderTicket'
import PositionsTable from './paper/PositionsTable'
import { usePaper } from './paper/store'

export default function CoinDetail() {
  const { ticker } = useParams()
  const coin = COINS.find((c) => c.ticker === ticker?.toUpperCase())
  const [interval, setInterval] = useState<Interval>('4h')
  const [indicators, setIndicators] = useState<Indicators>({
    sma20: false,
    sma50: false,
    sma200: true,
    ema: true,
    rsi: false,
    fvg: false,
    swings: false,
  })
  const [strategyId, setStrategyId] = useState<string>(STRATEGIES[0].id)
  const [allowShort, setAllowShort] = useState(true)
  const { ticks } = useBinanceTickers()
  const [ticket, setTicket] = useState<TicketPrefill | null>(null)
  const [preview, setPreview] = useState<PreviewLine[]>([])
  const paper = usePaper()
  const priceLines = useMemo(() => {
    const lines: PreviewLine[] = [...preview]
    for (const p of paper.positions) {
      if (p.symbol !== coin?.symbol) continue
      const label = p.side === 'long' ? 'Long' : 'Short'
      lines.push({ price: p.entry, color: '#848e9c', title: `${label} ${p.leverage}x` })
      if (p.stop) lines.push({ price: p.stop, color: '#ea3943', title: p.trail ? 'SL (trailing)' : 'SL' })
      if (p.target) lines.push({ price: p.target, color: '#16c784', title: 'TP' })
      if (p.liq > 0) lines.push({ price: p.liq, color: '#f0b90b', title: 'Likv.' })
    }
    return lines
  }, [paper.positions, preview, coin?.symbol])

  if (!coin) {
    return (
      <main>
        <Link to="/">← Tilbake</Link>
        <p>Ukjent coin.</p>
      </main>
    )
  }
  const t = ticks[coin.symbol]
  const up = (t?.changePct ?? 0) >= 0
  const strategy = STRATEGIES.find((s) => s.id === strategyId) ?? null

  return (
    <main className="detail">
      <Link to="/" className="muted">
        ← Alle coins
      </Link>
      <header className="detail-head">
        <h1>
          {coin.ticker} <span className="muted">{coin.name}</span>
        </h1>
        {t && (
          <div>
            <span className="big">
              ${t.price.toLocaleString('en-US', { maximumFractionDigits: t.price < 10 ? 4 : 2 })}
            </span>{' '}
            <span className={up ? 'up' : 'down'}>
              {up ? '+' : ''}
              {t.changePct.toFixed(2)}%
            </span>
          </div>
        )}
      </header>
      <div className="intervals">
        {INTERVALS.map((i) => (
          <button key={i} className={i === interval ? 'active' : ''} onClick={() => setInterval(i)}>
            {i}
          </button>
        ))}
      </div>
      <div className="intervals">
        {TOGGLES.map(([key, label]) => (
          <button
            key={key}
            className={indicators[key] ? 'active' : ''}
            onClick={() => setIndicators((p) => ({ ...p, [key]: !p[key] }))}
          >
            {label}
          </button>
        ))}
        <span className="sep" />
        <select value={strategyId} onChange={(e) => setStrategyId(e.target.value)}>
          {STRATEGIES.map((s) => (
            <option key={s.id} value={s.id}>
              Signaler: {s.name}
            </option>
          ))}
          <option value="none">Signaler: av</option>
        </select>
        <button className={allowShort ? 'active' : ''} onClick={() => setAllowShort((v) => !v)}>
          Short
        </button>
        <span className="sep" />
        <button onClick={() => setTicket({ side: 'long' })}>Ny ordre</button>
        <Link to="/portfolio" className="nav-link">
          Papirkonto →
        </Link>
      </div>
      <div className="detail-body">
        <CandleChart
          symbol={coin.symbol}
          interval={interval}
          indicators={indicators}
          strategy={strategy}
          allowShort={allowShort}
          priceLines={priceLines}
        />
        <div className="side">
          {ticket && (
            <OrderTicket
              key={JSON.stringify(ticket)}
              symbol={coin.symbol}
              prefill={ticket}
              onClose={() => setTicket(null)}
              onPreview={setPreview}
            />
          )}
          {paper.positions.some((p) => p.symbol === coin.symbol) && (
            <div className="side-block">
              <h3>Papirposisjoner</h3>
              <PositionsTable symbol={coin.symbol} />
            </div>
          )}
          {strategy && (
            <BacktestPanel
              symbol={coin.symbol}
              interval={interval}
              strategy={strategy}
              allowShort={allowShort}
              onTake={setTicket}
            />
          )}
        </div>
      </div>
    </main>
  )
}
