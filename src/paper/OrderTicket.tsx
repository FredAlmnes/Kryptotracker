import { useEffect, useMemo, useRef, useState } from 'react'
import { coinBySymbol, roundStep, roundTick } from '../coins'
import { useMarkPrice } from '../prices'
import { hasValidStop, liquidationPrice, safeLeverage, stopBeforeLiq, type Side } from '../sizing'
import { usd, price as fmtPrice, pct } from '../format'
import { buildOpenPayload, fillPrice, MMR, TAKER_FEE, usedMargin } from './engine'
import { openPaperPosition, usePaper } from './store'

export interface TicketPrefill {
  side: Side
  stop?: number
  target?: number
  trail?: { atrMult: number }
  strategyId?: string
  signalId?: string
  note?: string
}

export interface PreviewLine {
  price: number
  color: string
  title: string
}

export default function OrderTicket({
  symbol,
  prefill,
  onClose,
  onPreview,
}: {
  symbol: string
  prefill: TicketPrefill
  onClose: () => void
  onPreview: (lines: PreviewLine[]) => void
}) {
  const paper = usePaper()
  const mark = useMarkPrice(symbol)
  const coin = coinBySymbol(symbol)!
  const [side, setSide] = useState<Side>(prefill.side)
  const [stopStr, setStopStr] = useState(prefill.stop ? String(roundTick(prefill.stop, coin.tick)) : '')
  const [targetStr, setTargetStr] = useState(prefill.target ? String(roundTick(prefill.target, coin.tick)) : '')
  const [useTrail, setUseTrail] = useState(!!prefill.trail)
  const [riskPct, setRiskPct] = useState(String(paper.settings.riskPct * 100))
  const [marginStr, setMarginStr] = useState(String(Math.round(paper.balance * 0.2)))
  const [sending, setSending] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [leverage, setLeverage] = useState(() => {
    const L = paper.settings.defaultLeverage
    if (!prefill.stop) return 1
    const entry = mark ?? prefill.stop
    return Math.max(1, Math.min(L, Math.floor(safeLeverage(entry, prefill.stop, MMR))))
  })

  // giringen settes når første pris kommer: høyest mulig uten at likvidasjon kommer før stopen
  const clamped = useRef(false)
  useEffect(() => {
    if (clamped.current || !mark || !prefill.stop) return
    clamped.current = true
    setLeverage(Math.max(1, Math.min(paper.settings.defaultLeverage, Math.floor(safeLeverage(mark, prefill.stop, MMR)))))
  }, [mark, prefill.stop, paper.settings.defaultLeverage])

  const stop = stopStr ? Number(stopStr) : undefined
  const target = targetStr ? Number(targetStr) : undefined
  const free = paper.balance - usedMargin(paper)

  const plan = useMemo(() => {
    if (!mark) return null
    const entry = fillPrice(side, mark, true)
    const withStop = hasValidStop(side, entry, stop)
    let qty: number
    if (withStop) qty = (paper.balance * (Number(riskPct) / 100)) / Math.abs(entry - stop!)
    else qty = (Number(marginStr) * leverage) / entry
    qty = roundStep(Math.max(0, qty), coin.step)
    const notional = qty * entry
    const margin = notional / leverage
    const liq = liquidationPrice(side, entry, leverage, MMR)
    const fees = notional * TAKER_FEE * 2
    const risk = withStop ? qty * Math.abs(entry - stop!) + fees : null
    const reward =
      target !== undefined && (side === 'long' ? target > entry : target < entry) ? qty * Math.abs(target - entry) - fees : null
    const errors: string[] = []
    const warnings: string[] = []
    if (stop !== undefined && !withStop) errors.push(`Stop må ligge ${side === 'long' ? 'under' : 'over'} kursen.`)
    if (target !== undefined && reward === null) errors.push(`Mål må ligge ${side === 'long' ? 'over' : 'under'} kursen.`)
    if (withStop && !stopBeforeLiq(side, stop!, liq))
      errors.push(
        `Likvidasjon (${fmtPrice(liq)}) kommer før stopen. Senk giringen til maks ${Math.floor(safeLeverage(entry, stop!, MMR))}x.`,
      )
    else if (withStop && Math.abs(entry - liq) < 1.5 * Math.abs(entry - stop!))
      warnings.push('Likvidasjonen ligger nær stopen. Et raskt fall kan hoppe forbi stopen.')
    if (leverage > paper.settings.maxLeverage) errors.push(`Maks giring er ${paper.settings.maxLeverage}x (endres på porteføljesiden).`)
    if (margin > free) errors.push(`Trenger ${usd(margin)} i margin, men bare ${usd(free)} er ledig.`)
    if (notional < coin.minNotional) errors.push(`Minste ordre på Binance er ${usd(coin.minNotional, 0)}.`)
    if (!withStop) warnings.push('Uten stop kan du tape hele marginen hvis kursen går mot deg.')
    if (leverage >= 10) warnings.push(`${leverage}x er høy giring: en bevegelse på ${(100 / leverage).toFixed(1)} % mot deg tar marginen.`)
    if (withStop && Number(riskPct) > 2) warnings.push('Over 2 % risiko per handel: 10 tap på rad (vanlig) gir et stort fall.')
    return { entry, qty, notional, margin, liq, fees, risk, reward, errors, warnings, withStop }
  }, [mark, side, stop, target, leverage, riskPct, marginStr, paper, coin, free])

  useEffect(() => {
    if (!plan) return onPreview([])
    const lines: PreviewLine[] = [{ price: plan.entry, color: '#848e9c', title: 'Inn' }]
    if (plan.withStop) lines.push({ price: stop!, color: '#ea3943', title: useTrail ? 'SL (trailing)' : 'SL' })
    if (target) lines.push({ price: target, color: '#16c784', title: 'TP' })
    if (plan.liq > 0) lines.push({ price: plan.liq, color: '#f0b90b', title: 'Likvidasjon' })
    onPreview(lines)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.entry, plan?.liq, stop, target, useTrail])
  useEffect(() => () => onPreview([]), [onPreview])

  const submit = async () => {
    if (!plan || plan.errors.length || !mark || sending) return
    setSending(true)
    setSubmitError(null)
    try {
      await openPaperPosition(
        buildOpenPayload({
          symbol,
          side,
          qty: plan.qty,
          leverage,
          mark,
          stop: plan.withStop ? stop : undefined,
          target,
          trail: useTrail && plan.withStop && prefill.trail ? prefill.trail : undefined,
          strategyId: prefill.strategyId,
          signalId: prefill.signalId,
        }),
      )
      onClose()
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e))
      setSending(false)
    }
  }

  return (
    <div className="ticket">
      <div className="ticket-head">
        <strong>Ny ordre · {coin.ticker}</strong>
        <button className="link" onClick={onClose}>
          Lukk
        </button>
      </div>
      {prefill.note && <p className="muted small">{prefill.note}</p>}
      <div className="seg">
        <button className={side === 'long' ? 'active up-bg' : ''} onClick={() => setSide('long')}>
          Long
        </button>
        <button className={side === 'short' ? 'active down-bg' : ''} onClick={() => setSide('short')}>
          Short
        </button>
      </div>
      <label>
        Giring <strong>{leverage}x</strong>
        <input
          type="range"
          min={1}
          max={paper.settings.maxLeverage}
          value={leverage}
          onChange={(e) => setLeverage(Number(e.target.value))}
        />
      </label>
      <div className="row2">
        <label>
          Stop loss
          <input type="number" value={stopStr} step={coin.tick} onChange={(e) => setStopStr(e.target.value)} placeholder="ingen" />
        </label>
        <label>
          Take profit
          <input type="number" value={targetStr} step={coin.tick} onChange={(e) => setTargetStr(e.target.value)} placeholder="ingen" />
        </label>
      </div>
      {prefill.trail && (
        <label className="check">
          <input type="checkbox" checked={useTrail} onChange={(e) => setUseTrail(e.target.checked)} />
          Trailing stop ({prefill.trail.atrMult} × ATR, flyttes ved hver 4t-candle)
        </label>
      )}
      {plan?.withStop ? (
        <label>
          Risiko per handel (%)
          <input type="number" value={riskPct} step={0.25} min={0.1} onChange={(e) => setRiskPct(e.target.value)} />
        </label>
      ) : (
        <label>
          Margin (USDT)
          <input type="number" value={marginStr} step={50} min={1} onChange={(e) => setMarginStr(e.target.value)} />
        </label>
      )}

      {!mark && <p className="muted small">Venter på futures-pris…</p>}
      {plan && (
        <table className="stats">
          <tbody>
            <tr>
              <td>Inn (market)</td>
              <td className="num">{fmtPrice(plan.entry)}</td>
            </tr>
            <tr>
              <td>Posisjon</td>
              <td className="num">
                {plan.qty} {coin.ticker} · {usd(plan.notional)}
              </td>
            </tr>
            <tr>
              <td>Margin</td>
              <td className="num">
                {usd(plan.margin)} <span className="muted">av {usd(free)} ledig</span>
              </td>
            </tr>
            <tr>
              <td>Likvidasjon</td>
              <td className="num">
                {plan.liq > 0 ? `${fmtPrice(plan.liq)} (${pct((plan.liq - plan.entry) / plan.entry)})` : 'ingen (1x long)'}
              </td>
            </tr>
            {plan.risk !== null && (
              <tr>
                <td>Tap ved stop</td>
                <td className="num down">
                  −{usd(plan.risk)} ({((plan.risk / paper.balance) * 100).toFixed(2)} %)
                </td>
              </tr>
            )}
            {plan.reward !== null && (
              <tr>
                <td>Gevinst ved mål</td>
                <td className="num up">
                  +{usd(plan.reward)}
                  {plan.risk ? ` · R:R 1:${(plan.reward / plan.risk).toFixed(1)}` : ''}
                </td>
              </tr>
            )}
            <tr>
              <td>Avgifter inn + ut</td>
              <td className="num muted">
                ≈ {usd(plan.fees)} · funding ≈ {usd(plan.notional * 0.0001)}/8t
              </td>
            </tr>
          </tbody>
        </table>
      )}
      {plan?.errors.map((e) => (
        <p key={e} className="msg error">
          {e}
        </p>
      ))}
      {plan?.warnings.map((w) => (
        <p key={w} className="msg warn">
          {w}
        </p>
      ))}
      {submitError && <p className="msg error">{submitError}</p>}
      <button
        className={`submit ${side === 'long' ? 'up-bg' : 'down-bg'}`}
        disabled={!plan || plan.errors.length > 0 || sending}
        onClick={submit}
      >
        {sending ? 'Sender…' : `Åpne ${side} ${coin.ticker} i papirkontoen`}
      </button>
      <p className="muted small">Serveren sjekker stop, mål og likvidasjon hvert minutt, også når appen er lukket.</p>
    </div>
  )
}
