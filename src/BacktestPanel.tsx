import { useEffect, useMemo, useState } from 'react'
import { fetchHistory, type ChartCandle } from './binance'
import { backtest } from './backtest'
import { warmupOf, type Strategy } from './strategies'
import { SIZING_PRESETS } from './sizing'
import SignalCard, { type Signal } from './paper/SignalCard'
import type { TicketPrefill } from './paper/OrderTicket'

const DEPTHS = [
  [5000, '5k lys'],
  [20000, '20k lys'],
  [50000, 'Maks'],
] as const

const pct = (n: number, sign = true) => `${sign && n > 0 ? '+' : ''}${(n * 100).toFixed(1)}%`
const date = (t: number) => new Date(t * 1000).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: '2-digit' })
const dateTime = (t: number) =>
  new Date(t * 1000).toLocaleString('nb-NO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const price = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: n < 10 ? 4 : 2 })

export default function BacktestPanel({
  symbol,
  interval,
  strategy,
  allowShort,
  onTake,
}: {
  symbol: string
  interval: string
  strategy: Strategy
  allowShort: boolean
  onTake: (prefill: TicketPrefill) => void
}) {
  const [candles, setCandles] = useState<ChartCandle[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [depth, setDepth] = useState(5000)
  const [progress, setProgress] = useState(0)
  const [presetId, setPresetId] = useState('spot')
  const preset = SIZING_PRESETS.find((p) => p.id === presetId) ?? SIZING_PRESETS[0]

  useEffect(() => {
    let cancelled = false
    let first = true
    const load = () =>
      fetchHistory(symbol, interval, depth, (n) => first && !cancelled && setProgress(n), () => cancelled)
        .then((c) => {
          first = false
          if (cancelled) return
          setCandles(c.slice(0, -1)) // bare lukkede lys
          setError(null)
        })
        .catch((e) => !cancelled && setError(String(e)))
    setCandles(null)
    setProgress(0)
    load()
    const id = setInterval(load, 5 * 60_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [symbol, interval, depth])

  const r = useMemo(
    () => (candles && candles.length > warmupOf(strategy, candles) + 10 ? backtest(candles, strategy, { allowShort, sizing: preset.sizing, costs: preset.costs }) : null),
    [candles, strategy, allowShort, preset],
  )

  const status = (() => {
    if (!r || !candles) return null
    const signal = r.pending.find((a) => a?.type === 'enter' || a?.type === 'exit')
    if (signal?.type === 'enter')
      return { cls: signal.side === 'long' ? 'up' : 'down', text: `Nytt signal: ${signal.side === 'long' ? 'KJØP' : 'SHORT'}`, sub: signal.reason }
    if (signal?.type === 'exit') return { cls: 'muted', text: 'Nytt signal: EXIT', sub: signal.reason }
    if (r.open) {
      const last = candles.at(-1)!.close
      const ret = r.open.side === 'long' ? last / r.open.entry - 1 : (r.open.entry - last) / r.open.entry
      return {
        cls: r.open.side === 'long' ? 'up' : 'down',
        text: `I ${r.open.side === 'long' ? 'LONG' : 'SHORT'} ${pct(ret)}`,
        sub: `Inn ${dateTime(candles[r.open.entryIndex].time)} @ ${price(r.open.entry)} ${r.open.stop > 0 ? ` · stop ${price(r.open.stop)}` : ''}${r.open.target ? ` · mål ${price(r.open.target)}` : ''}`,
      }
    }
    return { cls: 'muted', text: 'Ingen posisjon', sub: 'Venter på neste signal' }
  })()

  const signal: Signal | null = (() => {
    if (!r || !candles) return null
    const a = r.pending.find((x) => x?.type === 'enter')
    if (a?.type === 'enter')
      return { side: a.side, stop: a.stop, target: a.target, reason: a.reason, since: candles.at(-1)!.time, fresh: true }
    if (r.open && !r.pending.some((x) => x?.type === 'exit'))
      return {
        side: r.open.side,
        stop: r.open.stop,
        target: r.open.target,
        reason: `${r.open.reason} (${dateTime(candles[r.open.entryIndex].time)})`,
        since: candles[r.open.entryIndex].time,
        fresh: false,
      }
    return null
  })()

  return (
    <aside className="panel">
      <h2>{strategy.name}</h2>
      <ul className="rules">
        {strategy.rules.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>
      {interval !== strategy.interval && (
        <p className="note">Strategien er laget for {strategy.interval}-lys. Du ser på {interval}.</p>
      )}

      {error && <p className="down">Kunne ikke hente historikk: {error}</p>}
      <div className="depth">
        <span className="muted small">Periode</span>
        {DEPTHS.map(([n, label]) => (
          <button key={n} className={n === depth ? 'active' : ''} onClick={() => setDepth(n)}>
            {label}
          </button>
        ))}
      </div>

      <div className="depth">
        <span className="muted small">Størrelse</span>
        <select value={presetId} onChange={(e) => setPresetId(e.target.value)}>
          {SIZING_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {!r && !error && (
        <p className="muted">
          Henter historikk… {progress > 0 && `${progress.toLocaleString('nb-NO')} lys`}
        </p>
      )}

      {r && candles && status && (
        <>
          <div className="signal">
            <div className={`signal-text ${status.cls}`}>{status.text}</div>
            <div className="muted small">{status.sub}</div>
          </div>
          {signal && <SignalCard symbol={symbol} interval={interval} strategy={strategy} signal={signal} onTake={onTake} />}

          <h3>
            Backtest{' '}
            <span className="muted small">
              {date(candles[r.start].time)} – {date(candles.at(-1)!.time)} · {candles.length.toLocaleString('nb-NO')} lys
            </span>
          </h3>
          <table className="stats">
            <tbody>
              <tr>
                <td>Strategi</td>
                <td className={`num ${r.totalReturn >= 0 ? 'up' : 'down'}`}>{pct(r.totalReturn)}</td>
              </tr>
              <tr>
                <td>Kjøp og hold</td>
                <td className={`num ${r.buyHold >= 0 ? 'up' : 'down'}`}>{pct(r.buyHold)}</td>
              </tr>
              <tr>
                <td>Største fall (strategi / hold)</td>
                <td className="num">
                  {pct(-r.maxDrawdown, false)} / {pct(-r.buyHoldDrawdown, false)}
                </td>
              </tr>
              <tr>
                <td>Årlig avkastning (CAGR)</td>
                <td className={`num ${r.cagr >= 0 ? 'up' : 'down'}`}>{pct(r.cagr)}</td>
              </tr>
              <tr>
                <td title="Årlig avkastning delt på største fall. Høyere er bedre.">Calmar (avkastning per fall)</td>
                <td className="num">{r.calmar.toFixed(2)}</td>
              </tr>
              <tr>
                <td>Handler</td>
                <td className="num">{r.trades.length}</td>
              </tr>
              <tr>
                <td>Vinnrate</td>
                <td className="num">{pct(r.winRate, false)}</td>
              </tr>
              <tr>
                <td>Profit factor</td>
                <td className="num">{Number.isFinite(r.profitFactor) ? r.profitFactor.toFixed(2) : '∞'}</td>
              </tr>
              <tr>
                <td>Snitt per handel</td>
                <td className="num">{pct(r.avgTrade)}</td>
              </tr>
              <tr>
                <td>Lengste tapsrekke</td>
                <td className="num">{r.longestLosingStreak} på rad</td>
              </tr>
              {r.avgR !== null && preset.sizing.mode === 'risk' && (
                <tr>
                  <td>Snitt R per handel</td>
                  <td className="num">{r.avgR.toFixed(2)} R</td>
                </tr>
              )}
              {preset.sizing.mode !== 'spot' && (
                <>
                  <tr>
                    <td>Likvidasjoner</td>
                    <td className={`num ${r.liquidations ? 'down' : ''}`}>
                      {r.liquidations}
                      {r.ruined && ' · kontoen gikk til 0'}
                    </td>
                  </tr>
                  <tr>
                    <td>Avgifter / funding</td>
                    <td className="num">
                      {pct(-r.totalFees)} / {pct(-r.totalFunding)}
                    </td>
                  </tr>
                </>
              )}
              <tr>
                <td>Tid i markedet</td>
                <td className="num">{pct(r.exposure, false)}</td>
              </tr>
            </tbody>
          </table>
          {r.trades.length < 30 && (
            <p className="note">Under 30 handler: resultatet er mest tilfeldigheter. Prøv et kortere intervall eller en annen coin.</p>
          )}

          <h3>Siste handler</h3>
          <table className="stats trades">
            <tbody>
              {r.trades
                .slice(-12)
                .reverse()
                .map((t) => (
                  <tr key={t.entryIndex} title={`${t.entryReason} → ${t.exitReason}`}>
                    <td className={t.side === 'long' ? 'up' : 'down'}>{t.side === 'long' ? 'Long' : 'Short'}</td>
                    <td className="muted">{dateTime(candles[t.entryIndex].time)}</td>
                    <td className="muted">{t.exitReason}</td>
                    <td className={`num ${t.ret > 0 ? 'up' : 'down'}`}>{pct(t.ret)}</td>
                  </tr>
                ))}
            </tbody>
          </table>

          <p className="muted small">
            Signal på lukket lys, handel på neste åpning.{' '}
            {preset.sizing.mode === 'spot'
              ? 'Spot: 0,15 % kostnad per side, hele kontoen per handel, ingen giring.'
              : 'Futures: 0,1 % per side av posisjonen, funding 0,01 % per 8t, isolated margin. Uten stop brukes 1x.'}
            Historiske resultater er ingen garanti. Ikke finansiell rådgivning.
          </p>
        </>
      )}
    </aside>
  )
}
