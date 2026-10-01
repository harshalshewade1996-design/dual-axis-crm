import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {authorizationUrl,digest,encryptToken,decryptToken,accountResult,tokenResult,expiry} from '../supabase/functions/_shared/instagram_oauth.ts';

const secret='a'.repeat(64),token='test-secret-token';
const encrypted=await encryptToken(token,secret,'client-a');
assert(!encrypted.includes(token));assert.equal(await decryptToken(encrypted,secret,'client-a'),token);
await assert.rejects(decryptToken(encrypted,secret,'client-b'));await assert.rejects(decryptToken(encrypted,'b'.repeat(64),'client-a'));
const authUrl=new URL(authorizationUrl('123','https://example.test/callback','state'));
assert.equal(authUrl.hostname,'www.instagram.com');assert.equal(authUrl.searchParams.get('state'),'state');
assert.equal(authUrl.searchParams.get('scope'),'instagram_business_basic,instagram_business_manage_messages');
assert.equal(accountResult({id:'wrong-app-id',user_id:'17841444533924528',username:'studio'}).instagram_account_id,'17841444533924528');
assert.throws(()=>accountResult({id:'123',username:'studio'}));assert.throws(()=>accountResult({user_id:17841444533924528,username:'studio'}));
assert.throws(()=>tokenResult({access_token:'x',data:[{access_token:'y'}]}));assert.throws(()=>tokenResult({data:[]}));
assert.equal(tokenResult({data:[{access_token:'x'}]}).access_token,'x');assert.throws(()=>expiry(0));

