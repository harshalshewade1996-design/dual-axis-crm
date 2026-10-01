begin;
-- Encrypted credentials only. These tables are intentionally inaccessible to CRM clients.
create table public.instagram_authorizations (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  instagram_account_id text not null unique,
  token_ciphertext text not null,
  expires_at timestamptz not null,
  refreshed_at timestamptz not null default now()
);
create table public.instagram_oauth_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  initiated_by uuid not null references auth.users(id) on delete cascade,
  state_hash text not null unique,
  status text not null default 'awaiting' check(status in ('awaiting','exchanging','authorized','activating','connected','failed','cancelled')),
  expires_at timestamptz not null,
  instagram_account_id text,
  instagram_username text,
  token_ciphertext text,
  token_expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index instagram_oauth_sessions_org_created on public.instagram_oauth_sessions(org_id,created_at desc);
alter table public.instagram_authorizations enable row level security;
alter table public.instagram_oauth_sessions enable row level security;
revoke all on public.instagram_authorizations, public.instagram_oauth_sessions from public, anon, authenticated;
grant select,insert,update,delete on public.instagram_authorizations,public.instagram_oauth_sessions to service_role;

create function public.start_instagram_authorization(p_org uuid,p_actor uuid,p_state_hash text,p_expires timestamptz)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not exists(select 1 from public.profiles where user_id=p_actor and role='admin') then raise exception 'Admin required'; end if;
  perform 1 from public.organizations where id=p_org and active=true for update;
  if not found then raise exception 'Client account inactive'; end if;
  if p_expires<=now() or p_expires>now()+interval '31 minutes' then raise exception 'Invalid link expiry'; end if;
  if p_state_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid state hash'; end if;
  if exists(select 1 from public.instagram_oauth_sessions where org_id=p_org and status='activating' and expires_at>now()) then raise exception 'Activation in progress'; end if;
  update public.instagram_oauth_sessions set status='cancelled',token_ciphertext=null where org_id=p_org and status in ('awaiting','exchanging','authorized','failed');
  -- Clear abandoned encrypted review tokens on each new link; no expired review token is usable.
  update public.instagram_oauth_sessions set token_ciphertext=null where expires_at<=now() and token_ciphertext is not null;
  insert into public.instagram_oauth_sessions(org_id,initiated_by,state_hash,expires_at) values(p_org,p_actor,p_state_hash,p_expires);
end $$;
revoke all on function public.start_instagram_authorization(uuid,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.start_instagram_authorization(uuid,uuid,text,timestamptz) to service_role;

-- All-or-nothing activation, including a unique account-to-client binding.
create function public.activate_instagram_authorization(p_session uuid, p_actor uuid)
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
    on conflict(org_id) do update set instagram_account_id=excluded.instagram_account_id,token_ciphertext=excluded.token_ciphertext,expires_at=excluded.expires_at,refreshed_at=now();
  update public.instagram_oauth_sessions set status='connected',token_ciphertext=null where id=s.id;
end $$;
revoke all on function public.activate_instagram_authorization(uuid,uuid) from public,anon,authenticated;
grant execute on function public.activate_instagram_authorization(uuid,uuid) to service_role;
commit;
