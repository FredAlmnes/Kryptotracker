import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { COINS } from './coins'
import { useBinanceTickers } from './hooks/useBinanceTickers'
import CandleChart, { INTERVALS, TOGGLES, type Indicators, type Interval } from './CandleChart'
import BacktestPanel from './BacktestPanel'
import { STRATEGIES } from './strategies'

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
      </div>
      <div className="detail-body">
        <CandleChart
          symbol={coin.symbol}
          interval={interval}
          indicators={indicators}
          strategy={strategy}
          allowShort={allowShort}
        />
        {strategy && (
          <BacktestPanel symbol={coin.symbol} interval={interval} strategy={strategy} allowShort={allowShort} />
        )}
      </div>
    </main>
  )
}
