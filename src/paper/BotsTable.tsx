import { useState } from 'react'
import { coinBySymbol } from '../coins'
import { dateTime, pct, signedUsd } from '../format'
import { useMarkPrices } from '../prices'
import { STRATEGIES } from '../strategies'
import { useAuth } from './auth'
import { unrealizedPnl } from './engine'
import { updatePaperBot, usePaper } from './store'

// Botene handler selv på serveren. Eieren kan slå dem av/på og endre risiko.
export default function BotsTable() {
  const paper = usePaper()
  const marks = useMarkPrices()
  const { isOwner } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const update = (id: string, patch: Record<string, unknown>) =>
    updatePaperBot(id, patch).catch((e) => setError(e instanceof Error ? e.message : String(e)))

  if (!paper.bots.length) return <p className="muted small">Ingen boter.</p>
  return (
    <div className="table-scroll">
      <table className="lab-table">
        <thead>
          <tr>
            <th>Bot</th>
            <th>Strategi</th>
            <th className="num">Risiko / maks giring</th>
            <th>Posisjon nå</th>
            <th>Siste handling</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {paper.bots.map((b) => {
            const pos = paper.positions.find((p) => p.botId === b.id)
            const mark = pos ? marks[pos.symbol] : undefined
            const pnl = pos && mark ? unrealizedPnl(pos, mark) : null
            const trades = paper.journal.filter((t) => t.botId === b.id)
            const total = trades.reduce((s, t) => s + t.pnl, 0)
            return (
              <tr key={b.id}>
                <td>
                  <strong>{coinBySymbol(b.symbol)?.ticker ?? b.symbol}</strong> <span className="muted">{b.interval}</span>
                  <div className="muted small">
                    {trades.length} handler · {signedUsd(total)}
                  </div>
                </td>
                <td className="muted">
                  {STRATEGIES.find((s) => s.id === b.strategyId)?.name ?? b.strategyId}
                  {b.allowShort ? ' · long/short' : ' · bare long'}
                </td>
                <td className="num">
                  {isOwner ? (
                    <select
                      value={b.riskPct}
                      onChange={(e) => update(b.id, { risk_pct: Number(e.target.value) })}
                      className="inline-select"
                    >
                      {[0.005, 0.01, 0.015, 0.02, 0.03].map((r) => (
                        <option key={r} value={r}>
                          {(r * 100).toFixed(1)} %
                        </option>
                      ))}
                    </select>
                  ) : (
                    `${(b.riskPct * 100).toFixed(1)} %`
                  )}{' '}
                  <span className="muted">/ {b.maxLeverage}x</span>
                </td>
                <td>
                  {pos ? (
                    <>
                      <span className={pos.side === 'long' ? 'up' : 'down'}>{pos.side === 'long' ? 'Long' : 'Short'}</span>{' '}
                      {pos.leverage}x{' '}
                      {pnl !== null && (
                        <span className={pnl >= 0 ? 'up' : 'down'}>
                          {signedUsd(pnl)} ({pct(pnl / pos.margin)})
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="muted">venter på signal</span>
                  )}
                </td>
                <td className="muted small">
                  {b.lastAction ? (
                    <>
                      {b.lastAction}
                      {b.lastActionAt && <div>{dateTime(b.lastActionAt)}</div>}
                    </>
                  ) : (
                    'ingen ennå'
                  )}
                  {b.lastCandle && <div>sjekket lyset fra {dateTime(b.lastCandle)}</div>}
                </td>
                <td>
                  {isOwner ? (
                    <button
                      className={`small-btn ${b.enabled ? 'up-bg' : ''}`}
                      onClick={() => update(b.id, { enabled: !b.enabled })}
                    >
                      {b.enabled ? 'På' : 'Av'}
                    </button>
                  ) : (
                    <span className={b.enabled ? 'up' : 'muted'}>{b.enabled ? 'På' : 'Av'}</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {error && <p className="msg error">{error}</p>}
      <p className="muted small">
        Botene kjører på serveren. Når et {paper.bots[0]?.interval}-lys lukkes, kjører de strategien med samme kode som
        backtesten, og åpner eller lukker selv. Stop, trailing og funding sjekkes hvert minutt. Et av/på-valg eller ny
        risiko gjelder fra neste signal; åpne posisjoner lukkes ikke av at boten slås av.
      </p>
    </div>
  )
}
