-- Changes applied to the live database on 2026-09-26.
-- Keep this after 001-004: the original schema recreates current_org_id().

alter table public.leads drop constraint if exists leads_status_check;
alter table public.leads add constraint leads_status_check
  check (status in ('New', 'Contacted', 'Qualified', 'Meeting', 'Won', 'Lost', 'Not qualified'));

create or replace function public.current_org_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select p.org_id
  from public.profiles p
  join public.organizations o on o.id = p.org_id
  where p.user_id = auth.uid()
    and o.active is true;
$$;

-- These views were accessible to anon/authenticated with their default
-- definer permissions, which bypass the underlying tables' RLS.
revoke select on public.instagram_message_summary,
                 public.instagram_meta_feedback_summary,
                 public.meta_feedback_summary
  from public, anon, authenticated;
