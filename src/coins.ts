export interface Coin {
  symbol: string // Binance-par, f.eks. BTCUSDT
  name: string
  ticker: string
}

export const COINS: Coin[] = [
  { symbol: 'BTCUSDT', name: 'Bitcoin', ticker: 'BTC' },
  { symbol: 'ETHUSDT', name: 'Ethereum', ticker: 'ETH' },
  { symbol: 'SOLUSDT', name: 'Solana', ticker: 'SOL' },
  { symbol: 'AAVEUSDT', name: 'Aave', ticker: 'AAVE' },
  { symbol: 'AVAXUSDT', name: 'Avalanche', ticker: 'AVAX' },
]
