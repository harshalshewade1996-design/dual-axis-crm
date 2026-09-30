-- No budget backfill: unknown confirmed amounts remain NULL.
begin;
alter table public.leads add column if not exists booking_value numeric(12,2);
alter table public.leads add constraint leads_booking_value_nonnegative check (booking_value is null or (booking_value >= 0 and booking_value < 'Infinity'::numeric));
comment on column public.leads.booking_value is 'Confirmed total booking amount in INR, not a budget or deposit. NULL means unknown.';
create or replace function public.crm_lead_page(
 p_org uuid default null, p_search text default '', p_status text default 'all',
 p_page integer default 1, p_size integer default 25, p_followup boolean default false, p_due date default null
) returns jsonb language sql stable security invoker set search_path = '' as $$
with scoped as materialized (
 select l.*, o.name as client_name from public.leads l
 left join public.organizations o on o.id=l.org_id
 where p_org is null or l.org_id=p_org
), filtered as (
 select * from scoped l where
 (p_status='all' or l.status=p_status)
 and (coalesce(p_search,'')='' or strpos(lower(concat_ws(' ',l.name,l.phone,l.location,l.client_name,l.service)),lower(p_search))>0)
 and (p_due is null or l.followup_date=p_due)
 and (not p_followup or (l.followup_date is not null and l.status not in ('Won','Lost','Not qualified')))
), bounds as (
 select greatest(1,least(coalesce(p_size,25),100)) as size,
 count(*) as total from filtered
), paging as (
 select *, least(greatest(coalesce(p_page,1),1),greatest(1,ceil(total::numeric/size)::int)) as page from bounds
), page_rows as (
 select f.*, e.delivery_status as meta_sync_status, e.last_attempt_at as meta_synced_at
 from filtered f left join lateral (
 select delivery_status,last_attempt_at from public.meta_events where lead_id=f.id order by created_at desc,id desc limit 1
 ) e on true
 order by case when p_followup then f.followup_date end asc, f.created_at desc,f.id desc
 limit (select size from paging) offset (select (page-1)*size from paging)
), stages as (
 select status,count(*) as n from scoped group by status
), summary as (
 select count(*) as total,count(*) filter(where status in ('Qualified','Meeting','Won')) as qualified,
 count(*) filter(where status='Won') as won,coalesce(sum(booking_value) filter(where status='Won'),0) as revenue,
 count(*) filter(where nullif(meta_lead_id,'') is not null) as meta,
 count(*) filter(where source='Meta Ads' and nullif(meta_lead_id,'') is not null) as meta_forms,
 count(*) filter(where status='Won' and booking_value is not null) as booking_value_count,
 count(*) filter(where status='Won' and booking_value is null) as missing_booking_value,
 count(*) filter(where status='Won' and booking_value is not null) as value_tracked from scoped
), event_stats as (
 select count(*) filter(where delivery_status='sent') as sent,count(*) filter(where delivery_status<>'sent') as pending
 from public.meta_events where p_org is null or org_id=p_org
)
select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(r)) from page_rows r),'[]'::jsonb),
 'count',(select total from paging),'page',(select page from paging),'size',(select size from paging),
 'summary',(select to_jsonb(s)||jsonb_build_object('stages',coalesce((select jsonb_object_agg(status,n) from stages),'{}'::jsonb))||to_jsonb(e) from summary s cross join event_stats e));
$$;
revoke all on function public.crm_lead_page(uuid,text,text,integer,integer,boolean,date) from public,anon;
grant execute on function public.crm_lead_page(uuid,text,text,integer,integer,boolean,date) to authenticated;
create index if not exists leads_org_created_id_idx on public.leads(org_id,created_at desc,id desc);
create index if not exists leads_created_id_idx on public.leads(created_at desc,id desc);
commit;
