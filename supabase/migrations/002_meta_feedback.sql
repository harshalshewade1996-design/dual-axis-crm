-- Dual Axis CRM — Phase 2 Meta Conversions API for CRM
-- Run after schema.sql in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.meta_connections (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  dataset_id text not null,
  source_name text not null default 'Dual Axis Media CRM',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meta_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  meta_lead_id text not null,
  crm_status text not null,
  event_name text not null,
  event_id text not null unique,
  event_time timestamptz not null default now(),
  value numeric,
  currency text,
  delivery_status text not null default 'queued' check (delivery_status in ('queued','sent','failed','skipped')),
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  response_json jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meta_events_org_idx on public.meta_events(org_id);
create index if not exists meta_events_lead_idx on public.meta_events(lead_id);
create index if not exists meta_events_status_idx on public.meta_events(delivery_status);
create index if not exists meta_events_created_idx on public.meta_events(created_at desc);

create or replace function public.touch_meta_connection_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists meta_connections_touch_updated_at on public.meta_connections;
create trigger meta_connections_touch_updated_at before update on public.meta_connections for each row execute function public.touch_meta_connection_updated_at();

create or replace function public.touch_meta_event_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists meta_events_touch_updated_at on public.meta_events;
create trigger meta_events_touch_updated_at before update on public.meta_events for each row execute function public.touch_meta_event_updated_at();

alter table public.meta_connections enable row level security;
alter table public.meta_events enable row level security;

drop policy if exists "meta connections read scoped" on public.meta_connections;
drop policy if exists "meta connections admin write" on public.meta_connections;
drop policy if exists "meta events read scoped" on public.meta_events;

drop policy if exists "meta events admin write" on public.meta_events;

create policy "meta connections read scoped" on public.meta_connections
for select using (public.is_admin() or org_id=public.current_org_id());

create policy "meta connections admin write" on public.meta_connections
for all using (public.is_admin()) with check (public.is_admin());

create policy "meta events read scoped" on public.meta_events
for select using (public.is_admin() or org_id=public.current_org_id());

create policy "meta events admin write" on public.meta_events
for all using (public.is_admin()) with check (public.is_admin());

-- Useful helper view for the admin dashboard.
create or replace view public.meta_feedback_summary as
select
  org_id,
  count(*) filter (where delivery_status='sent') as sent_events,
  count(*) filter (where delivery_status='queued') as queued_events,
  count(*) filter (where delivery_status='failed') as failed_events,
  max(last_attempt_at) as last_attempt_at
from public.meta_events
group by org_id;

-- Recommended setup per client:
-- insert into public.meta_connections (org_id, dataset_id, source_name)
-- values ('CLIENT_ORG_UUID', 'META_DATASET_ID', 'Oviegraphy CRM');
--
-- IMPORTANT:
-- Keep the Meta access token OUT of the browser and OUT of this table.
-- Store it as a Supabase Edge Function secret named META_ACCESS_TOKEN.
-- Store the Graph API version as META_API_VERSION (for example vXX.X),
-- and optionally set META_DEFAULT_DATASET_ID if you want a fallback.
