const PHASE3_DEMO_SOURCE_KEY = 'dual_axis_crm_meta_sources_v3';
const PHASE3_DEMO_IMPORT_KEY = 'dual_axis_crm_meta_imports_v3';

const phase3DemoSourcesSeed = [
  {id:'src-1',org_id:'demo-1',page_id:'100000001',form_id:'200000001',page_name:'Oviegraphy',form_name:'Wedding Leads',enabled:true},
  {id:'src-2',org_id:'demo-2',page_id:'100000002',form_id:'200000002',page_name:'Atulya Katha',form_name:'Wedding Enquiries',enabled:true}
];
const phase3DemoImportsSeed = [
  {id:'imp-1',org_id:'demo-1',lead_id:'1',leadgen_id:'META-10001',page_id:'100000001',form_id:'200000001',ad_id:'300000001',adset_id:'400000001',campaign_id:'500000001',import_status:'imported',received_at:new Date().toISOString(),imported_at:new Date().toISOString(),error_message:''},
  {id:'imp-2',org_id:'demo-2',lead_id:'2',leadgen_id:'META-10002',page_id:'100000002',form_id:'200000002',ad_id:'300000002',adset_id:'400000002',campaign_id:'500000002',import_status:'imported',received_at:new Date(Date.now()-3600000).toISOString(),imported_at:new Date(Date.now()-3500000).toISOString(),error_message:''},
  {id:'imp-3',org_id:null,lead_id:null,leadgen_id:'META-10099',page_id:'999999999',form_id:'999999998',ad_id:null,adset_id:null,campaign_id:null,import_status:'unmapped',received_at:new Date(Date.now()-7200000).toISOString(),imported_at:null,error_message:'No active CRM mapping for this Meta Page/form'}
];

function phase3Load(key, seed){const raw=localStorage.getItem(key);if(raw)return JSON.parse(raw);localStorage.setItem(key,JSON.stringify(seed));return seed}
function phase3Save(key,data){localStorage.setItem(key,JSON.stringify(data))}
function phase3Clients(){return typeof clientList==='function'?clientList():[]}
function phase3ClientName(id){const c=phase3Clients().find(x=>x.id===id);return c?.name||'—'}
function phase3Date(v){if(!v)return '—';return new Date(v).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}
function phase3Esc(v){return typeof escapeHtml==='function'?escapeHtml(v):String(v??'')}
function phase3Attr(v){return typeof escapeAttr==='function'?escapeAttr(v):phase3Esc(v)}
function phase3Tag(s){const c=s==='imported'?'good':s==='failed'?'bad':s==='unmapped'?'warn':'';return `<span class="tag ${c}">${phase3Esc(s||'queued')}</span>`}

async function phase3Sources(){
  if(demoMode)return phase3Load(PHASE3_DEMO_SOURCE_KEY, phase3DemoSourcesSeed);
  const {data,error}=await sb.from('meta_lead_sources').select('id,org_id,page_id,form_id,page_name,form_name,enabled').order('created_at',{ascending:false});
  if(error)throw error;return data||[];
}
async function phase3Imports(){
  if(demoMode)return phase3Load(PHASE3_DEMO_IMPORT_KEY, phase3DemoImportsSeed);
  const {data,error}=await sb.from('meta_lead_imports').select('id,org_id,lead_id,leadgen_id,page_id,form_id,ad_id,adset_id,campaign_id,import_status,received_at,imported_at,error_message').order('received_at',{ascending:false}).limit(150);
  if(error)throw error;return data||[];
}

function phase3WebhookUrl(){
  const base=cfg?.url||'';
  return base?`${base.replace(/\/$/,'')}/functions/v1/meta-lead-webhook`:'Not connected — add Supabase URL first';
}

function phase3SourceForm(){
  const sel=document.getElementById('phase3SourceClient');
  sel.innerHTML='<option value="">Select client</option>'+phase3Clients().map(c=>`<option value="${phase3Attr(c.id)}">${phase3Esc(c.name)}</option>`).join('');
  const defaultClient=filters.client!=='all'?filters.client:(phase3Clients()[0]?.id||'');
  if(defaultClient)sel.value=defaultClient;
  const canWrite=demoMode||currentProfile?.role==='admin';
  document.getElementById('phase3SaveSource').disabled=!canWrite;
  document.getElementById('phase3BackfillBtn').disabled=!canWrite||demoMode;
}

