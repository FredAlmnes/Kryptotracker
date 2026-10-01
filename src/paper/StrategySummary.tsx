import { useMarkPrices } from '../prices'
import { STRATEGIES } from '../strategies'
import { signedUsd } from '../format'
import { unrealizedPnl } from './engine'
import { usePaper } from './store'

// Hvem tjener faktisk penger? Gevinst/tap per strategi, lukkede og åpne handler.
export default function StrategySummary() {
  const paper = usePaper()
  const marks = useMarkPrices()
  const ids = [...new Set([...paper.bots.map((b) => b.strategyId), ...paper.journal.map((t) => t.strategyId ?? 'manuell')])]
  const rows = ids.map((id) => {
    const trades = paper.journal.filter((t) => (t.strategyId ?? 'manuell') === id)
    const open = paper.positions.filter((p) => (p.strategyId ?? 'manuell') === id)
    const wins = trades.filter((t) => t.pnl > 0)
    const gw = wins.reduce((s, t) => s + t.pnl, 0)
    const gl = -trades.filter((t) => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0)
    const rs = trades.flatMap((t) => (t.r === null ? [] : [t.r]))
    return {
      id,
      name: id === 'manuell' ? 'Manuell' : (STRATEGIES.find((s) => s.id === id)?.name ?? id),
      bots: paper.bots.filter((b) => b.strategyId === id && b.enabled).length,
      count: trades.length,
      winRate: trades.length ? wins.length / trades.length : null,
      pf: gl ? gw / gl : gw > 0 ? Infinity : null,
      avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
      realized: trades.reduce((s, t) => s + t.pnl, 0),
      unrealized: open.reduce((s, p) => s + (marks[p.symbol] ? unrealizedPnl(p, marks[p.symbol]) : 0), 0),
      open: open.length,
    }
  })
  return (
    <div className="table-scroll">
      <table className="lab-table">
        <thead>
          <tr>
            <th>Strategi</th>
            <th className="num">Aktive boter</th>
            <th className="num">Handler</th>
            <th className="num">Vinnrate</th>
            <th className="num">Profit factor</th>
            <th className="num">Snitt R</th>
            <th className="num">Realisert</th>
            <th className="num">Åpne nå</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td className="num muted">{r.bots}</td>
              <td className="num">{r.count}</td>
              <td className="num">{r.winRate === null ? '–' : `${(r.winRate * 100).toFixed(0)} %`}</td>
              <td className="num">{r.pf === null ? '–' : Number.isFinite(r.pf) ? r.pf.toFixed(2) : '∞'}</td>
              <td className="num">{r.avgR === null ? '–' : r.avgR.toFixed(2)}</td>
              <td className={`num ${r.realized > 0 ? 'up' : r.realized < 0 ? 'down' : 'muted'}`}>{signedUsd(r.realized)}</td>
              <td className={`num ${r.unrealized > 0 ? 'up' : r.unrealized < 0 ? 'down' : 'muted'}`}>
                {r.open ? `${r.open} · ${signedUsd(r.unrealized)}` : '–'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        Live-resultater trenger tid: under ~30 handler per strategi er forskjellene mest tilfeldigheter.
      </p>
    </div>
  )
}
