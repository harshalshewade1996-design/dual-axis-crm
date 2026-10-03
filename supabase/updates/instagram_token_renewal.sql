begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
-- pg_net briefly holds the single-use run credential until delivery.
revoke all on net.http_request_queue from public,anon,authenticated;

alter table public.instagram_authorizations
  add column refresh_lock_id uuid,
  add column refresh_lock_until timestamptz,
  add column last_refresh_attempt_at timestamptz,
  add column last_refresh_result text check(last_refresh_result in ('renewed','retry','reconnect_required')),
  add column refresh_retry_at timestamptz;
create table public.instagram_refresh_runs (
  id uuid primary key default gen_random_uuid(),
  auth_hash text not null,
  expires_at timestamptz not null,
  force_refresh boolean not null default false,
  status text not null default 'pending' check(status in ('pending','running','completed','failed','expired')),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  renewed integer not null default 0,
  failed integer not null default 0,
  request_id bigint
);
alter table public.instagram_refresh_runs enable row level security;
revoke all on public.instagram_refresh_runs from public,anon,authenticated;
grant select,insert,update,delete on public.instagram_refresh_runs to service_role;

create function public.claim_instagram_refresh_run(p_run uuid,p_hash text)
returns table(force_refresh boolean) language sql security invoker set search_path='' as $$
  update public.instagram_refresh_runs set status='running'
  where id=p_run and auth_hash=p_hash and status='pending' and expires_at>now()
  returning force_refresh;
