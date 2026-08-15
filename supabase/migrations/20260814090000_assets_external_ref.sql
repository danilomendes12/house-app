-- Stable identity for an imported asset (SPEC §7.1).
--
-- This is to the position import what `transactions.external_id` is to the statement
-- import: the key that makes re-importing a no-op instead of a duplicate. Without it,
-- matching would have to be done on the product name, and the first time XP rewrote
-- "CDB BANCO X" as "CDB Banco X" the household would own the same bond twice.
--
-- Scoped to the household, like every other unique key after the Fase 6 migration, and
-- nullable: assets created by hand in /assets have no counterpart in any file.

alter table public.assets
  add column external_ref text;

comment on column public.assets.external_ref is
  'Identity of the product in the broker export (`positionKey` in packages/shared/xp-position.ts). Null for assets created by hand. Changing how it is derived silently breaks matching — the next import creates twins instead of updating.';

-- Not partial: ON CONFLICT inference needs a plain index (same reasoning as
-- transactions_external_id_key), and NULLs are distinct from each other anyway, so
-- hand-created assets never collide.
create unique index assets_external_ref_key
  on public.assets (household_id, external_ref);
