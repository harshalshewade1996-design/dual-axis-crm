import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {encryptToken,decryptToken} from '../supabase/functions/_shared/instagram_oauth.ts';
const runId=crypto.randomUUID(),ticket='a'.repeat(64),key='b'.repeat(64),oldToken='private-old-token',newToken='private-new-token';
const account={org_id:crypto.randomUUID(),instagram_account_id:'17841444533924528',token_ciphertext:await encryptToken(oldToken,key,'binding')};
account.token_ciphertext=await encryptToken(oldToken,key,account.org_id);
let handler,claimed=false,fetches=0,failure=false,mismatch=false,saved=[],updates=[];
const client={rpc:async(name,args)=>{
 if(name==='claim_instagram_refresh_run'){if(claimed||args.p_run!==runId)return {data:[],error:null};claimed=true;return {data:[{force_refresh:false}],error:null};}
 if(name==='claim_instagram_refresh_accounts')return {data:[account],error:null};
 if(name==='finish_instagram_refresh'){saved.push(args);return {data:true,error:null};}
 throw new Error('Unexpected RPC');
},from:()=>({update(data){updates.push(data);return this;},eq(){return this;},then(resolve){return Promise.resolve({data:null,error:null}).then(resolve);}})};
const originalFetch=globalThis.fetch,originalWarn=console.warn;let warnings=[];
globalThis.fetch=async(url,options)=>{fetches++;const u=new URL(url);
 if(u.pathname.endsWith('/refresh_access_token')){assert.equal(options.method,'GET');assert.equal(u.searchParams.get('grant_type'),'ig_refresh_token');assert.equal(u.searchParams.get('fields'),'access_token,expires_in,token_type');return failure?Response.json({error:{code:190,message:oldToken}},{status:400}):Response.json({access_token:newToken,expires_in:5184000});}
 assert.equal(options.headers.Authorization,'Bearer '+newToken);return Response.json({user_id:mismatch?'999':account.instagram_account_id,username:'studio'});
};
console.warn=v=>warnings.push(v);
globalThis.Deno={env:{get:n=>({SUPABASE_URL:'https://project.test',SUPABASE_SERVICE_ROLE_KEY:'test-key',INSTAGRAM_TOKEN_ENCRYPTION_KEY:key,META_API_VERSION:'v26.0'})[n]},serve:h=>handler=h};globalThis.__renewalClient=client;
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ig-renewal-'));
try{
 let source=await fs.readFile(new URL('../supabase/functions/instagram-token-renewal/index.ts',import.meta.url),'utf8');
 source=source.replace(/import \{createClient\} from '[^']+';/,'const createClient=()=>globalThis.__renewalClient;').replace("'../_shared/instagram_oauth.ts'",JSON.stringify(new URL('../supabase/functions/_shared/instagram_oauth.ts',import.meta.url).href));
 const file=path.join(dir,'handler.ts');await fs.writeFile(file,source);await import(pathToFileURL(file).href);
 const request=(auth=ticket,id=runId)=>handler(new Request('https://project.test/renewal',{method:'POST',headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},body:JSON.stringify({run_id:id})}));
 assert.equal((await request('user-jwt')).status,401);assert.equal(fetches,0);
 assert.equal((await request(ticket,crypto.randomUUID())).status,401);assert.equal(updates.length,0);
 const response=await request();assert.deepEqual(await response.json(),{renewed:1,failed:0});assert.equal(saved[0].p_result,'renewed');assert.equal(await decryptToken(saved[0].p_ciphertext,key,account.org_id),newToken);
 const count=fetches;assert.equal((await request()).status,401);assert.equal(fetches,count,'Replay cannot refresh');
 claimed=false;failure=true;await request();assert.equal(saved.at(-1).p_result,'reconnect_required');assert.equal(saved.at(-1).p_ciphertext,null);assert(!warnings.join('').includes(oldToken));
 claimed=false;failure=false;mismatch=true;await request();assert.equal(saved.at(-1).p_result,'retry');assert.equal(saved.at(-1).p_ciphertext,null);
 assert(!JSON.stringify(updates).includes(newToken));assert(!warnings.join('').includes(key));
 console.log('Renewal: unauthorized/replay rejected, encrypted renewal saved, revoked token and account mismatch handled without secrets.');
}finally{globalThis.fetch=originalFetch;console.warn=originalWarn;delete globalThis.Deno;delete globalThis.__renewalClient;await fs.rm(dir,{recursive:true,force:true});}
