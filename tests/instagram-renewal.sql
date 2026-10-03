begin;
do $$
declare org uuid=gen_random_uuid(); disabled_org uuid=gen_random_uuid(); run uuid=gen_random_uuid(); other_run uuid=gen_random_uuid(); claimed integer; result boolean;
begin
  if has_table_privilege('authenticated','public.instagram_refresh_runs','SELECT') or has_table_privilege('anon','public.instagram_refresh_runs','SELECT') then raise exception 'Run access leaked'; end if;
  if has_function_privilege('authenticated','public.enqueue_instagram_refresh(boolean)','EXECUTE') or has_function_privilege('service_role','public.enqueue_instagram_refresh(boolean)','EXECUTE') then raise exception 'Enqueue access leaked'; end if;
  if has_function_privilege('anon','public.claim_instagram_refresh_accounts(uuid)','EXECUTE') then raise exception 'Credential access leaked'; end if;
  insert into public.organizations(id,name,active) values(org,'Renewal rollback fixture',true),(disabled_org,'Renewal disabled fixture',false);
  insert into public.meta_instagram_connections(org_id,instagram_account_id,enabled) values(org,'90000000000000001',true),(disabled_org,'90000000000000002',true);
  insert into public.instagram_authorizations(org_id,instagram_account_id,token_ciphertext,expires_at,refreshed_at)
    values(org,'90000000000000001','fake-old',now()+interval '5 days',now()-interval '40 days'),(disabled_org,'90000000000000002','fake-disabled',now()+interval '5 days',now()-interval '40 days');
  insert into public.instagram_refresh_runs(id,auth_hash,expires_at) values(run,'hash',now()+interval '10 minutes'),(other_run,'hash',now()+interval '10 minutes');
  select count(*) into claimed from public.claim_instagram_refresh_run(run,'bad-hash');if claimed<>0 then raise exception 'Bad ticket accepted'; end if;
  select count(*) into claimed from public.claim_instagram_refresh_run(run,'hash');if claimed<>1 then raise exception 'Ticket rejected'; end if;
  select count(*) into claimed from public.claim_instagram_refresh_run(run,'hash');if claimed<>0 then raise exception 'Replay accepted'; end if;
  perform public.claim_instagram_refresh_run(other_run,'hash');
  perform public.claim_instagram_refresh_accounts(run);
  if (select refresh_lock_id from public.instagram_authorizations where org_id=org) is distinct from run then raise exception 'Due account not claimed'; end if;
  if (select refresh_lock_id from public.instagram_authorizations where org_id=disabled_org) is not null then raise exception 'Inactive client claimed'; end if;
  perform public.claim_instagram_refresh_accounts(other_run);
  if (select refresh_lock_id from public.instagram_authorizations where org_id=org) is distinct from run then raise exception 'Lease stolen'; end if;
  result=public.finish_instagram_refresh(run,org,'90000000000000001','changed-token','renewed','fake-new',now()+interval '60 days');if result then raise exception 'Changed authorization overwritten'; end if;
  result=public.finish_instagram_refresh(run,org,'90000000000000001','fake-old','retry');if not result then raise exception 'Retry failed'; end if;
  if (select token_ciphertext from public.instagram_authorizations where org_id=org)<>'fake-old' then raise exception 'Failure changed token'; end if;
  perform public.claim_instagram_refresh_accounts(other_run);
  if (select refresh_lock_id from public.instagram_authorizations where org_id=org) is not null then raise exception 'Retry backoff ignored'; end if;
  update public.instagram_authorizations set refresh_retry_at=null where org_id=org;
  perform public.claim_instagram_refresh_accounts(other_run);
  result=public.finish_instagram_refresh(other_run,org,'90000000000000001','fake-old','renewed','fake-new',now()+interval '60 days');if not result then raise exception 'Renewal rejected'; end if;
  if (select token_ciphertext from public.instagram_authorizations where org_id=org)<>'fake-new' then raise exception 'Renewal not stored'; end if;
end $$;
rollback;
