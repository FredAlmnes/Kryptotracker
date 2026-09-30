import { coinBySymbol } from '../coins'
import { usd, price as fmtPrice } from '../format'
import { useMarkPrice } from '../prices'
import { FUTURES_COSTS, hasValidStop, planPosition, type Side } from '../sizing'
import type { Strategy } from '../strategies'
import type { TicketPrefill } from './OrderTicket'
import { usePaper } from './store'
import { useAuth } from './auth'
import { Link } from 'react-router-dom'

export interface Signal {
  side: Side
  stop?: number
  target?: number
  reason: string
  since: number // tid (sek) for lyset signalet gjelder
  fresh: boolean // nytt signal nå, eller en posisjon strategien allerede har
}

export default function SignalCard({
  symbol,
  interval,
  strategy,
  signal,
  onTake,
}: {
  symbol: string
  interval: string
  strategy: Strategy
  signal: Signal
  onTake: (prefill: TicketPrefill) => void
}) {
  const paper = usePaper()
  const { isOwner } = useAuth()
  const mark = useMarkPrice(symbol)
  const coin = coinBySymbol(symbol)!
  const signalId = `${strategy.id}|${symbol}|${interval}|${signal.since}`
  const taken = paper.takenSignals.includes(signalId)
  const stop = signal.stop && signal.stop > 0 ? signal.stop : undefined
  // uten stop: samme forslag som ordreskjemaet (1x, 20 % av kontoen)
  const plan =
    mark &&
    planPosition(
      signal.side,
      paper.balance,
      mark,
      stop,
      stop
        ? { mode: 'risk', riskPct: paper.settings.riskPct, maxLeverage: paper.settings.defaultLeverage }
        : { mode: 'fraction', frac: 0.2, leverage: 1 },
      FUTURES_COSTS,
    )
  const stale = stop !== undefined && mark !== undefined && !hasValidStop(signal.side, mark, stop)
  const long = signal.side === 'long'

  return (
    <div className={`call ${long ? 'call-long' : 'call-short'}`}>
      <div className="call-head">
        <strong className={long ? 'up' : 'down'}>
          {long ? 'LONG' : 'SHORT'} {coin.ticker}
        </strong>
        <span className="muted small">{signal.fresh ? 'nytt signal' : 'aktivt signal'}</span>
      </div>
      <div className="muted small">{signal.reason}</div>
      <table className="stats">
        <tbody>
          <tr>
            <td>Inn</td>
            <td className="num">{mark ? `≈ ${fmtPrice(mark)} (market)` : '…'}</td>
          </tr>
          <tr>
            <td>Stop loss</td>
            <td className="num">
              {stop ? fmtPrice(stop) : 'ingen'}
              {stop && strategy.trailAtr ? ` · trailing ${strategy.trailAtr}×ATR` : ''}
            </td>
          </tr>
          <tr>
            <td>Take profit</td>
            <td className="num">{signal.target ? fmtPrice(signal.target) : strategy.trailAtr ? 'la vinneren løpe' : 'ingen'}</td>
          </tr>
          {plan && (
            <tr>
              <td>Størrelse</td>
              <td className="num">
                {plan.leverage.toFixed(0)}x · margin {usd(plan.margin, 0)} · {usd(plan.notional, 0)}
              </td>
            </tr>
          )}
          {plan && plan.riskUSD !== null && (
            <tr>
              <td>Risiko</td>
              <td className="num">
                {usd(plan.riskUSD, 0)} ({(paper.settings.riskPct * 100).toFixed(1)} % av kontoen)
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {stale && <p className="msg warn">Kursen har allerede passert stopen. Signalet er utløpt.</p>}
      {!stop && <p className="muted small">Ingen stop i denne strategien: forslaget er 1x og 20 % av kontoen.</p>}
      {!isOwner ? (
        <p className="muted small">
          {taken ? 'Tatt i papirkontoen ✓' : 'Ikke tatt i papirkontoen.'} <Link to="/portfolio">Se kontoen →</Link>
        </p>
      ) : (
      <button
        className={`submit ${long ? 'up-bg' : 'down-bg'}`}
        disabled={taken || stale}
        onClick={() =>
          onTake({
            side: signal.side,
            stop,
            target: signal.target,
            trail: stop && strategy.trailAtr ? { atrMult: strategy.trailAtr } : undefined,
            strategyId: strategy.id,
            signalId,
            note: `${strategy.name}: ${signal.reason}`,
          })
        }
      >
        {taken ? 'Tatt i papirkontoen ✓' : 'Ta i papirkonto…'}
      </button>
      )}
    </div>
  )
}