function phase3SourceTableHTML(rows){
  if(!rows.length)return '<div class="muted">No Meta Page/form mappings yet.</div>';
  return `<table class="table"><thead><tr><th>Client</th><th>Page</th><th>Form</th><th>Page ID</th><th>Form ID</th><th>Status</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${phase3Esc(phase3ClientName(x.org_id))}</td><td>${phase3Esc(x.page_name||'—')}</td><td>${phase3Esc(x.form_name||'Whole Page')}</td><td><code>${phase3Esc(x.page_id)}</code></td><td><code>${phase3Esc(x.form_id||'—')}</code></td><td>${x.enabled?'<span class="tag good">enabled</span>':'<span class="tag">disabled</span>'}</td></tr>`).join('')}</tbody></table>`;
}

function phase3ImportTableHTML(rows){
  if(!rows.length)return '<div class="muted">No inbound Meta leads recorded yet.</div>';
  return `<table class="table"><thead><tr><th>Received</th><th>Lead ID</th><th>Client</th><th>Campaign</th><th>Ad set</th><th>Ad</th><th>Status</th><th>Error</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${phase3Date(x.received_at)}</td><td><code>${phase3Esc(x.leadgen_id)}</code></td><td>${phase3Esc(phase3ClientName(x.org_id))}</td><td><code>${phase3Esc(x.campaign_id||'—')}</code></td><td><code>${phase3Esc(x.adset_id||'—')}</code></td><td><code>${phase3Esc(x.ad_id||'—')}</code></td><td>${phase3Tag(x.import_status)}</td><td class="error-cell">${phase3Esc(x.error_message||'—')}</td></tr>`).join('')}</tbody></table>`;
}

window.phase3Render = async function(){
  if(!document.getElementById('phase3MetaPanel'))return;
  try{
    phase3SourceForm();
    document.getElementById('phase3WebhookUrl').textContent=phase3WebhookUrl();
    const [sources,imports]=await Promise.all([phase3Sources(),phase3Imports()]);
    const scopedImports=filters.client==='all'?imports:imports.filter(x=>x.org_id===filters.client);
    document.getElementById('phase3SourceTable').innerHTML=phase3SourceTableHTML(filters.client==='all'?sources:sources.filter(x=>x.org_id===filters.client));
    document.getElementById('phase3ImportsTable').innerHTML=phase3ImportTableHTML(scopedImports);
  }catch(e){
    console.error(e);
    document.getElementById('phase3SourceTable').innerHTML=`<div class="muted">Could not load Meta mappings: ${phase3Esc(e.message)}</div>`;
    document.getElementById('phase3ImportsTable').innerHTML='';
  }
};

async function phase3Save(){
  const record={
    org_id:document.getElementById('phase3SourceClient').value,
    page_id:document.getElementById('phase3PageId').value.trim(),
    form_id:document.getElementById('phase3FormId').value.trim()||null,
    page_name:document.getElementById('phase3PageName').value.trim()||null,
    form_name:document.getElementById('phase3FormName').value.trim()||null,
    enabled:document.getElementById('phase3SourceEnabled').checked,
  };
  if(!record.org_id||!record.page_id){toast('Client and Meta Page ID are required');return}
  try{
    if(demoMode){
      const all=phase3Load(PHASE3_DEMO_SOURCE_KEY,phase3DemoSourcesSeed);const i=all.findIndex(x=>x.page_id===record.page_id&&x.form_id===record.form_id);if(i>=0)all[i]={...all[i],...record};else all.unshift({...record,id:crypto.randomUUID()});phase3Save(PHASE3_DEMO_SOURCE_KEY,all);
    }else{
      let existingQuery=sb.from('meta_lead_sources').select('id').eq('page_id',record.page_id);
      existingQuery=record.form_id?existingQuery.eq('form_id',record.form_id):existingQuery.is('form_id',null);
      const {data:existing,error:lookupError}=await existingQuery.maybeSingle();if(lookupError)throw lookupError;
      if(existing?.id){const {error}=await sb.from('meta_lead_sources').update(record).eq('id',existing.id);if(error)throw error;}
      else{const {error}=await sb.from('meta_lead_sources').insert(record);if(error)throw error;}
    }
    toast('Meta lead mapping saved');
    await window.phase3Render();
  }catch(e){console.error(e);toast('Could not save mapping: '+e.message)}
}

