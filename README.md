# KryptoTracker

Live kryptokurser, candlestick-grafer, indikatorer og backtesting av enkle kjøps-/short-signaler.
Bygget med Vite + React + TypeScript og [lightweight-charts](https://github.com/tradingview/lightweight-charts).
All data kommer fra Binance sine åpne API-er (ingen API-nøkkel).

## Kom i gang

```sh
npm install
npm run dev
```

## Innhold

- **Forside:** live kurs, 24t-endring og 24t-trend for BTC, ETH, SOL, AAVE og AVAX
- **Coin-side:** candlestick-graf (1m–1w) med SMA, EMA, RSI, fair value gaps og topper/bunner
- **Signaler og backtest:** tre strategier i `src/strategies.ts`, testet i `src/backtest.ts`
  (signal på lukket lys, handel på neste åpning, 0,15 % kostnad per side)

Kun for læring og testing. Ikke finansiell rådgivning.
