-- AdPulse OOH Tracking System (AdPulse OTS) — Supabase schema
-- Run this once in Supabase → SQL Editor. Then run seed.sql to import your current data.
--
-- Model: the app stores JSON documents by path ("sites/s01", "campaigns/c1", "settings/brand",
-- "portal/u_<user-uuid>", "requests/u_<user-uuid>"), exactly like it did on claude.ai.
-- Who can do what is enforced here with Row Level Security, not in the browser.

create extension if not exists pgcrypto;

-- ---------- members & roles ----------
create table if not exists public.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'client' check (role in ('admin','client')),
  name text,
  email text,
  created_at timestamptz not null default now()
);
alter table public.members enable row level security;

-- Every new sign-up gets a members row. The very first account becomes admin; everyone after is a client
-- until an admin promotes them (Table editor → members → role = 'admin').
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.members (user_id, role, name, email)
  values (new.id,
          case when not exists (select 1 from public.members where role = 'admin') then 'admin' else 'client' end,
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
          new.email)
  on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = auth.uid() and role = 'admin');
$$;

drop policy if exists "members: read own or admin" on public.members;
create policy "members: read own or admin" on public.members for select
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists "members: admin manages" on public.members;
create policy "members: admin manages" on public.members for update using (public.is_admin()) with check (public.is_admin());

-- ---------- documents ----------
create table if not exists public.docs (
  path text primary key,
  collection text not null,
  doc_id text not null,
  data jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index if not exists docs_collection_idx on public.docs (collection);
alter table public.docs enable row level security;
alter table public.docs replica identity full;   -- so realtime delete events carry the path

create or replace function public.docs_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'UPDATE' then new.version := old.version + 1; end if;
  return new;
end $$;
drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before insert or update on public.docs for each row execute function public.docs_touch();

-- The signed-in person's own portal / request document path
create or replace function public.my_path(prefix text) returns text language sql stable as $$
  select prefix || '/u_' || auth.uid()::text;
$$;

drop policy if exists "docs: read" on public.docs;
create policy "docs: read" on public.docs for select using (
  public.is_admin()
  or path = public.my_path('portal')      -- a client reads only their own dashboard snapshot
  or path = public.my_path('requests')    -- and their own access request
);
drop policy if exists "docs: insert" on public.docs;
create policy "docs: insert" on public.docs for insert with check (
  public.is_admin() or path = public.my_path('requests')
);
drop policy if exists "docs: update" on public.docs;
create policy "docs: update" on public.docs for update
  using (public.is_admin() or path = public.my_path('requests'))
  with check (public.is_admin() or path = public.my_path('requests'));
drop policy if exists "docs: delete" on public.docs;
create policy "docs: delete" on public.docs for delete using (
  public.is_admin() or path = public.my_path('requests')
);

-- Live updates (the app subscribes to changes)
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- ---------- people lookup (names/emails on the Clients page) ----------
create or replace function public.profiles(ids uuid[]) returns table (id uuid, name text, email text)
language sql stable security definer set search_path = public as $$
  select m.user_id, m.name, m.email from public.members m
  where m.user_id = any(ids) and (public.is_admin() or m.user_id = auth.uid());
$$;

-- ---------- photo & video storage ----------
-- Public bucket: files are served by unguessable random ids through /_blob/<id> (see vercel.json).
-- Only admins (your team) can upload or delete.
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', true, 26214400)
on conflict (id) do update set public = true, file_size_limit = 26214400;

drop policy if exists "media: team uploads" on storage.objects;
create policy "media: team uploads" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.is_admin());
drop policy if exists "media: team deletes" on storage.objects;
create policy "media: team deletes" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and public.is_admin());
drop policy if exists "media: team lists" on storage.objects;
create policy "media: team lists" on storage.objects for select to authenticated
  using (bucket_id = 'media' and public.is_admin());