// Run the actual Edge handler with in-memory DB/network boundaries. No real authorization is sent.
const rows={organizations:[{id:'client-a',active:true},{id:'client-off',active:false}],profiles:[{user_id:'admin',role:'admin'},{user_id:'client',role:'client'}],instagram_oauth_sessions:[],instagram_authorizations:[],meta_instagram_connections:[]};
class Query {
 constructor(table){this.table=table;this.filters=[];this.operation='select';}
 select(columns='*'){this.returning=true;this.columns=columns;return this;} eq(k,v){this.filters.push(r=>r[k]===v);return this;} neq(k,v){this.filters.push(r=>r[k]!==v);return this;}
 gt(k,v){this.filters.push(r=>r[k]>v);return this;} in(k,v){this.filters.push(r=>v.includes(r[k]));return this;}
 update(v){this.operation='update';this.value=v;return this;} insert(v){this.operation='insert';this.value=v;return this;}
 order(){this.ordered=true;return this;} limit(n){this.limitValue=n;return this;} maybeSingle(){this.single=true;return this;}
 then(resolve){let data=rows[this.table].filter(r=>this.filters.every(f=>f(r)));if(this.operation==='update')data.forEach(r=>Object.assign(r,this.value));if(this.operation==='insert'){const r={id:crypto.randomUUID(),...this.value};rows[this.table].push(r);data=[r];}if(this.ordered)data=data.toReversed();if(this.limitValue)data=data.slice(0,this.limitValue);if(this.columns&&this.columns!=='*')data=data.map(r=>Object.fromEntries(this.columns.split(',').map(k=>[k,r[k]])));return Promise.resolve({data:this.single?data[0]||null:data,error:null}).then(resolve);}
}
let handler,fetchCount=0,subscriptionFailure=false;
const env={SUPABASE_URL:'https://project.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-only',META_INSTAGRAM_APP_ID:'123',META_INSTAGRAM_APP_SECRET:'app-secret',INSTAGRAM_TOKEN_ENCRYPTION_KEY:secret,META_API_VERSION:'v26.0',CRM_ORIGIN:'https://crm.test',CRM_INSTAGRAM_RETURN_URL:'https://crm.test/instagram-connected.html'};
const client={from:t=>new Query(t),auth:{async getUser(t){return {data:{user:['admin','client'].includes(t)?{id:t}:null},error:null};}},async rpc(name,args){if(name==='start_instagram_authorization'){rows.instagram_oauth_sessions.forEach(r=>{if(r.org_id===args.p_org){r.status='cancelled';r.token_ciphertext=null;}});rows.instagram_oauth_sessions.push({id:crypto.randomUUID(),org_id:args.p_org,initiated_by:args.p_actor,state_hash:args.p_state_hash,expires_at:args.p_expires,status:'awaiting'});}else if(name==='activate_instagram_authorization'){const s=rows.instagram_oauth_sessions.find(r=>r.id===args.p_session);rows.instagram_authorizations.push({org_id:s.org_id,instagram_account_id:s.instagram_account_id,token_ciphertext:s.token_ciphertext,expires_at:s.token_expires_at});s.status='connected';s.token_ciphertext=null;}return {data:null,error:null};}};
const originalFetch=globalThis.fetch;
globalThis.fetch=async url=>{fetchCount++;const u=new URL(url);if(u.hostname==='api.instagram.com')return Response.json({access_token:'short'});if(u.pathname==='/access_token')return Response.json({access_token:token,expires_in:5184000});if(u.pathname.endsWith('/me'))return Response.json({id:'app-id',user_id:'17841444533924528',username:'studio'});if(u.pathname.endsWith('/subscribed_apps'))return subscriptionFailure?Response.json({error:{message:token}},{status:403}):Response.json({success:true});throw new Error('Unexpected endpoint');};
globalThis.Deno={env:{get:n=>env[n]},serve:h=>handler=h};globalThis.__instagramTestClient=client;
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'crm-ig-test-'));
try{
 let source=await fs.readFile(new URL('../supabase/functions/instagram-onboarding/index.ts',import.meta.url),'utf8');
 source=source.replace(/import \{ createClient \} from '[^']+';/,"const createClient=()=>globalThis.__instagramTestClient;").replace("'../_shared/instagram_oauth.ts'",JSON.stringify(new URL('../supabase/functions/_shared/instagram_oauth.ts',import.meta.url).href));
 const file=path.join(dir,'handler.ts');await fs.writeFile(file,source);await import(pathToFileURL(file).href);
 const post=(body,user='admin',origin='https://crm.test')=>handler(new Request('https://project.supabase.co/functions/v1/instagram-onboarding',{method:'POST',headers:{Authorization:'Bearer '+user,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)}));
 assert.equal((await post({action:'start',org_id:'client-a'},'invalid')).status,401);
 assert.equal((await post({action:'start',org_id:'client-a'},'client')).status,403);
 assert.equal((await post({action:'start',org_id:'client-a'},'admin','https://evil.test')).status,403);
 assert.equal((await post({action:'start',org_id:'client-off'})).status,400);
 let result=await(await post({action:'start',org_id:'client-a'})).json();let state=new URL(result.url).searchParams.get('state');
 assert.equal(rows.instagram_oauth_sessions[0].state_hash,await digest(state));assert(!JSON.stringify(rows).includes(state));
 const get=s=>handler(new Request('https://project.supabase.co/functions/v1/instagram-onboarding?state='+s+'&code=test-code'));
 let response=await get(state);assert.equal(response.status,303);assert.equal(response.headers.get('Location'),'https://crm.test/instagram-connected.html?result=authorized');
 const count=fetchCount;await get(state);assert.equal(fetchCount,count,'OAuth replay must not reach Meta');
 const status=await(await post({action:'status',org_id:'client-a'})).json();assert.equal(status.session.instagram_username,'studio');
 assert(!JSON.stringify(status).includes(token));assert(!JSON.stringify(status).includes('token_ciphertext'));assert(!JSON.stringify(status).includes('state_hash'));
 const session=rows.instagram_oauth_sessions.find(s=>s.id===status.session.id);subscriptionFailure=true;
 response=await post({action:'activate',org_id:'client-a',session_id:session.id});assert.equal(response.status,400);assert(!(await response.text()).includes(token));assert.equal(session.status,'authorized');assert.equal(rows.instagram_authorizations.length,0);
 rows.meta_instagram_connections.push({org_id:'other',instagram_account_id:session.instagram_account_id});subscriptionFailure=false;
 response=await post({action:'activate',org_id:'client-a',session_id:session.id});assert.equal(response.status,400);assert.equal(rows.instagram_authorizations.length,0);
 rows.meta_instagram_connections=[];response=await post({action:'activate',org_id:'client-a',session_id:session.id});assert.equal(response.status,200);assert.equal(session.token_ciphertext,null);
 assert.equal(await decryptToken(rows.instagram_authorizations[0].token_ciphertext,secret,'client-a'),token);
 result=await(await post({action:'start',org_id:'client-a'})).json();state=new URL(result.url).searchParams.get('state');rows.instagram_oauth_sessions.at(-1).expires_at=new Date(Date.now()-1000).toISOString();const before=fetchCount;await get(state);assert.equal(fetchCount,before);
 console.log('Instagram onboarding: encryption binding, IDs, admin/inactive/origin checks, one-use state, expiry, subscription failure, account conflict and activation passed.');
}finally{globalThis.fetch=originalFetch;delete globalThis.Deno;delete globalThis.__instagramTestClient;await fs.rm(dir,{recursive:true,force:true});}
