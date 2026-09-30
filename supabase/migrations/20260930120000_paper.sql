-- Felles papirkonto: alle kan lese, bare eieren (og motoren) kan endre.
-- Tider lagres som epoch-millisekunder (bigint), tall som float8, slik appen regner.

create table public.paper_account (
  id int primary key default 1 check (id = 1),
  owner uuid references auth.users (id),
  balance float8 not null default 10000,
  start_balance float8 not null default 10000,
  settings jsonb not null default '{"startBalance":10000,"riskPct":0.01,"defaultLeverage":5,"maxLeverage":20}',
  taken_signals text[] not null default '{}',
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  engine_checked_at bigint,
  engine_lock_until bigint
);
insert into public.paper_account default values;

create table public.paper_positions (
  id text primary key default gen_random_uuid()::text,
  symbol text not null,
  side text not null check (side in ('long', 'short')),
  qty float8 not null check (qty > 0),
  entry float8 not null,
  leverage float8 not null check (leverage >= 1),
  margin float8 not null,
  liq float8 not null,
  stop float8,
  target float8,
  trail_atr_mult float8,
  trail_updated_at bigint,
  opened_at bigint not null,
  fees float8 not null default 0,
  funding float8 not null default 0,
  last_funding_time bigint not null,
  risk_usd float8,
  strategy_id text,
  signal_id text,
  checked_until bigint not null -- motoren har sjekket alle 1m-lys før dette tidspunktet
);

create table public.paper_trades (
  id text primary key,
  symbol text not null,
  side text not null,
  qty float8 not null,
  leverage float8 not null,
  entry float8 not null,
  exit float8 not null,
  opened_at bigint not null,
  closed_at bigint not null,
  reason text not null,
  pnl float8 not null,
  fees float8 not null,
  funding float8 not null,
  r float8,
  strategy_id text,
  by_server boolean not null default false
);
create index paper_trades_closed_at on public.paper_trades (closed_at desc);

alter table public.paper_account enable row level security;
alter table public.paper_positions enable row level security;
alter table public.paper_trades enable row level security;
create policy "Alle kan se kontoen" on public.paper_account for select using (true);
create policy "Alle kan se posisjoner" on public.paper_positions for select using (true);
create policy "Alle kan se handler" on public.paper_trades for select using (true);
-- Ingen skrive-policyer: alle endringer går gjennom funksjonene under.

alter publication supabase_realtime add table public.paper_account, public.paper_positions, public.paper_trades;

-- ---------- tilgang ----------

create function public.paper_is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from paper_account where id = 1 and owner = auth.uid())
$$;

create function public.paper_is_engine() returns boolean
language sql stable as $$
  select coalesce(auth.role(), '') = 'service_role'
$$;

-- Første innloggede bruker blir eier. Etter det kan ingen andre ta over.
create function public.paper_claim_owner() returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  update paper_account set owner = auth.uid() where id = 1 and owner is null;
  return paper_is_owner();
end $$;

-- ---------- handel (eier) ----------

