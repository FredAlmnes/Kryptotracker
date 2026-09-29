import { coinBySymbol } from '../coins'
import { usd, signedUsd, pct, price as fmtPrice } from '../format'
import { useMarkPrices } from '../prices'
import { closePosition, fillPrice, unrealizedPnl } from './engine'
import { updatePaper, usePaper } from './store'

export default function PositionsTable({ symbol }: { symbol?: string }) {
  const paper = usePaper()
  const marks = useMarkPrices()
  const rows = paper.positions.filter((p) => !symbol || p.symbol === symbol)
  if (!rows.length) return <p className="muted small">Ingen åpne posisjoner{symbol ? ` i ${coinBySymbol(symbol)?.ticker}` : ''}.</p>

  return (
    <div className="table-scroll">
      <table className="stats positions">
        <thead>
          <tr>
            <th>Posisjon</th>
            <th className="num">Inn / nå</th>
            <th className="num">PnL</th>
            {!symbol && <th className="num">SL / TP</th>}
            {!symbol && <th className="num">Likv.</th>}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const mark = marks[p.symbol]
            const pnl = mark ? unrealizedPnl(p, mark) : 0
            const ticker = coinBySymbol(p.symbol)?.ticker ?? p.symbol
            return (
              <tr key={p.id}>
                <td>
                  <span className={p.side === 'long' ? 'up' : 'down'}>{p.side === 'long' ? 'Long' : 'Short'}</span> {ticker}{' '}
                  <span className="muted">
                    {p.leverage}x · {usd(p.qty * p.entry, 0)}
                  </span>
                </td>
                <td className="num">
                  {fmtPrice(p.entry)} <span className="muted">/ {mark ? fmtPrice(mark) : '…'}</span>
                </td>
                <td className={`num ${pnl >= 0 ? 'up' : 'down'}`}>
                  {signedUsd(pnl)} <span className="small">({pct(pnl / p.margin)} ROE)</span>
                </td>
                {!symbol && (
                  <td className="num muted">
                    {p.stop ? fmtPrice(p.stop) : '–'}
                    {p.trail ? ' ↗' : ''} / {p.target ? fmtPrice(p.target) : '–'}
                  </td>
                )}
                {!symbol && (
                  <td className="num muted">
                    {p.liq > 0 ? `${fmtPrice(p.liq)}${mark ? ` (${pct((p.liq - mark) / mark)})` : ''}` : '–'}
                  </td>
                )}
                <td className="num">
                  <button
                    className="small-btn"
                    disabled={!mark}
                    onClick={() =>
                      mark && updatePaper((s) => closePosition(s, p.id, fillPrice(p.side, mark, false), 'Manuell'))
                    }
                  >
                    Lukk
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {symbol &&
        rows.map((p) => (
          <p key={p.id} className="muted small">
            SL {p.stop ? fmtPrice(p.stop) : '–'}
            {p.trail ? ' (trailing)' : ''} · TP {p.target ? fmtPrice(p.target) : '–'} · likvidasjon{' '}
            {p.liq > 0 ? fmtPrice(p.liq) : '–'} · funding {usd(-p.funding)}
          </p>
        ))}
    </div>
  )
}
