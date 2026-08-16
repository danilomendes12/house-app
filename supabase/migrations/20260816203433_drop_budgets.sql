-- Drops the monthly budget feature.
--
-- Budgets were the P0 answer to "quanto ainda posso gastar?" (SPEC §6.1), and the product
-- decision is that they are not: keeping one number per category per month up to date is
-- work the house never did, and the dashboard reads fine without it — the bar next to each
-- category goes back to being the category's share of the month, which is the breakdown
-- that was already rendered whenever a category had no budget.
--
-- The table goes with the feature. Its policy, indexes and trigger are dropped by the
-- `drop table`; nothing else references it (`budgets.category_id` was the only FK, and it
-- pointed *at* categories, not the other way round).

drop table if exists public.budgets;
