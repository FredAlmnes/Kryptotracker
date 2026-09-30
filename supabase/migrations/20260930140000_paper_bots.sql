-- Boter: serveren kjører strategiene selv og åpner/lukker posisjoner i papirkontoen.

create table public.paper_bots (
  id text primary key,
  enabled boolean not null default true,
  strategy_id text not null,
  symbol text not null,
  interval text not null,
  allow_short boolean not null default false,
  risk_pct float8 not null default 0.01 check (risk_pct > 0 and risk_pct <= 0.1),
  max_leverage float8 not null default 5 check (max_leverage >= 1 and max_leverage <= 125),
  last_candle bigint, -- åpningstid (ms) for siste lukkede lys boten har vurdert
  last_action text,
  last_action_at bigint
);

alter table public.paper_bots enable row level security;
create policy "Alle kan se botene" on public.paper_bots for select using (true);
alter publication supabase_realtime add table public.paper_bots;

-- Utgangspunkt fra analysene: EMA-trend 4t, bare long, BTC/ETH/SOL, 1 % risiko, maks 5x
insert into public.paper_bots (id, strategy_id, symbol, interval) values
  ('ema-trend-4h-btc', 'ema-trend', 'BTCUSDT', '4h'),
  ('ema-trend-4h-eth', 'ema-trend', 'ETHUSDT', '4h'),
  ('ema-trend-4h-sol', 'ema-trend', 'SOLUSDT', '4h');

alter table public.paper_positions add column bot_id text references public.paper_bots (id);
create unique index paper_positions_one_per_bot on public.paper_positions (bot_id) where bot_id is not null;
alter table public.paper_trades add column bot_id text;

-- paper_close tar nå med bot_id i handelsloggen
create or replace function public.paper_close(p_id text, p_price float8, p_reason text, p_time bigint, p_by_server boolean default false)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  pos paper_positions;
  sgn int;
  gross float8;
  exit_fee float8;
  fees float8;
  pnl float8;
begin
  if not (paper_is_owner() or paper_is_engine()) then raise exception 'Ingen tilgang'; end if;
  delete from paper_positions where id = p_id returning * into pos;
  if not found then return false; end if;
  sgn := case when pos.side = 'long' then 1 else -1 end;
  if p_reason = 'Likvidert' then
    gross := -pos.margin;
    exit_fee := 0;
  else
    gross := sgn * pos.qty * (p_price - pos.entry);
    exit_fee := pos.qty * p_price * 0.0005;
  end if;
  fees := pos.fees + exit_fee;
  pnl := gross - fees - pos.funding;
  update paper_account set balance = balance + gross - exit_fee where id = 1;
  insert into paper_trades (id, symbol, side, qty, leverage, entry, exit, opened_at, closed_at, reason, pnl, fees,
    funding, r, strategy_id, by_server, bot_id)
  values (pos.id, pos.symbol, pos.side, pos.qty, pos.leverage, pos.entry, p_price, pos.opened_at, p_time, p_reason,
    pnl, fees, pos.funding, case when pos.risk_usd > 0 then pnl / pos.risk_usd end, pos.strategy_id, p_by_server,
    pos.bot_id);
  return true;
end $$;

-- Motoren åpner på vegne av en bot (samme kontroller som paper_open, men uten eier-sjekk)
create function public.paper_bot_open(p_bot_id text, p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  acc paper_account;
  used float8;
  new_id text;
  opened bigint := (p ->> 'opened_at')::bigint;
begin
  if not paper_is_engine() then raise exception 'Bare motoren'; end if;
  select * into acc from paper_account where id = 1 for update;
  if exists (select 1 from paper_positions where bot_id = p_bot_id) then return null; end if;
  select coalesce(sum(margin), 0) into used from paper_positions;
  if (p ->> 'margin')::float8 > acc.balance - used then raise exception 'Ikke nok ledig margin'; end if;

  insert into paper_positions (symbol, side, qty, entry, leverage, margin, liq, stop, target, trail_atr_mult,
    trail_updated_at, opened_at, fees, last_funding_time, risk_usd, strategy_id, signal_id, checked_until, bot_id)
  values (p ->> 'symbol', p ->> 'side', (p ->> 'qty')::float8, (p ->> 'entry')::float8, (p ->> 'leverage')::float8,
    (p ->> 'margin')::float8, (p ->> 'liq')::float8, (p ->> 'stop')::float8, (p ->> 'target')::float8,
    (p ->> 'trail_atr_mult')::float8, case when p ->> 'trail_atr_mult' is not null then opened end,
    opened, (p ->> 'fees')::float8, opened, (p ->> 'risk_usd')::float8, p ->> 'strategy_id', p ->> 'signal_id',
    ((opened + 59999) / 60000) * 60000, p_bot_id)
  returning id into new_id;

  update paper_account set balance = balance - (p ->> 'fees')::float8 where id = 1;
  return new_id;
end $$;

create function public.paper_bot_mark(p_id text, p_last_candle bigint, p_action text, p_time bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not paper_is_engine() then raise exception 'Bare motoren'; end if;
  update paper_bots
     set last_candle = greatest(coalesce(last_candle, 0), p_last_candle),
         last_action = coalesce(p_action, last_action),
         last_action_at = case when p_action is null then last_action_at else p_time end
   where id = p_id;
end $$;

-- Eieren kan slå boter av/på og endre risiko
create function public.paper_update_bot(p_id text, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not paper_is_owner() then raise exception 'Bare eieren kan endre botene'; end if;
  update paper_bots
     set enabled = coalesce((p ->> 'enabled')::boolean, enabled),
         allow_short = coalesce((p ->> 'allow_short')::boolean, allow_short),
         risk_pct = coalesce((p ->> 'risk_pct')::float8, risk_pct),
         max_leverage = coalesce((p ->> 'max_leverage')::float8, max_leverage)
   where id = p_id;
end $$;

revoke execute on function public.paper_bot_open, public.paper_bot_mark from public, anon, authenticated;
