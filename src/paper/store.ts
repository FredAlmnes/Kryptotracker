import { useSyncExternalStore } from 'react'
import { supabase } from '../supabase'
import type { PaperPosition, PaperSettings, PaperState, PaperTrade } from './types'

// Felles papirkonto i Supabase. Alle ser den samme, og endringer kommer inn live (Realtime).

export const DEFAULT_SETTINGS: PaperSettings = { startBalance: 10000, riskPct: 0.01, defaultLeverage: 5, maxLeverage: 20 }

let state: PaperState = {
  loaded: false,
  balance: DEFAULT_SETTINGS.startBalance,
  positions: [],
  journal: [],
  settings: DEFAULT_SETTINGS,
  takenSignals: [],
  createdAt: Date.now(),
  engineCheckedAt: null,
}
let loadError: string | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/* eslint-disable @typescript-eslint/no-explicit-any */
const toPosition = (r: any): PaperPosition => ({
  id: r.id,
  symbol: r.symbol,
  side: r.side,
  qty: r.qty,
  entry: r.entry,
  leverage: r.leverage,
  margin: r.margin,
  liq: r.liq,
  stop: r.stop ?? undefined,
  target: r.target ?? undefined,
  trail: r.trail_atr_mult ? { atrMult: r.trail_atr_mult, updatedAt: r.trail_updated_at } : undefined,
  openedAt: r.opened_at,
  fees: r.fees,
  funding: r.funding,
  riskUSD: r.risk_usd,
  strategyId: r.strategy_id ?? undefined,
  signalId: r.signal_id ?? undefined,
})

const toTrade = (r: any): PaperTrade => ({
  id: r.id,
  symbol: r.symbol,
  side: r.side,
  qty: r.qty,
  leverage: r.leverage,
  entry: r.entry,
  exit: r.exit,
  openedAt: r.opened_at,
  closedAt: r.closed_at,
  reason: r.reason,
  pnl: r.pnl,
  fees: r.fees,
  funding: r.funding,
  r: r.r,
  strategyId: r.strategy_id ?? undefined,
  byServer: r.by_server,
})
/* eslint-enable @typescript-eslint/no-explicit-any */

async function reload() {
  const [acc, pos, trades] = await Promise.all([
    supabase.from('paper_account').select('*').eq('id', 1).single(),
    supabase.from('paper_positions').select('*').order('opened_at'),
    supabase.from('paper_trades').select('*').order('closed_at', { ascending: false }).limit(1000),
  ])
  const error = acc.error ?? pos.error ?? trades.error
  if (error) {
    loadError = error.message
    emit()
    return
  }
  loadError = null
  state = {
    loaded: true,
    balance: acc.data.balance,
    positions: (pos.data ?? []).map(toPosition),
    journal: (trades.data ?? []).map(toTrade).reverse(),
    settings: { ...DEFAULT_SETTINGS, ...acc.data.settings },
    takenSignals: acc.data.taken_signals ?? [],
    createdAt: acc.data.created_at,
    engineCheckedAt: acc.data.engine_checked_at,
  }
  emit()
}

let timer: ReturnType<typeof setTimeout> | null = null
const scheduleReload = () => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => reload().catch((e) => ((loadError = String(e)), emit())), 150)
}

let started = false
function start() {
  if (started) return
  started = true
  scheduleReload()
  const channel = supabase.channel('paper')
  for (const table of ['paper_account', 'paper_positions', 'paper_trades'])
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, scheduleReload)
  channel.subscribe()
  // sikkerhetsnett hvis Realtime faller ut
  setInterval(scheduleReload, 60_000)
  window.addEventListener('focus', scheduleReload)
}

export const getPaper = () => state

export function usePaper() {
  return useSyncExternalStore(
    (cb) => {
      start()
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
}

export function usePaperError() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => loadError,
  )
}

// ---------- handlinger (bare eieren har lov, databasen sjekker det) ----------

async function call(fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  scheduleReload()
  return data
}

export const openPaperPosition = (payload: Record<string, unknown>) => call('paper_open', { p: payload })
export const closePaperPosition = (id: string, price: number) =>
  call('paper_close', { p_id: id, p_price: price, p_reason: 'Manuell', p_time: Date.now(), p_by_server: false })
export const updatePaperSettings = (patch: Partial<PaperSettings>) => call('paper_update_settings', { p: patch })
export const resetPaper = (startBalance: number) => call('paper_reset', { p_start: startBalance })
