import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { authorizationUrl, randomState, digest, encryptToken, decryptToken, tokenResult, accountResult, expiry, metaJson } from '../_shared/instagram_oauth.ts';

const env = (name: string) => Deno.env.get(name) || '';
const admin = createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false}});
const appId=env('META_INSTAGRAM_APP_ID'), appSecret=env('META_INSTAGRAM_APP_SECRET');
const encryption=env('INSTAGRAM_TOKEN_ENCRYPTION_KEY');
const redirect=env('SUPABASE_URL')+'/functions/v1/instagram-onboarding';
const version=env('META_API_VERSION');
const origin=env('CRM_ORIGIN');
const returnUrl=env('CRM_INSTAGRAM_RETURN_URL');
const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
function json(data: unknown,status=200) {return Response.json(data,{status,headers});}
function page(success: boolean) {
  // Hosted Supabase rewrites HTML to plain text. Redirect to our fixed static result page.
  // Never carry OAuth code, state, token or provider error to the frontend.
  try{const destination=new URL(returnUrl);if(destination.protocol!=='https:'||destination.origin!==origin)throw new Error();destination.search='result='+(success?'authorized':'failed');destination.hash='';return new Response(null,{status:303,headers:{Location:destination.toString(),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});}catch{return new Response('Instagram authorization could not be completed. Contact Dual Axis Media.',{status:400,headers:{'Content-Type':'text/plain','Cache-Control':'no-store'}});}
}
function ready() {if(!appId||!appSecret||! /^[0-9a-f]{64}$/i.test(encryption)||!/^v\d+\.\d+$/.test(version)||!origin||!returnUrl)throw new Error('Instagram onboarding needs app configuration');const destination=new URL(returnUrl);if(destination.protocol!=='https:'||destination.origin!==origin)throw new Error('Invalid Instagram return page');}
async function checked<T>(query: PromiseLike<{data:T,error:any}>) {const {data,error}=await query;if(error)throw new Error('Could not save Instagram authorization');return data;}
async function activeOrg(orgId: string) {
  const org=await checked<any>(admin.from('organizations').select('id,active').eq('id',orgId).maybeSingle());
  if(!org?.active)throw new Error('Client account inactive');
}
async function actor(req: Request) {
  const token=(req.headers.get('Authorization')||'').match(/^Bearer (.+)$/i)?.[1];
  if(!token)throw new Error('Unauthorized');
  const {data,error}=await admin.auth.getUser(token);
  if(error||!data.user)throw new Error('Unauthorized');
  const profile=await checked<any>(admin.from('profiles').select('role').eq('user_id',data.user.id).maybeSingle());
  if(profile?.role!=='admin')throw new Error('Admin required');
  return data.user.id;
}
async function callback(url: URL) {
  ready();
  const state=url.searchParams.get('state')||'';
  if(!/^[0-9a-f]{64}$/.test(state))return page(false);
  // Consume state atomically BEFORE any exchange; parallel/replayed callbacks cannot reuse it.
  const session=await checked<any>(admin.from('instagram_oauth_sessions').update({status:'exchanging'})
    .eq('state_hash',await digest(state)).eq('status','awaiting').gt('expires_at',new Date().toISOString()).select('*').maybeSingle());
  if(!session)return page(false);
  let stage='client_access';
  try {
    await activeOrg(session.org_id);
    const initiator=await checked<any>(admin.from('profiles').select('role').eq('user_id',session.initiated_by).maybeSingle());
    if(initiator?.role!=='admin'||url.searchParams.has('error'))throw new Error('Authorization cancelled');
    const code=url.searchParams.get('code');if(!code)throw new Error('Missing authorization code');
    stage='short_token_exchange';
    const short=tokenResult(await metaJson('https://api.instagram.com/oauth/access_token',{method:'POST',body:new URLSearchParams({client_id:appId,client_secret:appSecret,grant_type:'authorization_code',redirect_uri:redirect,code})}));
    stage='long_token_exchange';
    const exchange=new URL(`https://graph.instagram.com/${version}/access_token`);
    exchange.search=new URLSearchParams({grant_type:'ig_exchange_token',client_secret:appSecret,access_token:short.access_token,fields:'access_token,expires_in,token_type'}).toString();
    const long=tokenResult(await metaJson(exchange,{method:'GET'}));
    stage='professional_account_lookup';
    const profile=accountResult(await metaJson(`https://graph.instagram.com/${version}/me?fields=user_id,username`,{headers:{Authorization:`Bearer ${long.access_token}`}}));
    stage='save_authorization';
    const saved=await checked<any>(admin.from('instagram_oauth_sessions').update({...profile,status:'authorized',token_expires_at:expiry(long.expires_in),token_ciphertext:await encryptToken(long.access_token,encryption,session.org_id)}).eq('id',session.id).eq('status','exchanging').gt('expires_at',new Date().toISOString()).select('id').maybeSingle());
    if(!saved)throw new Error('Authorization link was replaced or expired');
    return page(true);
  } catch (error) {
    // Fixed stage labels only. Never log provider responses, URLs, codes or tokens.
    const numeric=(key:string)=>{const value=(error as any)?.[key];return Number.isSafeInteger(value)?value:null;};
    const reasons=['get_method_unsupported','app_secret_rejected','permission_rejected','token_expired','token_rejected','request_unsupported','unclassified'];
    const reason=reasons.includes((error as any)?.provider_reason)?(error as any).provider_reason:'local_failure';
    console.warn(JSON.stringify({event:'instagram_authorization_failed',stage,session_id:session.id,
      http_status:numeric('http_status'),provider_code:numeric('provider_code'),provider_subcode:numeric('provider_subcode'),provider_reason:reason}));
    await checked(admin.from('instagram_oauth_sessions').update({status:'failed',token_ciphertext:null}).eq('id',session.id).eq('status','exchanging'));
    return page(false);
  }
}
Deno.serve(async req=>{
  const url=new URL(req.url);
  if(req.method==='GET') {try{return await callback(url);}catch{return page(false);}}
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  if(req.headers.get('Origin')&&req.headers.get('Origin')!==origin)return json({error:'Origin not allowed'},403);
  try {
    const userId=await actor(req);
    const body=await req.json();const orgId=String(body.org_id||'');
    await activeOrg(orgId);
    if(body.action==='status') {
      const session=await checked<any>(admin.from('instagram_oauth_sessions').select('id,status,expires_at,instagram_account_id,instagram_username').eq('org_id',orgId).order('created_at',{ascending:false}).limit(1).maybeSingle());
      const connection=await checked<any>(admin.from('instagram_authorizations').select('instagram_account_id,expires_at,refreshed_at,last_refresh_result,last_refresh_attempt_at').eq('org_id',orgId).maybeSingle());
      let configured=true;try{ready();}catch{configured=false;}
      return json({session,connection,configured});
    }
    ready();
    if(body.action==='start') {
      // New link invalidates all pending links/reviews for this client.
      const state=randomState();const expiresAt=new Date(Date.now()+30*60000).toISOString();
      await checked(admin.rpc('start_instagram_authorization',{p_org:orgId,p_actor:userId,p_state_hash:await digest(state),p_expires:expiresAt}));
      return json({url:authorizationUrl(appId,redirect,state),expires_at:expiresAt});
    }
    if(body.action==='activate') {
      const session=await checked<any>(admin.from('instagram_oauth_sessions').update({status:'activating'}).eq('id',body.session_id).eq('org_id',orgId).eq('status','authorized').gt('expires_at',new Date().toISOString()).select('*').maybeSingle());
      if(!session)throw new Error('Authorization expired. Create a new link.');
      try {
        const conflict=await checked<any>(admin.from('meta_instagram_connections').select('org_id').eq('instagram_account_id',session.instagram_account_id).neq('org_id',orgId).maybeSingle());
        if(conflict)throw new Error('This Instagram account belongs to another CRM client');
        const token=await decryptToken(session.token_ciphertext,encryption,orgId);
        const subscription=await metaJson(`https://graph.instagram.com/${version}/${session.instagram_account_id}/subscribed_apps`,{method:'POST',headers:{Authorization:`Bearer ${token}`},body:new URLSearchParams({subscribed_fields:'messages,messaging_postbacks,messaging_referral'})});
        if(subscription.success!==true)throw new Error('Instagram webhook subscription was not accepted');
        await checked(admin.rpc('activate_instagram_authorization',{p_session:session.id,p_actor:userId}));
      }catch(e) {
        await checked(admin.from('instagram_oauth_sessions').update({status:'authorized'}).eq('id',session.id).eq('status','activating'));
        throw e;
      }
      return json({connected:true});
    }
    if(body.action==='refresh') {
      const connection=await checked<any>(admin.from('instagram_authorizations').select('*').eq('org_id',orgId).maybeSingle());
      if(!connection||Date.parse(connection.expires_at)<=Date.now())throw new Error('Authorization expired. Reconnect Instagram.');
      if(connection.refresh_lock_until&&Date.parse(connection.refresh_lock_until)>Date.now())throw new Error('Automatic renewal is running. Check again shortly.');
      if(Date.now()-Date.parse(connection.refreshed_at)<86400000)throw new Error('Authorization can be refreshed after 24 hours');
      const token=await decryptToken(connection.token_ciphertext,encryption,orgId);
      const refresh=new URL(`https://graph.instagram.com/${version}/refresh_access_token`);
      refresh.search=new URLSearchParams({grant_type:'ig_refresh_token',access_token:token,fields:'access_token,expires_in,token_type'}).toString();
      const result=tokenResult(await metaJson(refresh));
      const saved=await checked<any>(admin.from('instagram_authorizations').update({token_ciphertext:await encryptToken(result.access_token,encryption,orgId),expires_at:expiry(result.expires_in),refreshed_at:new Date().toISOString(),last_refresh_result:'renewed',refresh_retry_at:null,refresh_lock_id:null,refresh_lock_until:null}).eq('org_id',orgId).eq('instagram_account_id',connection.instagram_account_id).eq('refreshed_at',connection.refreshed_at).select('org_id').maybeSingle());
      if(!saved)throw new Error('Authorization changed. Check again.');
      return json({refreshed:true});
    }
    return json({error:'Unknown action'},400);
  }catch(e) {const message=e instanceof Error?e.message:'Onboarding failed';return json({error:message},message==='Unauthorized'?401:message==='Admin required'?403:400);}
});
