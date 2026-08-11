-- Net-worth tracking (SPEC §6.2): assets, contributions/withdrawals and manual value
-- snapshots.
--
-- Same conventions as the expenses schema: money is bigint cents, dates are `date`, every
-- table carries user_id and RLS with `user_id = auth.uid()`.
--
-- The three tables split along how the numbers are *known*: an asset is a definition, an
-- event is money the user moved (and therefore exact), a snapshot is what the broker says
-- the thing is worth today (and therefore only true on its date). Yield is the difference
-- between the two — see SPEC §6.2.

-- ---------------------------------------------------------------------------
-- assets
-- ---------------------------------------------------------------------------

create table public.assets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  name          text not null,
  type          text not null check (
    type in ('cdb', 'tesouro', 'lci_lca', 'fundo', 'acao', 'fii', 'etf', 'cripto', 'poupanca', 'outro')
  ),
  institution   text,                                -- "XP", "Santander", "Nubank"
  indexer       text check (indexer is null or indexer in ('cdi', 'ipca', 'prefixado', 'selic')),
  rate          numeric,                             -- 110 (% do CDI) or 6.5 (% a.a.)
  maturity_date date,
  is_closed     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint assets_name_not_blank check (length(btrim(name)) > 0),
  constraint assets_rate_sane check (rate is null or (rate >= 0 and rate <= 1000))
);

comment on column public.assets.rate is
  'Free-form yield descriptor: percent of the indexer (110 = 110% do CDI) or percent a.a. for prefixado. Documentation only — nothing is projected from it (SPEC §3).';
comment on column public.assets.is_closed is
  'A redeemed/matured asset. Kept for history; excluded from the net-worth total.';

create index assets_user_id_idx on public.assets (user_id);

create trigger touch_assets_updated_at
  before update on public.assets
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- asset_events — contributions and withdrawals
-- ---------------------------------------------------------------------------

create table public.asset_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  asset_id     uuid not null references public.assets (id) on delete cascade,
  date         date not null,
  type         text not null check (type in ('contribution', 'withdrawal')),
  amount_cents bigint not null check (amount_cents > 0),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on column public.asset_events.amount_cents is
  'Always positive. Direction comes from `type`, exactly like transactions.amount_cents.';

create index asset_events_user_asset_idx on public.asset_events (user_id, asset_id, date);

create trigger touch_asset_events_updated_at
  before update on public.asset_events
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- asset_snapshots — "what is it worth today", entered by hand
-- ---------------------------------------------------------------------------

create table public.asset_snapshots (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  asset_id          uuid not null references public.assets (id) on delete cascade,
  date              date not null,
  gross_value_cents bigint not null check (gross_value_cents >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- One value per asset per day: updating twice in a day overwrites instead of creating a
  -- second truth for the same date (SPEC §12).
  constraint asset_snapshots_asset_date_key unique (asset_id, date)
);

create index asset_snapshots_user_date_idx on public.asset_snapshots (user_id, date desc);

create trigger touch_asset_snapshots_updated_at
  before update on public.asset_snapshots
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Grants and RLS — same shape as every other table (SPEC §5.4)
-- ---------------------------------------------------------------------------

alter table public.assets          enable row level security;
alter table public.asset_events    enable row level security;
alter table public.asset_snapshots enable row level security;

do $$
declare
  target text;
begin
  foreach target in array array['assets', 'asset_events', 'asset_snapshots']
  loop
    execute format('revoke all on table public.%I from anon', target);
    execute format(
      'grant select, insert, update, delete on table public.%I to authenticated, service_role',
      target
    );
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))',
      target || '_owner_access',
      target
    );
  end loop;
end;
$$;
