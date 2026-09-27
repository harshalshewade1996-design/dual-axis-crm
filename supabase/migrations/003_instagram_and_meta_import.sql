-- Dual Axis CRM — Phase 3
-- Primary: Instagram Messaging / Click-to-Instagram (CTD)
-- Optional: Meta Instant Forms remain supported by the existing leadgen tables.
-- Run after schema.sql and phase2.sql in Supabase SQL Editor.

create extension if not exists pgcrypto;

-- -----------------------------
-- Lead fields for Instagram DM
-- -----------------------------
alter table public.leads add column if not exists email text;
alter table public.leads add column if not exists meta_page_id text;
alter table public.leads add column if not exists meta_form_id text;
alter table public.leads add column if not exists meta_ad_id text;
alter table public.leads add column if not exists meta_adset_id text;
alter table public.leads add column if not exists meta_campaign_id text;
alter table public.leads add column if not exists meta_created_time timestamptz;
alter table public.leads add column if not exists meta_field_data jsonb not null default '{}'::jsonb;
alter table public.leads add column if not exists meta_ig_user_id text;
alter table public.leads add column if not exists meta_instagram_account_id text;
alter table public.leads add column if not exists meta_conversation_id text;
alter table public.leads add column if not exists meta_message_id text;
alter table public.leads add column if not exists instagram_username text;
alter table public.leads add column if not exists meta_ad_title text;
alter table public.leads add column if not exists last_inbound_message text;
alter table public.leads add column if not exists last_inbound_at timestamptz;
alter table public.leads add column if not exists meta_messaging_referral jsonb not null default '{}'::jsonb;

create unique index if not exists leads_meta_lead_id_unique_idx
  on public.leads(meta_lead_id)
  where meta_lead_id is not null;

create unique index if not exists leads_org_meta_ig_user_unique_idx
  on public.leads(org_id, meta_ig_user_id)
  where meta_ig_user_id is not null;

create index if not exists leads_meta_ig_user_idx on public.leads(meta_ig_user_id);
create index if not exists leads_meta_instagram_account_idx on public.leads(meta_instagram_account_id);
create index if not exists leads_meta_conversation_idx on public.leads(meta_conversation_id);
create index if not exists leads_meta_message_idx on public.leads(meta_message_id);
create index if not exists leads_last_inbound_at_idx on public.leads(last_inbound_at desc);

-- -----------------------------
-- Instant Form mappings (optional)
-- -----------------------------
create table if not exists public.meta_lead_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  page_id text not null,
  form_id text,
  page_name text,
  form_name text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meta_lead_sources_org_idx on public.meta_lead_sources(org_id);
create index if not exists meta_lead_sources_page_idx on public.meta_lead_sources(page_id);
drop index if exists meta_lead_sources_page_form_unique_idx;
drop index if exists meta_lead_sources_page_only_unique_idx;
create unique index meta_lead_sources_page_form_unique_idx
  on public.meta_lead_sources(page_id, form_id) where form_id is not null;
create unique index meta_lead_sources_page_only_unique_idx
  on public.meta_lead_sources(page_id) where form_id is null;

create table if not exists public.meta_lead_imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  leadgen_id text not null unique,
  page_id text,
  form_id text,
  ad_id text,
  adset_id text,
  campaign_id text,
  meta_created_time timestamptz,
  import_status text not null default 'queued' check (import_status in ('queued','imported','unmapped','failed')),
  raw_json jsonb,
  error_message text,
  received_at timestamptz not null default now(),
  imported_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists meta_lead_imports_org_idx on public.meta_lead_imports(org_id);
create index if not exists meta_lead_imports_status_idx on public.meta_lead_imports(import_status);
create index if not exists meta_lead_imports_received_idx on public.meta_lead_imports(received_at desc);

