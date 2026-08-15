-- Gives the service roles a password, from POSTGRES_PASSWORD.
--
-- The supabase/postgres image creates every role we need (anon, authenticated,
-- service_role, authenticator, supabase_auth_admin) but leaves them **without a login
-- password** — the Supabase CLI injects a file at /etc/postgresql.schema.sql that sets
-- them, and that file is not part of the image. Without this script GoTrue dies at boot
-- with `password authentication failed for user "supabase_auth_admin"`.
--
-- Runs once, on an empty data volume, after the image's own migrate.sh (hence the `zz`
-- prefix: /docker-entrypoint-initdb.d is executed in alphabetical order). Changing
-- POSTGRES_PASSWORD in .env later does **not** re-run it — see deploy/README.md.

\set pgpass `echo "$POSTGRES_PASSWORD"`

-- `postgres` is the role migrations, backups and psql connect as; the other two are how
-- GoTrue and PostgREST authenticate.
alter user postgres            with password :'pgpass';
alter user supabase_auth_admin with password :'pgpass';
alter user authenticator       with password :'pgpass';
