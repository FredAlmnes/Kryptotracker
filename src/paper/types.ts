import type { Side } from '../sizing'

export interface PaperSettings {
  startBalance: number
  riskPct: number // standard risiko per handel
  defaultLeverage: number
  maxLeverage: number
}

export interface PaperPosition {
  id: string
  symbol: string
  side: Side
  qty: number
  entry: number
  leverage: number
  margin: number
  liq: number
  stop?: number
  target?: number
  trail?: { atrMult: number; updatedAt: number } // stop flyttes ved hver lukket 4t-candle
  openedAt: number
  fees: number
  funding: number
  riskUSD: number | null
  strategyId?: string
  signalId?: string
}

export type CloseReason = 'Stop' | 'Trailing stop' | 'Mål' | 'Likvidert' | 'Manuell'

export interface PaperTrade {
  id: string
  symbol: string
  side: Side
  qty: number
  leverage: number
  entry: number
  exit: number
  openedAt: number
  closedAt: number
  reason: CloseReason
  pnl: number // netto, etter avgifter og funding
  fees: number
  funding: number
  r: number | null
  strategyId?: string
  byServer: boolean // lukket av motoren på serveren
}

export interface PaperState {
  loaded: boolean
  balance: number // realisert saldo (wallet)
  positions: PaperPosition[]
  journal: PaperTrade[] // eldste først
  settings: PaperSettings
  takenSignals: string[]
  createdAt: number
  engineCheckedAt: number | null
}
