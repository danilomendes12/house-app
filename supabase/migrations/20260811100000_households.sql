-- Household sharing (SPEC §6.3): the data belongs to a household, not to a person.
--
-- Until here the system was single-user by design: every table carried `user_id` and RLS
-- read `user_id = auth.uid()`. The product goal changed — two people run the same home
-- finances — so ownership moves one level up:
--
--   * `household_id` is *who owns the row* and what RLS checks;
--   * `user_id` stays, and from now on means *who entered it* (attribution, not access).
--
-- Renaming `user_id` to `created_by` would have been the honest label, but the column is
-- written by every module in lib/db and read by the generated types; the comment carries
-- the meaning instead.
--
-- The unique keys move with ownership, and that is the part that actually matters: left on
-- `user_id`, two members would each get their own "Mercado" category, their own budget for
-- the same month, and their own copy of an imported statement row — the import idempotence
-- of SPEC §7 is only a guarantee within the scope of its unique index.

-- ---------------------------------------------------------------------------
-- households and membership
-- ---------------------------------------------------------------------------

create table public.households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now(),
  constraint households_name_not_blank check (length(btrim(name)) > 0)
);

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'member')),
  created_at   timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- One household per person in v1: the lookup below takes the first membership, and this
-- index is what makes it a single-row hit.
create index household_members_user_id_idx on public.household_members (user_id);

comment on table public.household_members is
  'Who belongs to which household. A person belongs to exactly one household in v1 — current_household_id() takes the first row.';

-- `security definer` on purpose: the policies below call this, and reading
-- household_members from inside a policy on household_members would recurse.
create or replace function public.current_household_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select member.household_id
  from public.household_members member
  where member.user_id = (select auth.uid())
  limit 1;
$$;

comment on function public.current_household_id() is
  'The household of the caller, or null when the session has no membership — in which case every policy below denies, which is the safe direction.';

-- An invite names the household explicitly; nothing guesses "the existing one".
alter table public.allowed_emails
  add column household_id uuid references public.households (id) on delete set null;

comment on column public.allowed_emails.household_id is
  'Household the e-mail joins on first sign-in. Null means "create a new one" — that is the owner''s row (pnpm db:owner); an invited member gets it filled in (pnpm db:invite).';

-- ---------------------------------------------------------------------------
-- household_id on every data table
-- ---------------------------------------------------------------------------

alter table public.accounts       add column household_id uuid references public.households (id) on delete cascade;
alter table public.categories     add column household_id uuid references public.households (id) on delete cascade;
alter table public.transactions   add column household_id uuid references public.households (id) on delete cascade;
alter table public.budgets        add column household_id uuid references public.households (id) on delete cascade;
alter table public.category_rules add column household_id uuid references public.households (id) on delete cascade;
alter table public.assets         add column household_id uuid references public.households (id) on delete cascade;
alter table public.asset_events   add column household_id uuid references public.households (id) on delete cascade;
alter table public.asset_snapshots add column household_id uuid references public.households (id) on delete cascade;

-- Backfill: one household per existing user, holding everything that user had.
do $$
declare
  existing_user record;
  new_household uuid;
  target text;
begin
  for existing_user in select id, email from auth.users loop
    insert into public.households (name) values ('Casa') returning id into new_household;

    insert into public.household_members (household_id, user_id, role)
    values (new_household, existing_user.id, 'owner');

    update public.allowed_emails
       set household_id = new_household
     where lower(email) = lower(existing_user.email)
       and household_id is null;

    foreach target in array array[
      'accounts', 'categories', 'transactions', 'budgets', 'category_rules',
      'assets', 'asset_events', 'asset_snapshots'
    ]
    loop
      execute format(
        'update public.%I set household_id = $1 where user_id = $2 and household_id is null',
        target
      ) using new_household, existing_user.id;
    end loop;
  end loop;
end;
$$;

alter table public.accounts        alter column household_id set not null;
alter table public.categories      alter column household_id set not null;
alter table public.transactions    alter column household_id set not null;
alter table public.budgets         alter column household_id set not null;
alter table public.category_rules  alter column household_id set not null;
alter table public.assets          alter column household_id set not null;
alter table public.asset_events    alter column household_id set not null;
alter table public.asset_snapshots alter column household_id set not null;

comment on column public.transactions.user_id is
  'Who entered the row, not who can see it — access is household_id (SPEC §6.3).';
comment on column public.assets.user_id is
  'Who entered the row, not who can see it — access is household_id (SPEC §6.3).';

-- ---------------------------------------------------------------------------
-- Unique keys and read indexes follow ownership
-- ---------------------------------------------------------------------------

-- "Mercado" is one category for the house, not one per person.
drop index if exists public.categories_user_name_key;
create unique index categories_household_name_key
  on public.categories (household_id, lower(name));

-- One budget per category per month for the household (SPEC §6.1).
alter table public.budgets drop constraint if exists budgets_category_month_key;
alter table public.budgets
  add constraint budgets_category_month_key unique (household_id, category_id, month);

-- The import dedup target (SPEC §7). Scoped to the household, so a statement one member
-- already imported inserts nothing when the other imports the same file.
drop index if exists public.transactions_external_id_key;
create unique index transactions_external_id_key
  on public.transactions (household_id, external_id);

