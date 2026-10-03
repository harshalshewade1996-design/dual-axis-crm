import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {digest,decryptToken,encryptToken,tokenResult,accountResult,expiry,metaJson} from '../_shared/instagram_oauth.ts';
const env=(name:string)=>Deno.env.get(name)||'';
const admin=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false}});
const encryption=env('INSTAGRAM_TOKEN_ENCRYPTION_KEY'),version=env('META_API_VERSION');
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
async function checked<T>(query:PromiseLike<{data:T,error:any}>){const {data,error}=await query;if(error)throw new Error('Database operation failed');return data;}
Deno.serve(async req=>{
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  const ticket=(req.headers.get('Authorization')||'').match(/^Bearer ([0-9a-f]{64})$/)?.[1];
  if(!ticket)return json({error:'Unauthorized'},401);
  let runId='',claimed=false;
  try{
    const body=await req.json();runId=String(body.run_id||'');
    if(!/^[0-9a-f-]{36}$/.test(runId))return json({error:'Unauthorized'},401);
    const run=await checked<any>(admin.rpc('claim_instagram_refresh_run',{p_run:runId,p_hash:await digest(ticket)}));
    if(!run?.length)return json({error:'Unauthorized'},401);
    claimed=true;
    if(!/^[0-9a-f]{64}$/i.test(encryption)||!/^v\d+\.\d+$/.test(version))throw new Error('Configuration missing');
    const accounts=await checked<any>(admin.rpc('claim_instagram_refresh_accounts',{p_run:runId}));
    let renewed=0,failed=0;
    for(const account of accounts||[]){
      let result='retry',ciphertext=null,expiresAt=null;
      try{
        const token=await decryptToken(account.token_ciphertext,encryption,account.org_id);
        const url=new URL(`https://graph.instagram.com/${version}/refresh_access_token`);
        url.search=new URLSearchParams({grant_type:'ig_refresh_token',access_token:token,fields:'access_token,expires_in,token_type'}).toString();
        const refreshed=tokenResult(await metaJson(url,{method:'GET'}));
        expiresAt=expiry(refreshed.expires_in);
        const profile=accountResult(await metaJson(`https://graph.instagram.com/${version}/me?fields=user_id,username`,{headers:{Authorization:`Bearer ${refreshed.access_token}`}}));
        if(profile.instagram_account_id!==account.instagram_account_id)throw new Error('Account mismatch');
        ciphertext=await encryptToken(refreshed.access_token,encryption,account.org_id);result='renewed';
      }catch(error){
        const code=(error as any)?.provider_code;
        if([190,10,200].includes(code))result='reconnect_required';
        // Never print provider response text, request URLs, tokens or ciphertext.
        console.warn(JSON.stringify({event:'instagram_renewal_failed',org_id:account.org_id,provider_code:Number.isSafeInteger(code)?code:null,result}));
      }
      const saved=await checked(admin.rpc('finish_instagram_refresh',{p_run:runId,p_org:account.org_id,p_account:account.instagram_account_id,p_previous:account.token_ciphertext,p_result:result,p_ciphertext:ciphertext,p_expiry:expiresAt}));
      if(saved&&result==='renewed')renewed++;else failed++;
    }
    await checked(admin.from('instagram_refresh_runs').update({status:'completed',finished_at:new Date().toISOString(),renewed,failed}).eq('id',runId).eq('status','running'));
    return json({renewed,failed});
  }catch{
    if(claimed)await admin.from('instagram_refresh_runs').update({status:'failed',finished_at:new Date().toISOString()}).eq('id',runId).eq('status','running');
    return json({error:'Renewal run failed'},500);
  }
});
