-- Dual Axis CRM — Supabase schema
-- Run in Supabase SQL Editor.
-- Create Auth users in Supabase Authentication first.

create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid references public.organizations(id) on delete set null,
  role text not null default 'client' check (role in ('admin','client')),
  full_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  phone text not null,
  service text,
  wedding_date date,
  location text,
  budget numeric not null default 0,
  status text not null default 'New' check (status in ('New','Contacted','Qualified','Meeting','Won','Lost')),
  quality text not null default 'Unknown' check (quality in ('Unknown','Good','Bad')),
  followup_date date,
  source text not null default 'Meta Ads',
  meta_lead_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leads_org_id_idx on public.leads(org_id);
create index if not exists leads_meta_lead_id_idx on public.leads(meta_lead_id);
create index if not exists leads_status_idx on public.leads(status);
create index if not exists leads_followup_date_idx on public.leads(followup_date);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists leads_touch_updated_at on public.leads;
create trigger leads_touch_updated_at before update on public.leads for each row execute function public.touch_updated_at();

create or replace function public.current_org_id() returns uuid language sql stable security definer set search_path=public as $$
  select org_id from public.profiles where user_id = auth.uid();
$$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles where user_id=auth.uid() and role='admin');
$$;

grant execute on function public.current_org_id() to authenticated;
grant execute on function public.is_admin() to authenticated;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.leads enable row level security;

drop policy if exists "profiles own row" on public.profiles;
drop policy if exists "profiles admin read org" on public.profiles;
drop policy if exists "organizations own org" on public.organizations;
drop policy if exists "leads org access" on public.leads;
drop policy if exists "leads org insert" on public.leads;
drop policy if exists "leads org update" on public.leads;
drop policy if exists "leads org delete" on public.leads;

create policy "profiles self or admin" on public.profiles for select using (user_id=auth.uid() or public.is_admin());
create policy "organizations self or admin" on public.organizations for select using (public.is_admin() or id=public.current_org_id());

create policy "leads read scoped" on public.leads for select using (public.is_admin() or org_id=public.current_org_id());
create policy "leads insert scoped" on public.leads for insert with check (public.is_admin() or org_id=public.current_org_id());
create policy "leads update scoped" on public.leads for update using (public.is_admin() or org_id=public.current_org_id()) with check (public.is_admin() or org_id=public.current_org_id());
create policy "leads delete scoped" on public.leads for delete using (public.is_admin() or org_id=public.current_org_id());

-- BOOTSTRAP
-- 1) Create your Auth users in Authentication.
-- 2) Create organizations:
-- insert into public.organizations (name) values ('Oviegraphy') returning id;
-- insert into public.organizations (name) values ('Atulya Katha') returning id;
-- 3) Add your admin profile. Set org_id to NULL for the admin so the admin sees all clients:
-- insert into public.profiles (user_id, org_id, role, full_name)
-- values ('ADMIN_AUTH_USER_UUID', null, 'admin', 'Dual Axis Admin');
-- 4) Add each client profile with the client's organization UUID:
-- insert into public.profiles (user_id, org_id, role, full_name)
-- values ('CLIENT_AUTH_USER_UUID', 'CLIENT_ORG_UUID', 'client', 'Client Name');