$$;
revoke all on function public.claim_instagram_refresh_run(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_instagram_refresh_run(uuid,text) to service_role;

create function public.claim_instagram_refresh_accounts(p_run uuid)
returns setof public.instagram_authorizations language plpgsql security invoker set search_path='' as $$
declare forced boolean;
begin
  select force_refresh into forced from public.instagram_refresh_runs where id=p_run and status='running' and expires_at>now();
  if not found then raise exception 'Invalid renewal run'; end if;
  update public.instagram_authorizations a set last_refresh_result='reconnect_required'
    where a.expires_at<=now() and a.last_refresh_result is distinct from 'reconnect_required';
  return query
  with candidates as (
    select a.org_id from public.instagram_authorizations a
    join public.organizations o on o.id=a.org_id and o.active=true
    join public.meta_instagram_connections c on c.org_id=a.org_id and c.enabled=true and c.instagram_account_id=a.instagram_account_id
    where a.expires_at>now() and a.refreshed_at<=now()-interval '24 hours'
      and (forced or a.expires_at<=now()+interval '14 days' or a.refreshed_at<=now()-interval '30 days')
      and (a.refresh_lock_until is null or a.refresh_lock_until<=now())
      and (a.refresh_retry_at is null or a.refresh_retry_at<=now())
      and a.last_refresh_result is distinct from 'reconnect_required'
    order by a.expires_at limit 5 for update of a skip locked
  )
  update public.instagram_authorizations a set refresh_lock_id=p_run,refresh_lock_until=now()+interval '10 minutes',last_refresh_attempt_at=now()
  from candidates x where a.org_id=x.org_id returning a.*;
end $$;
revoke all on function public.claim_instagram_refresh_accounts(uuid) from public,anon,authenticated;
grant execute on function public.claim_instagram_refresh_accounts(uuid) to service_role;

create function public.finish_instagram_refresh(p_run uuid,p_org uuid,p_account text,p_previous text,p_result text,p_ciphertext text default null,p_expiry timestamptz default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
  if p_result is null or p_result not in ('renewed','retry','reconnect_required') then raise exception 'Invalid result'; end if;
  if p_result='renewed' and (p_ciphertext is null or p_expiry is null or p_expiry<=now() or p_expiry>now()+interval '90 days') then raise exception 'Invalid renewal'; end if;
  update public.instagram_authorizations a set
    token_ciphertext=case when p_result='renewed' then p_ciphertext else a.token_ciphertext end,
    expires_at=case when p_result='renewed' then p_expiry else a.expires_at end,
    refreshed_at=case when p_result='renewed' then now() else a.refreshed_at end,
    last_refresh_result=p_result,refresh_lock_id=null,refresh_lock_until=null,
    refresh_retry_at=case when p_result='retry' then now()+interval '24 hours' else null end
  where a.org_id=p_org and a.instagram_account_id=p_account and a.token_ciphertext=p_previous and a.refresh_lock_id=p_run and a.refresh_lock_until>now()
    and exists(select 1 from public.organizations o where o.id=a.org_id and o.active=true)
    and exists(select 1 from public.meta_instagram_connections c where c.org_id=a.org_id and c.enabled=true and c.instagram_account_id=a.instagram_account_id);
  get diagnostics changed=row_count;
  return changed=1;
end $$;
revoke all on function public.finish_instagram_refresh(uuid,uuid,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.finish_instagram_refresh(uuid,uuid,text,text,text,text,timestamptz) to service_role;

-- Only the database owner can enqueue runs. No permanent scheduler secret.
create function public.enqueue_instagram_refresh(p_force boolean default false)
returns bigint language plpgsql security invoker set search_path='' as $$
declare ticket text; run_id uuid; request bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('instagram-token-renewal'));
  delete from public.instagram_refresh_runs where created_at<now()-interval '30 days';
  update public.instagram_refresh_runs set status='expired' where status in ('pending','running') and expires_at<=now();
  if exists(select 1 from public.instagram_refresh_runs where status in ('pending','running') and expires_at>now()) then return null; end if;
  ticket=encode(extensions.gen_random_bytes(32),'hex');
  insert into public.instagram_refresh_runs(auth_hash,expires_at,force_refresh)
    values(encode(extensions.digest(ticket,'sha256'),'hex'),now()+interval '10 minutes',p_force) returning id into run_id;
  request=net.http_post(url:='https://oydzhtwpeoyfeuesyntd.supabase.co/functions/v1/instagram-token-renewal',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||ticket),
    body:=jsonb_build_object('run_id',run_id),timeout_milliseconds:=150000);
  update public.instagram_refresh_runs set request_id=request where id=run_id;
  return request;
end $$;
revoke all on function public.enqueue_instagram_refresh(boolean) from public,anon,authenticated,service_role;
create or replace function public.activate_instagram_authorization(p_session uuid, p_actor uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare s public.instagram_oauth_sessions%rowtype;
begin
  select * into s from public.instagram_oauth_sessions where id=p_session for update;
  if not found or s.status<>'activating' or s.expires_at<=now() or s.token_expires_at is null or s.token_expires_at<=now() or s.token_ciphertext is null or s.instagram_account_id is null then
    raise exception 'Authorization is not ready';
  end if;
  if not exists(select 1 from public.profiles where user_id=p_actor and role='admin') then raise exception 'Admin required'; end if;
  perform 1 from public.organizations where id=s.org_id and active=true for update;
  if not found then raise exception 'Client account inactive'; end if;
  insert into public.meta_instagram_connections(org_id,instagram_account_id,instagram_username,enabled)
    values(s.org_id,s.instagram_account_id,s.instagram_username,true)
    on conflict(org_id) do update set instagram_account_id=excluded.instagram_account_id,instagram_username=excluded.instagram_username,enabled=true;
  insert into public.instagram_authorizations(org_id,instagram_account_id,token_ciphertext,expires_at,refreshed_at)
    values(s.org_id,s.instagram_account_id,s.token_ciphertext,s.token_expires_at,now())
    on conflict(org_id) do update set instagram_account_id=excluded.instagram_account_id,token_ciphertext=excluded.token_ciphertext,expires_at=excluded.expires_at,refreshed_at=now(),last_refresh_result=null,refresh_retry_at=null,refresh_lock_id=null,refresh_lock_until=null;
  update public.instagram_oauth_sessions set status='connected',token_ciphertext=null where id=s.id;
end $$;

commit;