create function public.paper_open(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  acc paper_account;
  used float8;
  new_id text;
  sig text := p ->> 'signal_id';
  opened bigint := (p ->> 'opened_at')::bigint;
begin
  if not paper_is_owner() then raise exception 'Bare eieren kan handle'; end if;
  select * into acc from paper_account where id = 1 for update;
  select coalesce(sum(margin), 0) into used from paper_positions;
  if (p ->> 'margin')::float8 > acc.balance - used then raise exception 'Ikke nok ledig margin'; end if;
  if sig is not null and sig = any (acc.taken_signals) then raise exception 'Signalet er allerede tatt'; end if;

  insert into paper_positions (symbol, side, qty, entry, leverage, margin, liq, stop, target, trail_atr_mult,
    trail_updated_at, opened_at, fees, last_funding_time, risk_usd, strategy_id, signal_id, checked_until)
  values (p ->> 'symbol', p ->> 'side', (p ->> 'qty')::float8, (p ->> 'entry')::float8, (p ->> 'leverage')::float8,
    (p ->> 'margin')::float8, (p ->> 'liq')::float8, (p ->> 'stop')::float8, (p ->> 'target')::float8,
    (p ->> 'trail_atr_mult')::float8, case when p ? 'trail_atr_mult' and p ->> 'trail_atr_mult' is not null then opened end,
    opened, (p ->> 'fees')::float8, opened, (p ->> 'risk_usd')::float8, p ->> 'strategy_id', sig,
    ((opened + 59999) / 60000) * 60000)
  returning id into new_id;

  update paper_account
     set balance = balance - (p ->> 'fees')::float8,
         taken_signals = case when sig is null then taken_signals else (taken_signals || sig)[greatest(1, cardinality(taken_signals) - 198):] end
   where id = 1;
  return new_id;
end $$;

-- Lukker én gang (delete ... returning), uansett om eieren og motoren prøver samtidig
create function public.paper_close(p_id text, p_price float8, p_reason text, p_time bigint, p_by_server boolean default false)
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
    funding, r, strategy_id, by_server)
  values (pos.id, pos.symbol, pos.side, pos.qty, pos.leverage, pos.entry, p_price, pos.opened_at, p_time, p_reason,
    pnl, fees, pos.funding, case when pos.risk_usd > 0 then pnl / pos.risk_usd end, pos.strategy_id, p_by_server);
  return true;
end $$;

create function public.paper_update_settings(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not paper_is_owner() then raise exception 'Bare eieren kan endre innstillinger'; end if;
  update paper_account set settings = settings || p where id = 1;
end $$;

create function public.paper_reset(p_start float8) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not paper_is_owner() then raise exception 'Bare eieren kan nullstille'; end if;
  if p_start is null or p_start <= 0 then raise exception 'Ugyldig startbeløp'; end if;
  delete from paper_positions where true;
  delete from paper_trades where true;
  update paper_account
     set balance = p_start, start_balance = p_start, taken_signals = '{}',
         settings = settings || jsonb_build_object('startBalance', p_start),
         created_at = (extract(epoch from now()) * 1000)::bigint
   where id = 1;
end $$;

-- ---------- motoren (service role) ----------

create function public.paper_engine_begin(p_now bigint) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not paper_is_engine() then raise exception 'Bare motoren'; end if;
  update paper_account set engine_lock_until = p_now + 50000
   where id = 1 and (engine_lock_until is null or engine_lock_until < p_now);
  return found;
end $$;

create function public.paper_engine_end(p_now bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not paper_is_engine() then raise exception 'Bare motoren'; end if;
  update paper_account set engine_checked_at = p_now, engine_lock_until = null where id = 1;
end $$;

create function public.paper_progress(p_id text, p_stop float8, p_trail_updated_at bigint, p_checked_until bigint)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not paper_is_engine() then raise exception 'Bare motoren'; end if;
  update paper_positions
     set stop = p_stop, trail_updated_at = p_trail_updated_at, checked_until = greatest(checked_until, p_checked_until)
   where id = p_id;
end $$;

create function public.paper_funding(p_id text, p_rate float8, p_mark float8, p_time bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  pos paper_positions;
  amount float8;
begin
  if not paper_is_engine() then raise exception 'Bare motoren'; end if;
  select * into pos from paper_positions where id = p_id for update;
  if not found or p_time <= pos.last_funding_time then return; end if;
  amount := (case when pos.side = 'long' then 1 else -1 end) * pos.qty * p_mark * p_rate; -- positiv = kontoen betaler
  update paper_positions set funding = funding + amount, last_funding_time = p_time where id = p_id;
  update paper_account set balance = balance - amount where id = 1;
end $$;

revoke execute on function public.paper_engine_begin, public.paper_engine_end, public.paper_progress, public.paper_funding
  from public, anon, authenticated;
