export interface Coin {
  symbol: string // Binance-par, f.eks. BTCUSDT
  name: string
  ticker: string
  // Binance USDT-M futures-regler (exchangeInfo): prissteg, mengdesteg, minste ordre i USDT
  tick: number
  step: number
  minNotional: number
}

export const COINS: Coin[] = [
  { symbol: 'BTCUSDT', name: 'Bitcoin', ticker: 'BTC', tick: 0.1, step: 0.001, minNotional: 50 },
  { symbol: 'ETHUSDT', name: 'Ethereum', ticker: 'ETH', tick: 0.01, step: 0.001, minNotional: 20 },
  { symbol: 'SOLUSDT', name: 'Solana', ticker: 'SOL', tick: 0.01, step: 0.01, minNotional: 5 },
  { symbol: 'AAVEUSDT', name: 'Aave', ticker: 'AAVE', tick: 0.01, step: 0.1, minNotional: 5 },
  { symbol: 'AVAXUSDT', name: 'Avalanche', ticker: 'AVAX', tick: 0.001, step: 1, minNotional: 5 },
]

export const coinBySymbol = (symbol: string) => COINS.find((c) => c.symbol === symbol)

// Rund ned til nærmeste steg, uten flyttallsstøy (0.1 + 0.2 osv.)
export function roundStep(value: number, step: number) {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)))
  return +(Math.floor(value / step + 1e-9) * step).toFixed(decimals)
}
export function roundTick(value: number, tick: number) {
  const decimals = Math.max(0, -Math.floor(Math.log10(tick)))
  return +(Math.round(value / tick) * tick).toFixed(decimals)
}
