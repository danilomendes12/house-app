-- todos — the household's shared checklist.
--
-- Deliberately not a finance object: no amount, no month, no category. It is the list the
-- two people keep next to the money ("ligar para o contador", "renegociar o plano"), and
-- the moment it grows a value in cents it stops being a checklist and starts being a second
-- transactions table with worse rules.
--
-- Same ownership shape as every other data table (SPEC §6.3): `household_id` authorizes,
-- `user_id` only records who wrote it down.

create table public.todos (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  title        text not null,
  -- Null is pending. A timestamp rather than a boolean so "concluída hoje" is answerable
  -- without a second column, and so re-checking an item is a plain update.
  done_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint todos_title_not_blank check (length(btrim(title)) > 0)
);

comment on column public.todos.done_at is
  'When the item was checked off. Null means pending — that is the whole state machine.';
comment on column public.todos.user_id is
  'Who entered the row, not who can see it — access is household_id (SPEC §6.3).';

-- The page reads the whole list at once, pending first, newest first within each group.
create index todos_household_done_idx on public.todos (household_id, done_at, created_at desc);

create trigger touch_todos_updated_at
  before update on public.todos
  for each row execute function public.touch_updated_at();

alter table public.todos enable row level security;

revoke all on table public.todos from anon;
grant select, insert, update, delete on table public.todos to authenticated, service_role;

create policy todos_household_access on public.todos
  for all to authenticated
  using (household_id = public.current_household_id())
  with check (household_id = public.current_household_id());
