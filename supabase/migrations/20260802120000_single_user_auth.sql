-- Single-user hardening.
--
-- Signups are already disabled in Supabase Auth (see supabase/config.toml and the
-- dashboard). This migration is the defence-in-depth layer inside the database: even if
-- signups get re-enabled by accident, only allowlisted e-mails can become users.

create table if not exists public.allowed_emails (
  email      text primary key,
  note       text,
  created_at timestamptz not null default now()
);

comment on table public.allowed_emails is
  'E-mails allowed to exist in auth.users. Managed with the service role only (pnpm db:owner).';

alter table public.allowed_emails enable row level security;

-- Deliberately no RLS policies: anon and authenticated roles get nothing at all.
-- Only the service role, which bypasses RLS, reads or writes this table.
revoke all on table public.allowed_emails from anon, authenticated;
grant select, insert, update, delete on table public.allowed_emails to service_role;

create or replace function public.enforce_email_allowlist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null
     or not exists (
       select 1
       from public.allowed_emails allowed
       where lower(allowed.email) = lower(new.email)
     )
  then
    raise exception 'signup rejected: % is not on the allowlist', coalesce(new.email, '(null)')
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.enforce_email_allowlist() is
  'Rejects inserts into auth.users for e-mails outside public.allowed_emails.';

drop trigger if exists enforce_email_allowlist on auth.users;

create trigger enforce_email_allowlist
  before insert on auth.users
  for each row
  execute function public.enforce_email_allowlist();