async function phase3Backfill(){
  const formId=document.getElementById('phase3BackfillFormId').value.trim();
  const since=document.getElementById('phase3BackfillSince').value;
  const until=document.getElementById('phase3BackfillUntil').value;
  if(demoMode){toast('Backfill is available after connecting Supabase');return}
  const status=document.getElementById('phase3BackfillStatus');status.innerHTML='<span class="status-dot live"></span>Running backfill…';
  try{
    const body={};if(formId)body.form_id=formId;if(since)body.since=since;if(until)body.until=until;
    const {data,error}=await sb.functions.invoke('meta-lead-backfill',{body});
    if(error)throw error;if(data?.ok===false)throw new Error(data.error||'Backfill failed');
    status.innerHTML=`<span class="status-dot live"></span>Backfill complete · ${phase3Esc(JSON.stringify(data.results||[]))}`;toast('Meta backfill completed');await render();
  }catch(e){console.error(e);status.innerHTML=`<span class="status-dot off"></span>${phase3Esc(e.message)}`;toast('Backfill failed')}
}

async function phase3Copy(){
  const value=document.getElementById('phase3WebhookUrl').textContent;
  if(!value||value.startsWith('Not connected')){toast('Connect Supabase first');return}
  try{await navigator.clipboard.writeText(value);toast('Webhook URL copied')}catch{toast('Copy failed — select the URL manually')}
}

function phase3Bind(){
  const b=document.getElementById('phase3SaveSource');if(b)b.addEventListener('click',phase3Save);
  const refresh=document.getElementById('phase3RefreshBtn');if(refresh)refresh.addEventListener('click',()=>window.phase3Render());
  const copy=document.getElementById('phase3CopyWebhook');if(copy)copy.addEventListener('click',phase3Copy);
  const backfill=document.getElementById('phase3BackfillBtn');if(backfill)backfill.addEventListener('click',phase3Backfill);
  const client=document.getElementById('phase3SourceClient');if(client)client.addEventListener('change',()=>window.phase3Render());
  window.phase3Render();
}
phase3Bind();

