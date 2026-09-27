-- Dual Axis CRM — Phase 4 client management
-- Run this once in Supabase SQL Editor before using the new Clients page.

alter table public.organizations add column if not exists active boolean not null default true;
alter table public.organizations add column if not exists contact_name text;
alter table public.organizations add column if not exists contact_email text;
alter table public.organizations add column if not exists instagram_username text;

create index if not exists organizations_active_idx on public.organizations(active);
create index if not exists organizations_contact_email_idx on public.organizations(contact_email);

-- Keep admin visibility and client self-visibility, while preserving inactive rows for history.
drop policy if exists "organizations self or admin" on public.organizations;
create policy "organizations self or admin" on public.organizations
for select using (public.is_admin() or id=public.current_org_id());
