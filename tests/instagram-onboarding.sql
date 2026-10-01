-- Execute after instagram_onboarding.sql. No fixtures or mapping changes are committed.
begin;
do $$
declare actor_id uuid; org_a uuid:=gen_random_uuid();org_b uuid:=gen_random_uuid();session_a uuid;session_b uuid;
begin
  select user_id into actor_id from public.profiles where role='admin' limit 1;
  if actor_id is null then raise exception 'An existing admin is required for this rollback test'; end if;
  if has_table_privilege('authenticated','public.instagram_authorizations','SELECT') or has_table_privilege('anon','public.instagram_oauth_sessions','SELECT') then raise exception 'Credentials are exposed'; end if;
  if has_function_privilege('authenticated','public.activate_instagram_authorization(uuid,uuid)','EXECUTE') or has_function_privilege('anon','public.start_instagram_authorization(uuid,uuid,text,timestamptz)','EXECUTE') then raise exception 'Transaction functions are exposed'; end if;
  insert into public.organizations(id,name,active) values(org_a,'ONBOARDING ROLLBACK A',true),(org_b,'ONBOARDING ROLLBACK B',true);
  perform public.start_instagram_authorization(org_a,actor_id,repeat('a',64),now()+interval '30 minutes');
  select id into session_a from public.instagram_oauth_sessions where org_id=org_a and status='awaiting';
  perform public.start_instagram_authorization(org_a,actor_id,repeat('b',64),now()+interval '30 minutes');
  if (select status from public.instagram_oauth_sessions where id=session_a)<>'cancelled' then raise exception 'Old link not cancelled'; end if;
  select id into session_a from public.instagram_oauth_sessions where org_id=org_a and status='awaiting';
  update public.instagram_oauth_sessions set status='activating',instagram_account_id='onboarding-fixture-account',instagram_username='fixture',token_ciphertext='fixture-encrypted-not-real',token_expires_at=now()+interval '60 days' where id=session_a;
  perform public.activate_instagram_authorization(session_a,actor_id);
  if not exists(select 1 from public.meta_instagram_connections where org_id=org_a and instagram_account_id='onboarding-fixture-account' and enabled=true) or not exists(select 1 from public.instagram_authorizations where org_id=org_a) then raise exception 'Activation not atomic'; end if;
  if (select token_ciphertext from public.instagram_oauth_sessions where id=session_a) is not null then raise exception 'Review token not cleared'; end if;
  perform public.start_instagram_authorization(org_b,actor_id,repeat('c',64),now()+interval '30 minutes');
  select id into session_b from public.instagram_oauth_sessions where org_id=org_b and status='awaiting';
  update public.instagram_oauth_sessions set status='activating',instagram_account_id='onboarding-fixture-account',instagram_username='fixture',token_ciphertext='fixture',token_expires_at=now()+interval '60 days' where id=session_b;
  begin
    perform public.activate_instagram_authorization(session_b,actor_id);
    raise exception 'Duplicate account was assigned to another organization';
  exception when unique_violation then null;
  end;
  if exists(select 1 from public.instagram_authorizations where org_id=org_b) then raise exception 'Failed activation left credentials'; end if;
  update public.organizations set active=false where id=org_b;
  begin
    perform public.start_instagram_authorization(org_b,actor_id,repeat('d',64),now()+interval '30 minutes');
    raise exception 'Inactive organization was accepted';
  exception when raise_exception then
    if sqlerrm<>'Client account inactive' then raise; end if;
  end;
end $$;
select 'Onboarding ACLs, replaced links, atomic activation, duplicate account and inactive organization passed' as result;
rollback;
