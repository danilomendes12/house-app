-- shopping_items — the household's two shopping lists.
--
-- Sibling of `todos`, not a copy of it: same "title + done_at" shape, same reasoning about
-- staying out of the finance model (no amount, no category — the moment an item carries a
-- value in cents it becomes a worse transactions table). What it adds is `list`, because the
-- house buys detergent and the supermarket sells rice and mixing the two makes both useless
-- at the moment you need them: one is read at a store, the other over a month.
--
-- One table with a discriminator rather than two tables: the columns, the indexes, the RLS
-- policy and every query would be identical twice over, and "a third list" would then cost a
-- migration plus a module instead of one CHECK value.
--
-- Same ownership shape as every other data table (SPEC §6.3): `household_id` authorizes,
-- `user_id` only records who wrote it down.

create table public.shopping_items (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  -- 'home'   — casa em geral (lâmpada, pilha, cabo HDMI)
  -- 'market' — supermercado (arroz, detergente, café)
  list         text not null,
  title        text not null,
  -- Null is pending, exactly as in `todos`: a timestamp rather than a boolean so "comprado
  -- hoje" is answerable without a second column, and unchecking is a plain update.
  done_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint shopping_items_list_valid check (list in ('home', 'market')),
  constraint shopping_items_title_not_blank check (length(btrim(title)) > 0)
);

comment on column public.shopping_items.list is
  'Which of the two lists the item belongs to: home (casa) or market (supermercado).';
comment on column public.shopping_items.done_at is
  'When the item was bought. Null means pending — that is the whole state machine.';
comment on column public.shopping_items.user_id is
  'Who entered the row, not who can see it — access is household_id (SPEC §6.3).';

-- One list is read at a time, pending first, newest first within each group. `list` sits
-- right after `household_id` because it is an equality filter on every single query.
create index shopping_items_household_list_idx
  on public.shopping_items (household_id, list, done_at, created_at desc);

create trigger touch_shopping_items_updated_at
  before update on public.shopping_items
  for each row execute function public.touch_updated_at();

alter table public.shopping_items enable row level security;

revoke all on table public.shopping_items from anon;
grant select, insert, update, delete on table public.shopping_items to authenticated, service_role;

create policy shopping_items_household_access on public.shopping_items
  for all to authenticated
  using (household_id = public.current_household_id())
  with check (household_id = public.current_household_id());
