import { Link, useNavigate } from 'react-router-dom'
import { COINS } from './coins'
import { useBinanceTickers, type Tick } from './hooks/useBinanceTickers'
import { useDayTrends } from './hooks/useDayTrends'
import { usePaper } from './paper/store'
import { usd as fmtUsd } from './format'
import './App.css'

const usd = (n: number) =>
  n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: n < 10 ? 4 : 2,
  })

const compact = (n: number) =>
  n.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 })

function Sparkline({ data, up }: { data: number[]; up: boolean }) {
  if (data.length < 2) return <svg className="spark" />
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * 100},${28 - ((v - min) / range) * 26 - 1}`)
    .join(' ')
  return (
    <svg className="spark" viewBox="0 0 100 28" preserveAspectRatio="none">
      <polyline points={pts} fill="none" strokeWidth="1.5" className={up ? 'up' : 'down'} />
    </svg>
  )
}

function Row({ name, ticker, tick, trend }: { name: string; ticker: string; tick?: Tick; trend?: number[] }) {
  const up = (tick?.changePct ?? 0) >= 0
  const navigate = useNavigate()
  return (
    <tr className="clickable" onClick={() => navigate(`/${ticker}`)}>
      <td>
        <Link to={`/${ticker}`} className="coin-link">
          <strong>{ticker}</strong> <span className="muted">{name}</span>
        </Link>
      </td>
      <td className="num">{tick ? usd(tick.price) : '…'}</td>
      <td className={`num ${up ? 'up' : 'down'}`}>
        {tick ? `${up ? '+' : ''}${tick.changePct.toFixed(2)}%` : '…'}
      </td>
      <td className="num muted hide-sm">{tick ? `${usd(tick.low)} – ${usd(tick.high)}` : '…'}</td>
      <td className="num muted hide-sm">{tick ? `$${compact(tick.volume)}` : '…'}</td>
      <td>{trend && tick && <Sparkline data={[...trend, tick.price]} up={tick.price >= trend[0]} />}</td>
    </tr>
  )
}

export default function Overview() {
  const { ticks, status } = useBinanceTickers()
  const trends = useDayTrends()
  const paper = usePaper()
  return (
    <main>
      <header>
        <h1>
          KryptoTracker{' '}
          <Link to="/lab" className="lab-link">
            Strategilab →
          </Link>
          <Link to="/portfolio" className="lab-link">
            Bot {fmtUsd(paper.balance, 0)}
            {paper.positions.length ? ` · ${paper.positions.length} åpne` : ''} →
          </Link>
        </h1>
        <span className={`status ${status}`}>
          {status === 'live' ? '● Live' : status === 'connecting' ? '○ Kobler til…' : '○ Kobler til på nytt…'}
        </span>
      </header>
      <table>
        <thead>
          <tr>
            <th>Coin</th>
            <th className="num">Kurs</th>
            <th className="num">24t</th>
            <th className="num hide-sm">24t lav – høy</th>
            <th className="num hide-sm">Volum 24t</th>
            <th>Siste 24t</th>
          </tr>
        </thead>
        <tbody>
          {COINS.map((c) => (
            <Row key={c.symbol} name={c.name} ticker={c.ticker} tick={ticks[c.symbol]} trend={trends[c.symbol]} />
          ))}
        </tbody>
      </table>
      <footer className="muted">Data: Binance (USDT-par). Kun informasjon, ikke finansiell rådgivning.</footer>
    </main>
  )
}
