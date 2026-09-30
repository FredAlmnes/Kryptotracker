// Papirmotoren: kjøres hvert minutt av pg_cron. Sjekker åpne posisjoner mot Binance futures 1m-lys,
// flytter trailing stop ved 4t-lukk, trekker funding og lar botene handle når et lys lukkes.
// Må kjøre i EU (Binance blokkerer USA).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { H4, H8, trailPointsFrom, walk, type EnginePosition, type Kline } from './core.ts'
// Strategi-, backtest- og størrelseskoden fra appen (src/bot.ts), pakket med `npm run build:engine`
import { botStep } from './bot.bundle.js'

const INTERVAL_MS: Record<string, number> = { '1h': 3600_000, '4h': H4, '1d': 24 * 3600_000 }

const FAPI = 'https://fapi.binance.com/fapi/v1'
const MINUTE = 60_000
const MAX_BARS = 1500 * 10 // maks ~10 døgn per kjøring; resten tas neste minutt

async function klines(symbol: string, interval: string, start: number, end: number, max = MAX_BARS) {
  const out: Kline[] = []
  let from = start
  while (from <= end && out.length < max) {
    const res = await fetch(`${FAPI}/klines?symbol=${symbol}&interval=${interval}&startTime=${from}&endTime=${end}&limit=1500`)
    if (!res.ok) throw new Error(`Binance ${res.status}: ${await res.text()}`)
    const data = (await res.json()) as Kline[]
    if (!data.length) break
    out.push(...data)
    from = data[data.length - 1][0] + 1
    if (data.length < 1500) break
  }
  return out
}

Deno.serve(async () => {
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
  const now = Date.now()
  const { data: gotLock, error: lockError } = await db.rpc('paper_engine_begin', { p_now: now })
  if (lockError) return Response.json({ error: lockError.message }, { status: 500 })
  if (!gotLock) return Response.json({ skipped: 'en annen kjøring pågår' })

  const log: string[] = []
  try {
    const { data: positions, error } = await db.from('paper_positions').select('*')
    if (error) throw error
    const lastClosedMinute = Math.floor(now / MINUTE) * MINUTE - 1 // bare ferdige 1m-lys

    for (const p of (positions ?? []) as EnginePosition[]) {
      try {
        // 1) stop / mål / likvidasjon, minutt for minutt
        if (lastClosedMinute >= p.checked_until) {
          const bars = await klines(p.symbol, '1m', p.checked_until, lastClosedMinute)
          const points =
            p.trail_atr_mult && p.trail_updated_at !== null
              ? trailPointsFrom(await klines(p.symbol, '4h', p.trail_updated_at - 40 * H4, now, 300), p.trail_updated_at, now)
              : []
          const r = walk(p, bars, points)
          if (r.hit) {
            await db.rpc('paper_close', { p_id: p.id, p_price: r.hit.price, p_reason: r.hit.reason, p_time: r.hit.time, p_by_server: true })
            log.push(`${p.symbol} ${p.side}: ${r.hit.reason} @ ${r.hit.price}`)
            continue
          }
          await db.rpc('paper_progress', {
            p_id: p.id,
            p_stop: r.stop,
            p_trail_updated_at: r.trailUpdatedAt,
            p_checked_until: r.checkedUntil,
          })
          if (r.stop !== p.stop) log.push(`${p.symbol}: trailing stop ${p.stop} → ${r.stop}`)
        }

        // 2) funding kl. 00, 08 og 16 UTC
        if (Math.floor(now / H8) > Math.floor(p.last_funding_time / H8)) {
          const res = await fetch(`${FAPI}/fundingRate?symbol=${p.symbol}&startTime=${p.last_funding_time + 1}&endTime=${now}&limit=100`)
          if (res.ok) {
            const rows = (await res.json()) as { fundingTime: number; fundingRate: string; markPrice: string }[]
            for (const f of rows) {
              await db.rpc('paper_funding', { p_id: p.id, p_rate: +f.fundingRate, p_mark: +f.markPrice, p_time: f.fundingTime })
              log.push(`${p.symbol}: funding ${f.fundingRate}`)
            }
          }
        }
      } catch (e) {
        log.push(`${p.symbol}: feil ${e instanceof Error ? e.message : e}`)
      }
    }

    // 3) botene: vurder hvert nylig lukkede lys med samme strategi-kode som backtesten
    const { data: bots } = await db.from('paper_bots').select('*').eq('enabled', true)
    for (const bot of bots ?? []) {
      const ms = INTERVAL_MS[bot.interval]
      if (!ms) continue
      const closedOpen = Math.floor(now / ms) * ms - ms // åpningstid for siste lukkede lys
      if ((bot.last_candle ?? 0) >= closedOpen) continue
      try {
        const bars = await klines(bot.symbol, bot.interval, closedOpen - 499 * ms, closedOpen, 500)
        const candles = bars
          .filter((k) => k[0] <= closedOpen)
          .map((k) => ({ time: k[0] / 1000, open: +k[1], high: +k[2], low: +k[3], close: +k[4] }))
        const [{ data: acc }, { data: open }, markRes] = await Promise.all([
          db.from('paper_account').select('balance').eq('id', 1).single(),
          db.from('paper_positions').select('id, bot_id, side, margin'),
          fetch(`${FAPI}/premiumIndex?symbol=${bot.symbol}`),
        ])
        const mark = +(await markRes.json()).markPrice
        const mine = (open ?? []).find((x) => x.bot_id === bot.id)
        const used = (open ?? []).reduce((sum, x) => sum + x.margin, 0)
        const step = botStep(bot, candles, !!mine, acc!.balance, acc!.balance - used, mark, Date.now())
        let action: string | null = null
        if (step.exit && mine) {
          const exitPrice = mark * (1 + (mine.side === 'long' ? -1 : 1) * 0.0005)
          await db.rpc('paper_close', { p_id: mine.id, p_price: exitPrice, p_reason: 'Signal', p_time: Date.now(), p_by_server: true })
          action = `Lukket ${mine.side}: ${step.exit}`
        }
        if (step.open) {
          const { error: openError } = await db.rpc('paper_bot_open', { p_bot_id: bot.id, p: step.open })
          action = openError ? `Kunne ikke åpne: ${openError.message}` : `Åpnet ${step.open.side} ${step.open.qty} @ ${step.open.entry.toFixed(2)} (${step.note})`
        } else if (!action && step.note) action = step.note
        await db.rpc('paper_bot_mark', { p_id: bot.id, p_last_candle: closedOpen, p_action: action, p_time: Date.now() })
        log.push(`bot ${bot.id}: ${action ?? 'ingen signal'}`)
      } catch (e) {
        log.push(`bot ${bot.id}: feil ${e instanceof Error ? e.message : e}`)
      }
    }
  } finally {
    await db.rpc('paper_engine_end', { p_now: now })
  }
  return Response.json({ ok: true, log })
})
