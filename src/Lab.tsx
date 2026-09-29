import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { COINS } from './coins'
import { fetchHistory, type ChartCandle } from './binance'
import { runGrid, runLab, runSizing, type Segment } from './labEngine'
import { SIZING_PRESETS } from './sizing'
import { makeEmaTrend, STRATEGIES } from './strategies'

const INTERVALS = ['1h', '4h', '1d'] as const
const SPLITS = [2022, 2023, 2024]
const FASTS = [10, 15, 20, 25, 30]
const SLOWS = [40, 50, 60, 80, 100]

// hold hentet historikk i minnet, så det går raskt å bytte frem og tilbake
const cache = new Map<string, ChartCandle[]>()

const pct = (n: number | undefined) =>
  n === undefined || Number.isNaN(n) ? '–' : `${n > 0 ? '+' : ''}${(n * 100).toFixed(0)}%`
const cls = (n: number | undefined) => (n === undefined ? 'muted' : n >= 0 ? 'up' : 'down')

function Cells({ seg, detail }: { seg: Segment; detail: boolean }) {
  const r = seg.result
  if (!r) return <td className="num muted" colSpan={detail ? 5 : 2}>for lite data</td>
  const beat = r.totalReturn > r.buyHold
  return (
    <>
      <td className={`num ${cls(r.totalReturn)} ${beat ? 'beat' : ''}`}>{pct(r.totalReturn)}</td>
      <td className="num muted">{pct(r.buyHold)}</td>
      {detail && (
        <>
          <td className="num">
            {pct(-r.maxDrawdown)} <span className="muted">/ {pct(-r.buyHoldDrawdown)}</span>
          </td>
          <td className="num muted">{r.trades.length}</td>
          <td className={`num ${r.profitFactor >= 1 ? 'up' : 'down'}`}>
            {Number.isFinite(r.profitFactor) ? r.profitFactor.toFixed(2) : '∞'}
          </td>
        </>
      )}
    </>
  )
}

