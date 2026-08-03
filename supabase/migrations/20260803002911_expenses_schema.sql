-- Expense tracking schema (SPEC §6.1): accounts, categories, transactions, budgets and
-- categorization rules.
--
-- Conventions enforced here:
--   * money is bigint cents, always positive — the sign lives in transactions.type;
--   * transaction dates are `date` (accrual date, i.e. when the purchase happened);
--   * every table has user_id + RLS with `user_id = auth.uid()`, even though the system
--     is single-user;
--   * external_id is unique per user so re-running a sync/import can never duplicate.

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.touch_updated_at() is
  'Generic BEFORE UPDATE trigger that keeps updated_at honest.';

-- ---------------------------------------------------------------------------
-- accounts — where a transaction came from
-- ---------------------------------------------------------------------------

create table public.accounts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  name              text not null,
  type              text not null check (type in ('credit_card', 'checking', 'cash')),
  institution       text,
  pluggy_item_id    text,
  pluggy_account_id text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint accounts_name_not_blank check (length(btrim(name)) > 0)
);

create unique index accounts_pluggy_account_id_key
  on public.accounts (user_id, pluggy_account_id)
  where pluggy_account_id is not null;

create index accounts_user_id_idx on public.accounts (user_id);

create trigger touch_accounts_updated_at
  before update on public.accounts
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- categories — flat, no hierarchy in v1
-- ---------------------------------------------------------------------------

create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  icon        text,                              -- lucide icon name
  color       text,                              -- #rrggbb
  kind        text not null default 'expense' check (kind in ('expense', 'income')),
  is_archived boolean not null default false,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint categories_name_not_blank check (length(btrim(name)) > 0),
  constraint categories_color_format check (color is null or color ~* '^#[0-9a-f]{6}$')
);

-- Case-insensitive uniqueness: "Mercado" and "mercado" are the same category.
create unique index categories_user_name_key on public.categories (user_id, lower(name));

create index categories_user_id_idx on public.categories (user_id);

create trigger touch_categories_updated_at
  before update on public.categories
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- transactions
-- ---------------------------------------------------------------------------

create table public.transactions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  account_id        uuid references public.accounts (id) on delete set null,
  category_id       uuid references public.categories (id) on delete set null,
  date              date not null,
  description       text not null,
  amount_cents      bigint not null check (amount_cents > 0),
  type              text not null check (type in ('expense', 'income')),
  source            text not null default 'manual' check (source in ('manual', 'pluggy', 'csv')),
  external_id       text,
  installment_num   int check (installment_num is null or installment_num >= 1),
  installment_total int check (installment_total is null or installment_total >= 1),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint transactions_description_not_blank check (length(btrim(description)) > 0),
  constraint transactions_installments_paired check (
    (installment_num is null) = (installment_total is null)
    and (installment_num is null or installment_num <= installment_total)
  )
);

comment on column public.transactions.date is
  'Accrual date: when the purchase happened. For instalments, the date of the statement the instalment falls into. Never the invoice payment date.';
comment on column public.transactions.amount_cents is
  'Always positive. Direction comes from `type`.';
comment on column public.transactions.external_id is
  'Pluggy transaction id or CSV row hash. Unique per user — the dedup key for sync/import.';

create unique index transactions_external_id_key
  on public.transactions (user_id, external_id)
  where external_id is not null;

-- The dashboard always queries one month at a time, newest first.
create index transactions_user_date_idx on public.transactions (user_id, date desc);
create index transactions_user_category_idx on public.transactions (user_id, category_id);

create trigger touch_transactions_updated_at
  before update on public.transactions
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- budgets — one amount per category per month
-- ---------------------------------------------------------------------------

create table public.budgets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  category_id  uuid not null references public.categories (id) on delete cascade,
  month        date not null,
  amount_cents bigint not null check (amount_cents >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint budgets_month_is_first_day check (extract(day from month) = 1),
  constraint budgets_category_month_key unique (user_id, category_id, month)
);

comment on column public.budgets.month is 'Always the first day of the month (2026-08-01).';

create index budgets_user_month_idx on public.budgets (user_id, month);

create trigger touch_budgets_updated_at
  before update on public.budgets
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- category_rules — automatic categorization, consumed by the sync in phase 3
-- ---------------------------------------------------------------------------

create table public.category_rules (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  matcher     text not null,                     -- case-insensitive substring of the description
  category_id uuid not null references public.categories (id) on delete cascade,
  priority    int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint category_rules_matcher_not_blank check (length(btrim(matcher)) > 0)
);

create index category_rules_user_priority_idx on public.category_rules (user_id, priority desc);

create trigger touch_category_rules_updated_at
  before update on public.category_rules
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Grants and RLS — every table, same shape
-- ---------------------------------------------------------------------------
--
-- Table privileges are not inherited from any default ACL here (this Postgres grants new
-- public tables nothing beyond Dxtm), so they are spelled out. `anon` deliberately gets
-- nothing at all: reaching any of this data requires a session.

alter table public.accounts       enable row level security;
alter table public.categories     enable row level security;
alter table public.transactions   enable row level security;
alter table public.budgets        enable row level security;
alter table public.category_rules enable row level security;

-- `(select auth.uid())` instead of a bare call so the planner evaluates it once per
-- statement rather than once per row.
do $$
declare
  target text;
begin
  foreach target in array array['accounts', 'categories', 'transactions', 'budgets', 'category_rules']
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

-- ---------------------------------------------------------------------------
-- Default categories for a new user
-- ---------------------------------------------------------------------------

create or replace function public.seed_default_categories()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.categories (user_id, name, icon, color, kind, sort_order)
  values
    (new.id, 'Mercado',         'shopping-cart',  '#16a34a', 'expense',  10),
    (new.id, 'Restaurantes',    'utensils',       '#f97316', 'expense',  20),
    (new.id, 'Transporte',      'car',            '#0ea5e9', 'expense',  30),
    (new.id, 'Moradia',         'house',          '#8b5cf6', 'expense',  40),
    (new.id, 'Saúde',           'heart-pulse',    '#ef4444', 'expense',  50),
    (new.id, 'Educação',        'graduation-cap', '#2563eb', 'expense',  60),
    (new.id, 'Lazer',           'party-popper',   '#ec4899', 'expense',  70),
    (new.id, 'Compras',         'shopping-bag',   '#a855f7', 'expense',  80),
    (new.id, 'Assinaturas',     'repeat',         '#14b8a6', 'expense',  90),
    (new.id, 'Serviços',        'wrench',         '#64748b', 'expense', 100),
    (new.id, 'Viagem',          'plane',          '#06b6d4', 'expense', 110),
    (new.id, 'Impostos',        'landmark',       '#78716c', 'expense', 120),
    (new.id, 'Outros',          'circle-dashed',  '#94a3b8', 'expense', 130),
    (new.id, 'Salário',         'wallet',         '#22c55e', 'income',  200),
    (new.id, 'Reembolso',       'undo-2',         '#84cc16', 'income',  210),
    (new.id, 'Outras receitas', 'piggy-bank',     '#4ade80', 'income',  220)
  on conflict do nothing;

  return new;
end;
$$;

comment on function public.seed_default_categories() is
  'Gives a freshly created user the default category set. Categories are user data (they can be renamed, archived or deleted), so they are seeded per user instead of living in seed.sql — which cannot know the user id.';

create trigger seed_default_categories
  after insert on auth.users
  for each row
  execute function public.seed_default_categories();
