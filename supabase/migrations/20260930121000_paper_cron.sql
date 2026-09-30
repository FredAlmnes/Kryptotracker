-- Kjør papirmotoren hvert minutt, tvunget til EU (Binance blokkerer amerikanske IP-er).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'paper-engine',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://swyvktiretbmztgualnw.supabase.co/functions/v1/paper-engine',
    headers := '{"Content-Type": "application/json", "x-region": "eu-central-1"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
