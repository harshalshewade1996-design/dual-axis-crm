-- Read-only production audit. Run in the Supabase SQL Editor; do not apply as a migration.
-- Review all result grids, not just the last one.

-- RLS must be enabled for every CRM table, and each table should have policies.
select c.relname as table_name, c.relrowsecurity as rls_enabled,
       count(p.policyname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = n.nspname and p.tablename = c.relname
where n.nspname = 'public' and c.relkind in ('r', 'p')
  and c.relname in (
    'organizations', 'profiles', 'leads', 'meta_connections', 'meta_events',
    'meta_lead_sources', 'meta_lead_imports', 'meta_instagram_connections',
    'instagram_message_events', 'instagram_meta_events'
  )
group by c.relname, c.relrowsecurity
order by c.relname;

-- Check exact USING / WITH CHECK expressions for organization scope.
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'organizations', 'profiles', 'leads', 'meta_connections', 'meta_events',
    'meta_lead_sources', 'meta_lead_imports', 'meta_instagram_connections',
    'instagram_message_events', 'instagram_meta_events'
  )
order by tablename, policyname;

-- These default definer views must not be selectable by public roles.
select c.relname as view_name,
       has_table_privilege('anon', c.oid, 'SELECT') as anon_can_select,
       has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_can_select,
       coalesce((select option_value from pg_options_to_table(c.reloptions)
                 where option_name = 'security_invoker'), 'false') as security_invoker
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in (
  'instagram_message_summary', 'instagram_meta_feedback_summary',
  'meta_feedback_summary'
)
order by c.relname;

-- Must join organizations and require active = true for client-scoped access.
select pg_get_functiondef('public.current_org_id()'::regprocedure) as current_org_id_definition;
