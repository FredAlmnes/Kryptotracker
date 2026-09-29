import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { coinBySymbol } from '../coins'
import { usd, signedUsd, pct, price as fmtPrice, dateTime } from '../format'
import { useMarkPrices } from '../prices'
import { STRATEGIES } from '../strategies'
import { journalStats, unrealizedPnl, usedMargin } from './engine'
import PositionsTable from './PositionsTable'
import { freshState, replacePaper, updatePaper, usePaper } from './store'
import type { PaperState } from './types'

export default function Portfolio() {
  const paper = usePaper()
  const marks = useMarkPrices()
  const [confirmReset, setConfirmReset] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const unrealized = paper.positions.reduce((s, p) => s + (marks[p.symbol] ? unrealizedPnl(p, marks[p.symbol]) : 0), 0)
  const equity = paper.balance + unrealized
  const total = equity / paper.settings.startBalance - 1
  const stats = journalStats(paper)
  const s = paper.settings
  const strategyName = (id?: string) => (id ? (STRATEGIES.find((x) => x.id === id)?.name ?? id) : 'Manuell')

  const setSetting = (key: keyof typeof s, value: number) => {
    if (!Number.isFinite(value) || value <= 0) return
    updatePaper((d) => {
      d.settings[key] = value
    })
  }

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(paper, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `papirkonto-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const importJson = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as PaperState
      if (data.version !== 1 || !Array.isArray(data.positions) || !Array.isArray(data.journal)) throw new Error()
      replacePaper(data)
      setImportError(null)
    } catch {
      setImportError('Filen er ikke en gyldig papirkonto-eksport.')
    }
  }

  return (
    <main className="lab">
      <Link to="/" className="muted">
        ← Alle coins
      </Link>
      <header className="detail-head">
        <h1>Papirkonto</h1>
        <span className="muted small">Binance USDT-M futures-priser · isolated margin · ingen ekte penger</span>
      </header>

      <div className="cards">
        <div className="card">
          <div className="muted small">Egenkapital</div>
          <div className="big">{usd(equity)}</div>
          <div className={total >= 0 ? 'up' : 'down'}>{pct(total)} siden start</div>
        </div>
        <div className="card">
          <div className="muted small">Saldo (realisert)</div>
          <div className="big">{usd(paper.balance)}</div>
          <div className="muted small">Start {usd(s.startBalance, 0)}</div>
        </div>
        <div className="card">
          <div className="muted small">Urealisert</div>
          <div className={`big ${unrealized >= 0 ? 'up' : 'down'}`}>{signedUsd(unrealized)}</div>
          <div className="muted small">{paper.positions.length} åpne</div>
        </div>
        <div className="card">
          <div className="muted small">Brukt / ledig margin</div>
          <div className="big">{usd(usedMargin(paper), 0)}</div>
          <div className="muted small">{usd(paper.balance - usedMargin(paper), 0)} ledig</div>
        </div>
      </div>

      <h2 className="lab-h2">Åpne posisjoner</h2>
      <PositionsTable />

      <h2 className="lab-h2">Statistikk</h2>
      <div className="cards">
        <div className="card">
          <div className="muted small">Handler</div>
          <div className="big">{stats.count}</div>
          <div className="muted small">vinnrate {(stats.winRate * 100).toFixed(0)} %</div>
        </div>
        <div className="card">
          <div className="muted small">Profit factor</div>
          <div className="big">{Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '∞'}</div>
          <div className="muted small">snitt {stats.avgR === null ? '–' : `${stats.avgR.toFixed(2)} R`}</div>
        </div>
        <div className="card">
          <div className="muted small">Største fall (lukkede)</div>
          <div className="big">{pct(-stats.maxDrawdown)}</div>
          <div className="muted small">{stats.liquidations} likvidert</div>
        </div>
        <div className="card">
          <div className="muted small">Avgifter / funding</div>
          <div className="big">{usd(stats.fees, 0)}</div>
          <div className="muted small">funding {usd(stats.funding)}</div>
        </div>
      </div>
      {stats.count > 0 && stats.count < 30 && (
        <p className="muted small">Under 30 handler: sammenlign med backtesten først når du har flere.</p>
      )}

      <h2 className="lab-h2">Handelslogg</h2>
      {!paper.journal.length ? (
        <p className="muted small">Ingen lukkede handler ennå. Åpne en coin og trykk «Ny ordre», eller ta et signal.</p>
      ) : (
        <div className="table-scroll">
          <table className="lab-table">
            <thead>
              <tr>
                <th>Lukket</th>
                <th>Coin</th>
                <th>Strategi</th>
                <th className="num">Inn → ut</th>
                <th>Grunn</th>
                <th className="num">PnL</th>
                <th className="num">R</th>
              </tr>
            </thead>
            <tbody>
              {[...paper.journal]
                .reverse()
                .slice(0, 100)
                .map((t) => (
                  <tr key={t.id}>
                    <td className="muted">
                      {dateTime(t.closedAt)}
                      {t.replayed && <span title="Lukket mens appen var lukket, funnet i ettertid"> ⟲</span>}
                    </td>
                    <td>
                      <span className={t.side === 'long' ? 'up' : 'down'}>{t.side === 'long' ? 'Long' : 'Short'}</span>{' '}
                      {coinBySymbol(t.symbol)?.ticker} <span className="muted">{t.leverage}x</span>
                    </td>
                    <td className="muted">{strategyName(t.strategyId)}</td>
                    <td className="num">
                      {fmtPrice(t.entry)} → {fmtPrice(t.exit)}
                    </td>
                    <td className={t.reason === 'Likvidert' ? 'down' : 'muted'}>{t.reason}</td>
                    <td className={`num ${t.pnl >= 0 ? 'up' : 'down'}`}>{signedUsd(t.pnl)}</td>
                    <td className="num muted">{t.r === null ? '–' : t.r.toFixed(2)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="lab-h2">Innstillinger</h2>
      <div className="settings">
        <label>
          Risiko per handel (%)
          <input type="number" step={0.25} defaultValue={s.riskPct * 100} onBlur={(e) => setSetting('riskPct', Number(e.target.value) / 100)} />
        </label>
        <label>
          Standard giring
          <input type="number" step={1} defaultValue={s.defaultLeverage} onBlur={(e) => setSetting('defaultLeverage', Math.round(Number(e.target.value)))} />
        </label>
        <label>
          Maks giring
          <input type="number" step={1} max={125} defaultValue={s.maxLeverage} onBlur={(e) => setSetting('maxLeverage', Math.min(125, Math.round(Number(e.target.value))))} />
        </label>
        <label>
          Startbeløp (ved nullstilling)
          <input type="number" step={1000} defaultValue={s.startBalance} onBlur={(e) => setSetting('startBalance', Number(e.target.value))} />
        </label>
      </div>
      <div className="intervals" style={{ marginTop: '1rem' }}>
        <button onClick={exportJson}>Last ned backup (JSON)</button>
        <button onClick={() => fileInput.current?.click()}>Importer backup</button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])}
        />
        {!confirmReset ? (
          <button onClick={() => setConfirmReset(true)}>Nullstill konto</button>
        ) : (
          <>
            <button className="down-bg" onClick={() => (replacePaper(freshState(paper.settings)), setConfirmReset(false))}>
              Ja, slett alt og start på {usd(s.startBalance, 0)}
            </button>
            <button onClick={() => setConfirmReset(false)}>Avbryt</button>
          </>
        )}
      </div>
      {importError && <p className="msg error">{importError}</p>}
      <p className="muted small">Lagres bare i denne nettleseren. Ta backup hvis du vil flytte eller beholde den.</p>
    </main>
  )
}