-- -----------------------------
-- Instagram account -> client mapping
-- -----------------------------
create table if not exists public.meta_instagram_connections (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  instagram_account_id text not null unique,
  instagram_username text,
  page_id text,
  page_name text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meta_instagram_connections_page_idx on public.meta_instagram_connections(page_id);

-- -----------------------------
-- Inbound Instagram message event log
-- -----------------------------
create table if not exists public.instagram_message_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  event_key text not null unique,
  message_id text,
  instagram_account_id text,
  sender_id text,
  conversation_id text,
  message_text text,
  message_timestamp timestamptz,
  source text not null default 'instagram',
  referral_source text,
  referral_type text,
  meta_ad_id text,
  meta_ad_title text,
  meta_post_id text,
  meta_ref text,
  referral_json jsonb not null default '{}'::jsonb,
  raw_json jsonb,
  event_status text not null default 'received' check (event_status in ('received','imported','unmapped','failed','ignored')),
  error_message text,
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists instagram_message_events_org_idx on public.instagram_message_events(org_id);
create index if not exists instagram_message_events_sender_idx on public.instagram_message_events(sender_id);
create index if not exists instagram_message_events_conversation_idx on public.instagram_message_events(conversation_id);
create index if not exists instagram_message_events_received_idx on public.instagram_message_events(received_at desc);
create index if not exists instagram_message_events_ad_idx on public.instagram_message_events(meta_ad_id);

create or replace function public.touch_meta_phase3_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists meta_lead_sources_touch_updated_at on public.meta_lead_sources;
create trigger meta_lead_sources_touch_updated_at before update on public.meta_lead_sources
for each row execute function public.touch_meta_phase3_updated_at();

drop trigger if exists meta_instagram_connections_touch_updated_at on public.meta_instagram_connections;
create trigger meta_instagram_connections_touch_updated_at before update on public.meta_instagram_connections
for each row execute function public.touch_meta_phase3_updated_at();

drop trigger if exists instagram_message_events_touch_updated_at on public.instagram_message_events;
create trigger instagram_message_events_touch_updated_at before update on public.instagram_message_events
for each row execute function public.touch_meta_phase3_updated_at();

drop trigger if exists meta_lead_imports_touch_updated_at on public.meta_lead_imports;
create trigger meta_lead_imports_touch_updated_at before update on public.meta_lead_imports
for each row execute function public.touch_meta_phase3_updated_at();

alter table public.meta_lead_sources enable row level security;
alter table public.meta_lead_imports enable row level security;
alter table public.meta_instagram_connections enable row level security;
alter table public.instagram_message_events enable row level security;

drop policy if exists "meta lead sources read scoped" on public.meta_lead_sources;
drop policy if exists "meta lead sources admin write" on public.meta_lead_sources;
drop policy if exists "meta lead imports read scoped" on public.meta_lead_imports;
drop policy if exists "instagram connections read scoped" on public.meta_instagram_connections;
drop policy if exists "instagram connections admin write" on public.meta_instagram_connections;
drop policy if exists "instagram events read scoped" on public.instagram_message_events;

create policy "meta lead sources read scoped" on public.meta_lead_sources
for select using (public.is_admin() or org_id=public.current_org_id());
create policy "meta lead sources admin write" on public.meta_lead_sources
for all using (public.is_admin()) with check (public.is_admin());
create policy "meta lead imports read scoped" on public.meta_lead_imports
for select using (public.is_admin() or org_id=public.current_org_id());

create policy "instagram connections read scoped" on public.meta_instagram_connections
for select using (public.is_admin() or org_id=public.current_org_id());
create policy "instagram connections admin write" on public.meta_instagram_connections
for all using (public.is_admin()) with check (public.is_admin());

create policy "instagram events read scoped" on public.instagram_message_events
for select using (public.is_admin() or org_id=public.current_org_id());

create or replace view public.instagram_message_summary as
select
  org_id,
  count(*) as total_events,
  count(*) filter (where event_status='imported') as imported_events,
  count(*) filter (where event_status='unmapped') as unmapped_events,
  count(*) filter (where event_status='failed') as failed_events,
  count(distinct sender_id) filter (where sender_id is not null) as unique_contacts,
  count(*) filter (where meta_ad_id is not null) as ad_attributed_events,
  max(received_at) as last_received_at
from public.instagram_message_events
group by org_id;

-- Required Edge Function secrets (never in browser):
-- META_ACCESS_TOKEN
-- META_API_VERSION (set to the current Graph API version approved for the app)
-- META_WEBHOOK_VERIFY_TOKEN
-- META_APP_SECRET

-- -----------------------------
-- Instagram messaging conversion events sent back to Meta
-- -----------------------------
create table if not exists public.instagram_meta_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  ig_sid text not null,
  ig_account_id text not null,
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

create index if not exists instagram_meta_events_org_idx on public.instagram_meta_events(org_id);
create index if not exists instagram_meta_events_lead_idx on public.instagram_meta_events(lead_id);
create index if not exists instagram_meta_events_status_idx on public.instagram_meta_events(delivery_status);
create index if not exists instagram_meta_events_created_idx on public.instagram_meta_events(created_at desc);

drop trigger if exists instagram_meta_events_touch_updated_at on public.instagram_meta_events;
create trigger instagram_meta_events_touch_updated_at before update on public.instagram_meta_events
for each row execute function public.touch_meta_phase3_updated_at();

alter table public.instagram_meta_events enable row level security;
drop policy if exists "instagram meta events read scoped" on public.instagram_meta_events;
create policy "instagram meta events read scoped" on public.instagram_meta_events
for select using (public.is_admin() or org_id=public.current_org_id());

create or replace view public.instagram_meta_feedback_summary as
select
  org_id,
  count(*) filter (where delivery_status='sent') as sent_events,
  count(*) filter (where delivery_status='queued') as queued_events,
  count(*) filter (where delivery_status='failed') as failed_events,
  max(last_attempt_at) as last_attempt_at
from public.instagram_meta_events
group by org_id;
