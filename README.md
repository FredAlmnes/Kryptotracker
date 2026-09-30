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
- **Giring:** backtest med risikostyrt størrelse, futures-avgifter, funding og likvidasjon
- **Strategilab:** alle strategier på alle coins, test på ukjent data og sammenligning av giring
- **Bot med papirkonto (felles, i Supabase):** boter kjører strategiene på serveren og åpner/lukker selv
  (standard: EMA-trend 4t, bare long, BTC/ETH/SOL, 1 % risiko, maks 5x). Alle kan følge kontoen live, bare eieren kan endre.
  En motor på serveren (`supabase/functions/paper-engine`, kjørt hvert minutt av `pg_cron`) utfører
  SL/TP, likvidasjon, trailing stop og funding, også når ingen har appen åpen.

## Supabase

- `supabase/migrations/`: tabeller, tilgangsregler (alle leser, bare eier/motor skriver) og cron-jobben
- `supabase/functions/paper-engine/`: motoren. Må kjøre i EU (`x-region: eu-central-1`), Binance blokkerer USA
- Første innloggede bruker blir eier av kontoen
- Endrer du strategi-koden i `src/`, kjør `npm run deploy:engine` så serveren bruker samme kode

Kun for læring og testing. Ikke finansiell rådgivning.
