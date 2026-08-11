-- Makes the import dedup key usable as an ON CONFLICT target (SPEC §7).
--
-- The index was partial (`where external_id is not null`), which Postgres cannot infer
-- from `on conflict (user_id, external_id)`:
--
--   ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification
--
-- and inference is exactly what the idempotent import needs — PostgREST emits the column
-- list, it has no way to spell the index predicate.
--
-- Dropping the predicate costs nothing: Postgres treats NULLs as distinct in a unique
-- index (no NULLS NOT DISTINCT here), so manually entered transactions — all of which have
-- external_id = null — still coexist freely. The guarantee that matters is unchanged:
-- one row per (user_id, external_id) for imported rows, so re-importing a file inserts 0.

drop index if exists public.transactions_external_id_key;

create unique index transactions_external_id_key
  on public.transactions (user_id, external_id);

comment on index public.transactions_external_id_key is
  'Dedup target for the CSV import. Not partial on purpose: ON CONFLICT inference needs a plain index, and NULL external_ids (manual entries) are distinct from each other anyway.';
