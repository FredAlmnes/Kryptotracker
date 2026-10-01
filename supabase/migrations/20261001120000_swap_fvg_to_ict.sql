-- FVG-retest på 1t tapte ~44 % per coin på ukjent data (2023→). Byttes ut med ICT-modellen,
-- som gikk omtrent i null. Ingen FVG-boter hadde posisjoner eller handler da de ble fjernet.
delete from public.paper_bots
 where strategy_id = 'fvg-structure'
   and not exists (select 1 from public.paper_positions p where p.bot_id = paper_bots.id);

insert into public.paper_bots (id, strategy_id, symbol, interval, risk_pct, experiment) values
  ('ict-1h-btc', 'ict-model', 'BTCUSDT', '1h', 0.005, true),
  ('ict-1h-eth', 'ict-model', 'ETHUSDT', '1h', 0.005, true),
  ('ict-1h-sol', 'ict-model', 'SOLUSDT', '1h', 0.005, true),
  ('ict-1h-aave', 'ict-model', 'AAVEUSDT', '1h', 0.005, true),
  ('ict-1h-avax', 'ict-model', 'AVAXUSDT', '1h', 0.005, true);
