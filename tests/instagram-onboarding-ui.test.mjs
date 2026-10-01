import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const elements=new Map();
function el(id){if(!elements.has(id))elements.set(id,{value:'',hidden:false,disabled:false,textContent:'',handlers:{},addEventListener(event,fn){this.handlers[event]=fn;}});return elements.get(id);}
el('phase3IgClient').value='client-a';
let nextResponse={data:{session:null,connection:null,configured:true}},calls=[];
const ctx=vm.createContext({document:{getElementById:el},window:{phase3Render:async()=>{}},demoMode:false,currentProfile:{role:'admin'},phase3ClientName:id=>id,phase3IgRender:async()=>{},toast:()=>{},navigator:{clipboard:{writeText:async()=>{}}},Date,URLSearchParams,console,sb:{functions:{invoke:async(name,args)=>{calls.push(args.body);return await nextResponse;}}}});
vm.runInContext(fs.readFileSync(new URL('../instagram-onboarding.js',import.meta.url),'utf8'),ctx);
const run=s=>vm.runInContext(s,ctx);
await run('igCheckAuthorization()');assert.equal(el('igConfirmAccount').hidden,true);
nextResponse={data:{session:{id:'session-a',status:'authorized',instagram_username:'studio',instagram_account_id:'123',expires_at:new Date(Date.now()+60000).toISOString()},configured:true}};
await run('igCheckAuthorization()');assert.equal(el('igConfirmAccount').hidden,false);assert.match(el('igAuthorizationStatus').textContent,/@studio.*client-a/);
el('phase3IgClient').value='client-b';const before=calls.length;await run("igOnboardingAction('activate')");assert.equal(calls.length,before,'Stale review cannot activate another client');
let resolve;nextResponse=new Promise(r=>resolve=r);const pending=run('igCheckAuthorization()');el('phase3IgClient').value='client-c';resolve({data:{session:{id:'wrong',status:'authorized',expires_at:new Date(Date.now()+60000).toISOString()}}});await pending;assert.equal(el('igConfirmAccount').hidden,true);
await run("currentProfile={role:'client'};igOnboardingVisibility()");assert.equal(el('igOnboardingPanel').hidden,true);
nextResponse={data:{url:'https://www.instagram.com/oauth/authorize?state=test',expires_at:new Date(Date.now()+60000).toISOString()}};
await run("currentProfile={role:'admin'};igOnboardingAction('start')");assert.equal(el('igCopyLink').hidden,false);assert.equal(el('igCreateLink').disabled,false);
console.log('Instagram onboarding UI: admin visibility, account review, cross-client guard, stale responses, link display and button recovery passed.');
