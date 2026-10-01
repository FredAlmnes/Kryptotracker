-- Eksperimentboter med lav risiko (0,5 %): strategier/coins som ikke holdt i backtesten, testet live på papir.
alter table public.paper_bots add column experiment boolean not null default false;

insert into public.paper_bots (id, strategy_id, symbol, interval, risk_pct, experiment) values
  ('fvg-1h-btc', 'fvg-structure', 'BTCUSDT', '1h', 0.005, true),
  ('fvg-1h-eth', 'fvg-structure', 'ETHUSDT', '1h', 0.005, true),
  ('fvg-1h-sol', 'fvg-structure', 'SOLUSDT', '1h', 0.005, true),
  ('fvg-1h-aave', 'fvg-structure', 'AAVEUSDT', '1h', 0.005, true),
  ('fvg-1h-avax', 'fvg-structure', 'AVAXUSDT', '1h', 0.005, true),
  ('rsi-1h-btc', 'rsi-reversion', 'BTCUSDT', '1h', 0.005, true),
  ('rsi-1h-eth', 'rsi-reversion', 'ETHUSDT', '1h', 0.005, true),
  ('rsi-1h-sol', 'rsi-reversion', 'SOLUSDT', '1h', 0.005, true),
  ('rsi-1h-aave', 'rsi-reversion', 'AAVEUSDT', '1h', 0.005, true),
  ('rsi-1h-avax', 'rsi-reversion', 'AVAXUSDT', '1h', 0.005, true),
  ('ema-trend-4h-aave', 'ema-trend', 'AAVEUSDT', '4h', 0.005, true),
  ('ema-trend-4h-avax', 'ema-trend', 'AVAXUSDT', '4h', 0.005, true);