comment on index public.transactions_external_id_key is
  'Dedup target for the CSV import. Not partial on purpose: ON CONFLICT inference needs a plain index, and NULL external_ids (manual entries) are distinct from each other anyway.';

drop index if exists public.accounts_user_id_idx;
drop index if exists public.categories_user_id_idx;
drop index if exists public.transactions_user_date_idx;
drop index if exists public.transactions_user_category_idx;
drop index if exists public.budgets_user_month_idx;
drop index if exists public.category_rules_user_priority_idx;
drop index if exists public.assets_user_id_idx;
drop index if exists public.asset_events_user_asset_idx;
drop index if exists public.asset_snapshots_user_date_idx;

create index accounts_household_id_idx        on public.accounts (household_id);
create index categories_household_id_idx      on public.categories (household_id);
create index transactions_household_date_idx  on public.transactions (household_id, date desc);
create index transactions_household_category_idx on public.transactions (household_id, category_id);
create index budgets_household_month_idx      on public.budgets (household_id, month);
create index category_rules_household_priority_idx on public.category_rules (household_id, priority desc);
create index assets_household_id_idx          on public.assets (household_id);
create index asset_events_household_asset_idx on public.asset_events (household_id, asset_id, date);
create index asset_snapshots_household_date_idx on public.asset_snapshots (household_id, date desc);

-- ---------------------------------------------------------------------------
-- RLS: membership replaces ownership
-- ---------------------------------------------------------------------------

alter table public.households        enable row level security;
alter table public.household_members enable row level security;

revoke all on table public.households, public.household_members from anon;
grant select on table public.households, public.household_members to authenticated;
grant select, insert, update, delete
  on table public.households, public.household_members to service_role;

-- Read-only for the app: membership is provisioned by the trigger and the admin scripts,
-- never by the UI.
create policy households_member_read on public.households
  for select to authenticated
  using (id = public.current_household_id());

create policy household_members_member_read on public.household_members
  for select to authenticated
  using (household_id = public.current_household_id());

do $$
declare
  target text;
begin
  foreach target in array array[
    'accounts', 'categories', 'transactions', 'budgets', 'category_rules',
    'assets', 'asset_events', 'asset_snapshots'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', target || '_owner_access', target);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (household_id = public.current_household_id())
         with check (household_id = public.current_household_id())',
      target || '_household_access',
      target
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Provisioning a new user: join a household, seed it once
-- ---------------------------------------------------------------------------

create or replace function public.provision_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_household uuid;
  member_role text := 'member';
begin
  select allowed.household_id into target_household
  from public.allowed_emails allowed
  where lower(allowed.email) = lower(new.email);

  -- No household on the invite: this is the first person, so the house is created here and
  -- written back, which is what the next invite will point at.
  if target_household is null then
    insert into public.households (name) values ('Casa') returning id into target_household;
    member_role := 'owner';

    update public.allowed_emails
       set household_id = target_household
     where lower(email) = lower(new.email);
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (target_household, new.id, member_role)
  on conflict do nothing;

  -- Seed only an empty household: the second member must not get a second copy of the
  -- category list, and a household that deleted a default category must not see it return.
  if not exists (select 1 from public.categories where household_id = target_household) then
    insert into public.categories (household_id, user_id, name, icon, color, kind, sort_order)
    values
      (target_household, new.id, 'Mercado',         'shopping-cart',  '#16a34a', 'expense',  10),
      (target_household, new.id, 'Restaurantes',    'utensils',       '#f97316', 'expense',  20),
      (target_household, new.id, 'Transporte',      'car',            '#0ea5e9', 'expense',  30),
      (target_household, new.id, 'Moradia',         'house',          '#8b5cf6', 'expense',  40),
      (target_household, new.id, 'Saúde',           'heart-pulse',    '#ef4444', 'expense',  50),
      (target_household, new.id, 'Educação',        'graduation-cap', '#2563eb', 'expense',  60),
      (target_household, new.id, 'Lazer',           'party-popper',   '#ec4899', 'expense',  70),
      (target_household, new.id, 'Compras',         'shopping-bag',   '#a855f7', 'expense',  80),
      (target_household, new.id, 'Assinaturas',     'repeat',         '#14b8a6', 'expense',  90),
      (target_household, new.id, 'Serviços',        'wrench',         '#64748b', 'expense', 100),
      (target_household, new.id, 'Viagem',          'plane',          '#06b6d4', 'expense', 110),
      (target_household, new.id, 'Impostos',        'landmark',       '#78716c', 'expense', 120),
      (target_household, new.id, 'Outros',          'circle-dashed',  '#94a3b8', 'expense', 130),
      (target_household, new.id, 'Salário',         'wallet',         '#22c55e', 'income',  200),
      (target_household, new.id, 'Reembolso',       'undo-2',         '#84cc16', 'income',  210),
      (target_household, new.id, 'Outras receitas', 'piggy-bank',     '#4ade80', 'income',  220)
    on conflict do nothing;
  end if;

  return new;
end;
$$;

comment on function public.provision_user() is
  'Puts a new auth user in a household (the one named on the allowlist, or a fresh one) and seeds the default categories the first time that household is used.';

drop trigger if exists seed_default_categories on auth.users;
drop function if exists public.seed_default_categories();

create trigger provision_user
  after insert on auth.users
  for each row
  execute function public.provision_user();
