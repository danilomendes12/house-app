-- Drops the Open Finance integration columns.
--
-- Automatic bank sync left the v1 scope (SPEC §3, decided 2026-08-02): the app is fed by
-- manual entry plus CSV import. These columns never held a row, and keeping vendor names
-- in the schema for a feature nobody is building is how a model rots.
--
-- Nothing here blocks bringing an aggregator back: `transactions.external_id` is already
-- the generic dedup key, and `source` is a text check constraint, so a second origin is
-- one migration away (SPEC §8, P2).

drop index if exists public.accounts_pluggy_account_id_key;

alter table public.accounts
  drop column if exists pluggy_item_id,
  drop column if exists pluggy_account_id;

-- 'pluggy' was never written; narrow the domain to what the app actually produces.
alter table public.transactions
  drop constraint if exists transactions_source_check;

alter table public.transactions
  add constraint transactions_source_check check (source in ('manual', 'csv'));

comment on column public.transactions.external_id is
  'Stable dedup key for imported rows (SPEC §7). Unique per user — re-importing a file inserts nothing.';
