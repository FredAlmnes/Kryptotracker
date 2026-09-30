// Bot-beslutning for ett lukket lys. Brukes av motoren på serveren (pakkes med esbuild til
// supabase/functions/paper-engine/bot.bundle.js), så den regner nøyaktig som backtesten i appen.
import { backtest } from './backtest'
import { coinBySymbol, roundStep } from './coins'
import type { Candle } from './indicators'
import { buildOpenPayload, fillPrice } from './paper/engine'
import { FUTURES_COSTS, planPosition } from './sizing'
import { STRATEGIES } from './strategies'

export interface BotConfig {
  id: string
  strategy_id: string
  symbol: string
  allow_short: boolean
  risk_pct: number
  max_leverage: number
}

export interface BotStep {
  exit: string | null // grunn til å lukke botens posisjon
  open: ReturnType<typeof buildOpenPayload> | null
  note: string | null // hvorfor et signal ikke ble tatt, eller hva som skjedde
}

// candles: bare lukkede lys, eldste først. balance/free: kontoens saldo og ledig margin nå.
export function botStep(
  bot: BotConfig,
  candles: Candle[],
  hasPosition: boolean,
  balance: number,
  free: number,
  mark: number,
  now: number,
): BotStep {
  const strategy = STRATEGIES.find((s) => s.id === bot.strategy_id)
  if (!strategy) return { exit: null, open: null, note: `Ukjent strategi ${bot.strategy_id}` }
  const r = backtest(candles, strategy, { allowShort: bot.allow_short })
  const exit = r.pending.find((a) => a?.type === 'exit')
  const enter = r.pending.find((a) => a?.type === 'enter')
  const step: BotStep = { exit: exit?.type === 'exit' && hasPosition ? exit.reason : null, open: null, note: null }
  if (enter?.type !== 'enter' || (hasPosition && !step.exit)) return step

  const coin = coinBySymbol(bot.symbol)
  const entry = fillPrice(enter.side, mark, true)
  const stop = enter.stop > 0 ? enter.stop : undefined
  if (stop !== undefined && (enter.side === 'long' ? stop >= entry : stop <= entry)) {
    step.note = `Signal ${enter.side}, men kursen har allerede passert stopen`
    return step
  }
  const plan = planPosition(
    enter.side,
    balance,
    entry,
    stop,
    { mode: 'risk', riskPct: bot.risk_pct, maxLeverage: bot.max_leverage },
    FUTURES_COSTS,
  )
  if (!plan) return { ...step, note: 'Kunne ikke regne ut størrelse' }
  const leverage = Math.max(1, Math.floor(plan.leverage))
  // hold marginen innenfor det som er ledig (og saldoen)
  const maxNotional = Math.min(free, balance) * leverage * 0.98
  let qty = Math.min(plan.qty, maxNotional / entry)
  if (coin) qty = roundStep(qty, coin.step)
  if (!(qty > 0) || (coin && qty * entry < coin.minNotional)) {
    step.note = `Signal ${enter.side}, men for lite ledig margin`
    return step
  }
  step.open = buildOpenPayload(
    {
      symbol: bot.symbol,
      side: enter.side,
      qty,
      leverage,
      mark,
      stop,
      target: enter.target,
      trail: stop && strategy.trailAtr ? { atrMult: strategy.trailAtr } : undefined,
      strategyId: strategy.id,
      signalId: `${bot.id}|${candles.at(-1)!.time}`,
    },
    now,
  )
  step.note = enter.reason
  return step
}