export default function Lab() {
  const [interval, setInterval] = useState<(typeof INTERVALS)[number]>('4h')
  const [allowShort, setAllowShort] = useState(false)
  const [splitYear, setSplitYear] = useState(2023)
  const [data, setData] = useState<Record<string, ChartCandle[]> | null>(null)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sizingStrategyId, setSizingStrategyId] = useState('ema-trend')

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    ;(async () => {
      // alle coins hentes samtidig
      const counts: Record<string, number> = {}
      const entries = await Promise.all(
        COINS.map(async (coin) => {
          const key = `${coin.symbol}|${interval}`
          let c = cache.get(key)
          if (!c) {
            c = (
              await fetchHistory(
                coin.symbol,
                interval,
                50000,
                (n) => {
                  counts[coin.symbol] = n
                  const total = Object.values(counts).reduce((a, b) => a + b, 0)
                  if (!cancelled) setProgress(`${total.toLocaleString('nb-NO')} lys`)
                },
                () => cancelled,
              )
            ).slice(0, -1)
            if (!cancelled) cache.set(key, c)
          }
          return [coin.symbol, c] as const
        }),
      )
      if (!cancelled) setData(Object.fromEntries(entries))
    })().catch((e) => !cancelled && setError(String(e)))
    return () => {
      cancelled = true
    }
  }, [interval])

  const split = Date.UTC(splitYear, 0, 1) / 1000
  const rows = useMemo(() => (data ? runLab(data, STRATEGIES, { allowShort, split }) : []), [data, allowShort, split])
  const grid = useMemo(
    () =>
      data
        ? runGrid(data, (fast, slow) => makeEmaTrend({ fast, slow, atrMult: 2.5 }), FASTS, SLOWS, { allowShort, from: split })
        : [],
    [data, allowShort, split],
  )
  const sizingStrategy = STRATEGIES.find((st) => st.id === sizingStrategyId) ?? STRATEGIES[0]
  const sizingRows = useMemo(
    () => (data ? runSizing(data, sizingStrategy, SIZING_PRESETS, { allowShort, from: split }) : []),
    [data, sizingStrategy, allowShort, split],
  )
  const tickerOf = (symbol: string) => COINS.find((c) => c.symbol === symbol)?.ticker ?? symbol

  return (
    <main className="lab">
      <Link to="/" className="muted">
        ← Alle coins
      </Link>
      <header className="detail-head">
        <h1>Strategilab</h1>
      </header>

      <div className="intervals">
        {INTERVALS.map((i) => (
          <button key={i} className={i === interval ? 'active' : ''} onClick={() => setInterval(i)}>
            {i}
          </button>
        ))}
        <span className="sep" />
        <button className={allowShort ? 'active' : ''} onClick={() => setAllowShort((v) => !v)}>
          Short {allowShort ? 'på' : 'av'}
        </button>
        <span className="sep" />
        <span className="muted small label">Test fra</span>
        {SPLITS.map((y) => (
          <button key={y} className={y === splitYear ? 'active' : ''} onClick={() => setSplitYear(y)}>
            {y}
          </button>
        ))}
      </div>

      <p className="note lab-intro">
        Hver strategi kjøres på alle coins med all historikk Binance har. Perioden deles i to:{' '}
        <strong>før {splitYear}</strong>, som er dataene reglene er valgt ut fra, og <strong>fra {splitYear}</strong>, som
        strategien aldri har «sett». Holder den bare i den første perioden, er den trolig tilpasset tilfeldigheter.{' '}
        <strong>Fet grønn</strong> = slo kjøp og hold. Største fall vises som strategi / kjøp og hold.
      </p>

      {error && <p className="down">Kunne ikke hente data: {error}</p>}
      {!data && !error && <p className="muted">Henter historikk… {progress}</p>}

      {data && (
        <>
          <div className="table-scroll">
            <table className="lab-table">
              <thead>
                <tr>
                  <th rowSpan={2}>Strategi</th>
                  <th rowSpan={2}>Coin</th>
                  <th colSpan={2} className="group">
                    Hele perioden
                  </th>
                  <th colSpan={2} className="group">
                    Før {splitYear}
                  </th>
                  <th colSpan={5} className="group">
                    Fra {splitYear} (ukjent data)
                  </th>
                </tr>
                <tr>
                  <th className="num">Strategi</th>
                  <th className="num">Hold</th>
                  <th className="num">Strategi</th>
                  <th className="num">Hold</th>
                  <th className="num">Strategi</th>
                  <th className="num">Hold</th>
                  <th className="num">Største fall</th>
                  <th className="num">Handler</th>
                  <th className="num">PF</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.strategy.id}-${r.symbol}`} className={i % COINS.length === 0 ? 'first' : ''}>
                    <td>{i % COINS.length === 0 ? r.strategy.name : ''}</td>
                    <td>
                      <Link to={`/${tickerOf(r.symbol)}`} className="coin-link">
                        {tickerOf(r.symbol)}
                      </Link>
                    </td>
                    <Cells seg={r.full} detail={false} />
                    <Cells seg={r.inSample} detail={false} />
                    <Cells seg={r.outSample} detail={true} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="lab-h2">Tåler EMA-trend andre tall enn 20/50?</h2>
          <p className="muted small">
            Snittavkastning fra {splitYear} på alle fem coins, {interval}, stop 2,5 × ATR. Undertekst: antall coins i pluss.
            Kjøp og hold i samme periode: <strong>{pct(grid[0]?.[0]?.avgBuyHold)}</strong> i snitt. Er bare én rute god,
            var det flaks. Er hele området jevnt, er strategien robust.
          </p>
          <table className="grid">
            <thead>
              <tr>
                <th>Rask \ treg</th>
                {SLOWS.map((s) => (
                  <th key={s} className="num">
                    EMA {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map((row) => (
                <tr key={row[0].x}>
                  <th>EMA {row[0].x}</th>
                  {row.map((c) => (
                    <td
                      key={c.y}
                      className={`num ${c.x === 20 && c.y === 50 ? 'current' : ''}`}
                      style={{
                        background: Number.isNaN(c.avgReturn)
                          ? undefined
                          : c.avgReturn >= 0
                            ? `rgba(22,199,132,${Math.min(0.45, 0.08 + c.avgReturn / 3)})`
                            : `rgba(234,57,67,${Math.min(0.45, 0.08 - c.avgReturn / 2)})`,
                      }}
                    >
                      <div>{pct(c.avgReturn)}</div>
                      <div className="small muted">
                        {c.profitable}/{c.n} i pluss
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <h2 className="lab-h2">Giring og posisjonsstørrelse</h2>
          <p className="muted small lab-intro">
            Samme signaler, ulik størrelse. <strong>Risiko %</strong> = hva du taper hvis stopen treffes. Giringen bestemmer
            bare hvor mye margin som låses, og settes så lavt at likvidasjon ligger bak stopen. <strong>Calmar</strong> =
            årlig avkastning delt på største fall: høyere er bedre, og viser om giringen faktisk lønner seg. Fra {splitYear},
            futures-kostnader (0,1 % per side + funding) for alt unntatt spot.
          </p>
          <div className="intervals">
            <select value={sizingStrategyId} onChange={(e) => setSizingStrategyId(e.target.value)}>
              {STRATEGIES.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name}
                </option>
              ))}
            </select>
          </div>
          <div className="table-scroll">
            <table className="lab-table">
              <thead>
                <tr>
                  <th>Størrelse</th>
                  {COINS.map((c) => (
                    <th key={c.symbol} className="num">
                      {c.ticker} <span className="muted">avk. / fall</span>
                    </th>
                  ))}
                  <th className="num">Årlig snitt</th>
                  <th className="num">Calmar</th>
                  <th className="num">Likvidert</th>
                  <th className="num">Lengste tapsrekke</th>
                </tr>
              </thead>
              <tbody>
                {sizingRows.map((row) => (
                  <tr key={row.sizing.mode + JSON.stringify(row.sizing)}>
                    <td>{SIZING_PRESETS.find((p) => p.sizing === row.sizing)?.label}</td>
                    {row.perCoin.map(({ symbol, result: r }) => (
                      <td key={symbol} className="num">
                        {r ? (
                          <>
                            <span className={cls(r.totalReturn)}>{pct(r.totalReturn)}</span>{' '}
                            <span className="muted">/ {pct(-r.maxDrawdown)}</span>
                            {r.ruined && ' ☠'}
                          </>
                        ) : (
                          '–'
                        )}
                      </td>
                    ))}
                    <td className={`num ${cls(row.avgCagr)}`}>{pct(row.avgCagr)}</td>
                    <td className="num">
                      <strong>{row.avgCalmar.toFixed(2)}</strong>
                    </td>
                    <td className={`num ${row.liquidations ? 'down' : 'muted'}`}>
                      {row.liquidations}
                      {row.ruined > 0 && ` (${row.ruined} til 0)`}
                    </td>
                    <td className="num muted">{row.longestStreak}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="muted small">
            Ruten med ramme er standardoppsettet (20/50). Kostnad 0,15 % per side er med overalt. Ikke finansiell rådgivning.
          </p>
        </>
      )}
    </main>
  )
}