// -----------------------------
// Phase 3 Primary: Instagram Messaging
// -----------------------------
const PHASE3_IG_CONNECTION_KEY='dual_axis_crm_ig_connections_v1';
const PHASE3_IG_EVENT_KEY='dual_axis_crm_ig_events_v1';
const phase3DemoIgConnectionsSeed=[
  {org_id:'demo-1',instagram_account_id:'178500000001',instagram_username:'@oviegraphy',page_id:'100000001',page_name:'Oviegraphy',enabled:true},
  {org_id:'demo-2',instagram_account_id:'178500000002',instagram_username:'@atulyakatha',page_id:'100000002',page_name:'Atulya Katha',enabled:true}
];
const phase3DemoIgEventsSeed=[
  {id:'ig-evt-1',org_id:'demo-1',lead_id:'1',event_key:'mid.demo.1001',message_id:'mid.demo.1001',instagram_account_id:'178500000001',sender_id:'178414000001',conversation_id:'conv-1001',message_text:'Hi, wedding photography package details please',message_timestamp:new Date().toISOString(),source:'instagram_message_ad',referral_source:'ADS',referral_type:'OPEN_THREAD',meta_ad_id:'120000001',meta_ad_title:'Wedding Films 2027',event_status:'imported',error_message:''},
  {id:'ig-evt-2',org_id:'demo-2',lead_id:'2',event_key:'mid.demo.1002',message_id:'mid.demo.1002',instagram_account_id:'178500000002',sender_id:'178414000002',conversation_id:'conv-1002',message_text:'Can you share your wedding package price?',message_timestamp:new Date(Date.now()-3600000).toISOString(),source:'instagram_message_ad',referral_source:'ADS',referral_type:'OPEN_THREAD',meta_ad_id:'120000002',meta_ad_title:'Premium Wedding Coverage',event_status:'imported',error_message:''},
  {id:'ig-evt-3',org_id:null,lead_id:null,event_key:'mid.demo.1099',message_id:'mid.demo.1099',instagram_account_id:'178599999999',sender_id:'178414099999',conversation_id:'conv-1099',message_text:'Hello',message_timestamp:new Date(Date.now()-7200000).toISOString(),source:'instagram',referral_source:null,referral_type:null,meta_ad_id:null,meta_ad_title:null,event_status:'unmapped',error_message:'No active CRM mapping for this Instagram account'}
];
function phase3IgConnections(){
  if(demoMode)return phase3Load(PHASE3_IG_CONNECTION_KEY,phase3DemoIgConnectionsSeed);
  return sb.from('meta_instagram_connections').select('org_id,instagram_account_id,instagram_username,page_id,page_name,enabled').order('created_at',{ascending:false}).then(({data,error})=>{if(error)throw error;return data||[]});
}
function phase3IgEvents(){
  if(demoMode)return phase3Load(PHASE3_IG_EVENT_KEY,phase3DemoIgEventsSeed);
  return sb.from('instagram_message_events').select('id,org_id,lead_id,event_key,message_id,instagram_account_id,sender_id,conversation_id,message_text,message_timestamp,source,referral_source,referral_type,meta_ad_id,meta_ad_title,event_status,error_message,received_at').order('received_at',{ascending:false}).limit(200).then(({data,error})=>{if(error)throw error;return data||[]});
}
function phase3IgWebhookUrl(){const base=cfg?.url||'';return base?`${base.replace(/\/$/,'')}/functions/v1/instagram-message-webhook`:'Not connected — add Supabase URL first'}
function phase3IgClientOptions(){
  const list=phase3Clients();
  return '<option value="">Select client</option>'+list.map(c=>`<option value="${phase3Attr(c.id)}">${phase3Esc(c.name)}</option>`).join('');
}
function phase3IgLoadForm(orgId){
  const all=window.__phase3IgConnections||[];
  const c=all.find(x=>x.org_id===orgId)||{};
  document.getElementById('phase3IgClient').innerHTML=phase3IgClientOptions();
  if(orgId)document.getElementById('phase3IgClient').value=orgId;
  document.getElementById('phase3IgAccountId').value=c.instagram_account_id||'';
  document.getElementById('phase3IgUsername').value=c.instagram_username||'';
  document.getElementById('phase3IgPageId').value=c.page_id||'';
  document.getElementById('phase3IgPageName').value=c.page_name||'';
  document.getElementById('phase3IgEnabled').checked=c.enabled!==false;
  const canWrite=demoMode||currentProfile?.role==='admin';
  document.getElementById('phase3IgSave').disabled=!canWrite;
}
function phase3IgConnectionTableHTML(rows){
  if(!rows.length)return '<div class="muted">No Instagram account mappings yet.</div>';
  return `<table class="table"><thead><tr><th>Client</th><th>Instagram</th><th>Account ID</th><th>Page</th><th>Status</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${phase3Esc(phase3ClientName(x.org_id))}</td><td>${phase3Esc(x.instagram_username||'—')}</td><td><code>${phase3Esc(x.instagram_account_id)}</code></td><td>${phase3Esc(x.page_name||x.page_id||'—')}</td><td>${x.enabled?'<span class="tag good">enabled</span>':'<span class="tag">disabled</span>'}</td></tr>`).join('')}</tbody></table>`;
}
function phase3IgEventTableHTML(rows){
  if(!rows.length)return '<div class="muted">No Instagram message events yet.</div>';
  return `<table class="table"><thead><tr><th>Received</th><th>Sender</th><th>Client</th><th>Message</th><th>Ad</th><th>Status</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${phase3Date(x.received_at||x.message_timestamp)}</td><td><code>${phase3Esc(x.sender_id||'—')}</code></td><td>${phase3Esc(phase3ClientName(x.org_id))}</td><td class="message-cell">${phase3Esc(x.message_text||'[Attachment]')}</td><td>${x.meta_ad_id?`<code>${phase3Esc(x.meta_ad_id)}</code><br><span class="meta">${phase3Esc(x.meta_ad_title||'Instagram ad')}</span>`:'—'}</td><td>${phase3Tag(x.event_status)}</td></tr>`).join('')}</tbody></table>`;
}
async function phase3IgRender(){
  if(!document.getElementById('phase3InstagramPanel'))return;
  try{
    const [connections,events]=await Promise.all([phase3IgConnections(),phase3IgEvents()]);
    window.__phase3IgConnections=connections;
    const scoped=filters.client==='all'?events:events.filter(x=>x.org_id===filters.client);
    document.getElementById('phase3IgWebhookUrl').textContent=phase3IgWebhookUrl();
    document.getElementById('phase3IgTotal').textContent=scoped.length;
    document.getElementById('phase3IgAttributed').textContent=scoped.filter(x=>x.meta_ad_id||x.referral_source==='ADS').length;
    document.getElementById('phase3IgUnmapped').textContent=scoped.filter(x=>x.event_status==='unmapped').length;
    document.getElementById('phase3IgTable').innerHTML=phase3IgConnectionTableHTML(filters.client==='all'?connections:connections.filter(x=>x.org_id===filters.client));
    document.getElementById('phase3IgEventsTable').innerHTML=phase3IgEventTableHTML(scoped);
    const sel=document.getElementById('phase3IgClient');
    const current=sel?.value||(filters.client!=='all'?filters.client:(phase3Clients()[0]?.id||''));
    phase3IgLoadForm(current);
  }catch(e){
    console.error(e);
    document.getElementById('phase3IgTable').innerHTML=`<div class="muted">Could not load Instagram connections: ${phase3Esc(e.message)}</div>`;
    document.getElementById('phase3IgEventsTable').innerHTML='';
  }
}
async function phase3IgSave(){
  const record={
    org_id:document.getElementById('phase3IgClient').value,
    instagram_account_id:document.getElementById('phase3IgAccountId').value.trim(),
    instagram_username:document.getElementById('phase3IgUsername').value.trim()||null,
    page_id:document.getElementById('phase3IgPageId').value.trim()||null,
    page_name:document.getElementById('phase3IgPageName').value.trim()||null,
    enabled:document.getElementById('phase3IgEnabled').checked,
  };
  if(!record.org_id||!record.instagram_account_id){toast('Client and Instagram Account ID are required');return}
  try{
    if(demoMode){
      const all=phase3Load(PHASE3_IG_CONNECTION_KEY,phase3DemoIgConnectionsSeed);
      const i=all.findIndex(x=>x.org_id===record.org_id);if(i>=0)all[i]={...all[i],...record};else all.unshift(record);phase3Save(PHASE3_IG_CONNECTION_KEY,all);
    }else{
      const {error}=await sb.from('meta_instagram_connections').upsert(record,{onConflict:'org_id'});if(error)throw error;
    }
    toast('Instagram connection saved');await phase3IgRender();
  }catch(e){console.error(e);toast('Could not save Instagram connection: '+e.message)}
}
async function phase3IgCopy(){
  const value=document.getElementById('phase3IgWebhookUrl').textContent;
  if(!value||value.startsWith('Not connected')){toast('Connect Supabase first');return}
  try{await navigator.clipboard.writeText(value);toast('Instagram webhook URL copied')}catch{toast('Copy failed — select the URL manually')}
}
const originalPhase3Render=window.phase3Render;
window.phase3Render=async function(){
  if(originalPhase3Render)await originalPhase3Render();
  await phase3IgRender();
};
function phase3IgBind(){
  const save=document.getElementById('phase3IgSave');if(save)save.addEventListener('click',phase3IgSave);
  const refresh=document.getElementById('phase3IgRefreshBtn');if(refresh)refresh.addEventListener('click',phase3IgRender);
  const copy=document.getElementById('phase3IgCopyWebhook');if(copy)copy.addEventListener('click',phase3IgCopy);
  const client=document.getElementById('phase3IgClient');if(client)client.addEventListener('change',()=>phase3IgLoadForm(client.value));
  window.__phase3IgConnections=[];
  phase3IgRender();
}
phase3IgBind();
