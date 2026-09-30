const DEMO_KEY = 'dual_axis_crm_demo_v3';
const DEMO_META_KEY = 'dual_axis_crm_meta_v2';
const cfg = window.SUPABASE_CONFIG || {url:'',anonKey:''};
const supabaseEnabled = Boolean(cfg.url && cfg.anonKey && window.supabase);
let sb = supabaseEnabled ? window.supabase.createClient(cfg.url, cfg.anonKey) : null;
let demoMode = !supabaseEnabled;
let currentUser = null;
let currentProfile = null;
let organizations = [];
let metaConnections = [];
let currentView = 'dashboard';
let filters = { client: 'all', status: 'all', search: '' };
let leadPage=1, followPage=1, pageSize=25, renderVersion=0, searchTimer;
let latestSummary=null;

const demoSeed = [
  {id:'1',org_id:'demo-1',name:'Rahul & Priya',phone:'9820011111',client_name:'Oviegraphy',service:'Wedding Photography',wedding_date:'2027-01-15',location:'Dombivli',budget:75000,status:'Qualified',quality:'Good',followup_date:new Date().toISOString().slice(0,10),source:'Meta Ads',meta_lead_id:'META-10001',notes:'Budget discussed. Needs cinematic film + album.',meta_sync_status:'sent',meta_synced_at:new Date().toISOString()},
  {id:'2',org_id:'demo-2',name:'Sneha Patil',phone:'9897012222',client_name:'Atulya Katha',service:'Wedding Films',wedding_date:'2026-12-05',location:'Mumbai',budget:62000,status:'Meeting',quality:'Good',followup_date:new Date(Date.now()+86400000).toISOString().slice(0,10),source:'Meta Ads',meta_lead_id:'META-10002',notes:'Call completed. Meeting tomorrow.',meta_sync_status:'sent',meta_synced_at:new Date().toISOString()},
  {id:'3',org_id:'demo-1',name:'Akash Joshi',phone:'9763003333',client_name:'Oviegraphy',service:'Engagement',wedding_date:'2026-11-21',location:'Kalyan',budget:45000,booking_value:45000,status:'Won',quality:'Good',followup_date:'',source:'Meta Ads',meta_lead_id:'META-10003',notes:'Booking paid ₹45,000.',meta_sync_status:'sent',meta_synced_at:new Date().toISOString()},
  {id:'4',org_id:'demo-3',name:'Neha & Omkar',phone:'9767004444',client_name:'Cinevision',service:'Wedding Photography',wedding_date:'2027-02-03',location:'Navi Mumbai',budget:90000,status:'Contacted',quality:'Unknown',followup_date:new Date(Date.now()+2*86400000).toISOString().slice(0,10),source:'Instagram',meta_lead_id:'',notes:'No response after first call.'},
  {id:'5',org_id:'demo-3',name:'Pooja Shah',phone:'9988005555',client_name:'Cinevision',service:'Wedding Photography',wedding_date:'2027-03-08',location:'Thane',budget:55000,status:'New',quality:'Unknown',followup_date:new Date().toISOString().slice(0,10),source:'Meta Ads',meta_lead_id:'META-10005',notes:'',meta_sync_status:'queued',meta_synced_at:''},
  {id:'6',org_id:'demo-2',name:'Vivek More',phone:'9819006666',client_name:'Atulya Katha',service:'Wedding Photography',wedding_date:'2027-04-11',location:'Dombivli',budget:70000,status:'Lost',quality:'Bad',followup_date:'',source:'Meta Ads',meta_lead_id:'META-10006',notes:'Budget mismatch.',meta_sync_status:'sent',meta_synced_at:new Date().toISOString()}
];
const demoOrgs = [
  {id:'demo-1',name:'Oviegraphy'},
  {id:'demo-2',name:'Atulya Katha'},
  {id:'demo-3',name:'Cinevision'}
];
const demoMetaSeed = [
  {org_id:'demo-1',dataset_id:'DEMO-DATASET-OVI',source_name:'Oviegraphy CRM',enabled:true},
  {org_id:'demo-2',dataset_id:'DEMO-DATASET-AK',source_name:'Atulya Katha CRM',enabled:true},
  {org_id:'demo-3',dataset_id:'DEMO-DATASET-CINE',source_name:'Cinevision CRM',enabled:false}
];

function loadDemo(){const raw=localStorage.getItem(DEMO_KEY);if(raw)return JSON.parse(raw);localStorage.setItem(DEMO_KEY,JSON.stringify(demoSeed));return demoSeed}
function saveDemo(data){localStorage.setItem(DEMO_KEY,JSON.stringify(data))}
function isInstagramMetaSource(source){return ['Instagram Message Ad','Instagram'].includes(String(source||''))}
function isMetaSource(source){return ['Meta Ads','Instagram Message Ad'].includes(String(source||''))}
function loadDemoMeta(){const raw=localStorage.getItem(DEMO_META_KEY);if(raw)return JSON.parse(raw);localStorage.setItem(DEMO_META_KEY,JSON.stringify(demoMetaSeed));return demoMetaSeed}
function saveDemoMeta(data){localStorage.setItem(DEMO_META_KEY,JSON.stringify(data))}

async function getLiveContext(){
  const {data:profile,error:pErr}=await sb.from('profiles').select('user_id,org_id,role,full_name').eq('user_id',currentUser.id).single();
  if(pErr) throw pErr; currentProfile=profile;
  const {data:orgs,error:oErr}=await sb.from('organizations').select('id,name,active,contact_name,contact_email,instagram_username,created_at').order('name');
  if(oErr) throw oErr; organizations=orgs||[];
  if(currentProfile?.role==='client' && currentProfile.org_id){
    const ownOrg=organizations.find(o=>o.id===currentProfile.org_id);
    if(ownOrg && ownOrg.active===false){
      await sb.auth.signOut();
      currentUser=null;
      currentProfile=null;
      throw new Error('This client account is inactive. Please contact Dual Axis Media.');
    }
  }
  await loadMetaConnections();
}
async function getLead(id){
  if(demoMode)return loadDemo().find(x=>x.id===id);
  const {data,error}=await sb.from('leads').select('*, organizations(name)').eq('id',id).single();
  if(error)throw error;return {...data,client_name:data.organizations?.name||''};
}
async function getLeadPage({page=leadPage,search=filters.search,status=filters.status,size=pageSize,followup=false,due=null}={}){
  if(!demoMode){
    const {data,error}=await sb.rpc('crm_lead_page',{p_org:filters.client==='all'?null:filters.client,p_search:search,p_status:status,p_page:page,p_size:size,p_followup:followup,p_due:due});
    if(error)throw new Error('Could not load leads. '+error.message);return data;
  }
  const scoped=visibleRows(loadDemo()).scoped;
  let rows=scoped.filter(x=>(status==='all'||x.status===status)&&(!search||[x.name,x.phone,x.location,x.client_name,x.service].join(' ').toLowerCase().includes(search.toLowerCase()))&&(!due||x.followup_date===due)&&(!followup||(x.followup_date&&!['Won','Lost','Not qualified'].includes(x.status))));
  if(followup)rows.sort((a,b)=>a.followup_date.localeCompare(b.followup_date));
  size=Math.max(1,Math.min(size,100));page=Math.min(Math.max(1,page),Math.max(1,Math.ceil(rows.length/size)));
  const stages={};scoped.forEach(x=>stages[x.status]=(stages[x.status]||0)+1);
  const won=scoped.filter(x=>x.status==='Won'),events=await getMetaEvents();
  const summary={total:scoped.length,qualified:scoped.filter(x=>['Qualified','Meeting','Won'].includes(x.status)).length,won:won.length,revenue:won.reduce((v,x)=>v+Number(x.booking_value||0),0),booking_value_count:won.filter(x=>x.booking_value!=null).length,missing_booking_value:won.filter(x=>x.booking_value==null).length,meta:scoped.filter(x=>x.meta_lead_id).length,meta_forms:scoped.filter(x=>x.source==='Meta Ads'&&x.meta_lead_id).length,value_tracked:won.filter(x=>x.booking_value!=null).length,stages,sent:events.filter(x=>x.delivery_status==='sent'&&(filters.client==='all'||x.org_id===filters.client)).length,pending:events.filter(x=>x.delivery_status!=='sent'&&(filters.client==='all'||x.org_id===filters.client)).length};
  return {rows:rows.slice((page-1)*size,page*size),count:rows.length,page,size,summary};
}
function renderPager(id,result){
 const pages=Math.max(1,Math.ceil(result.count/result.size)),start=result.count?(result.page-1)*result.size+1:0,end=Math.min(result.page*result.size,result.count);
 document.getElementById(id).innerHTML=`<span role="status">${start}–${end} of ${result.count} · Page ${result.page} of ${pages}</span><div><button class="btn secondary page-button" data-list="${id}" data-page="${result.page-1}" ${result.page<=1?'disabled':''}>Previous</button> <button class="btn secondary page-button" data-list="${id}" data-page="${result.page+1}" ${result.page>=pages?'disabled':''}>Next</button></div>`;
}
async function loadMetaConnections(){
  if(demoMode){metaConnections=loadDemoMeta();return metaConnections;}
  const {data,error}=await sb.from('meta_connections').select('org_id,dataset_id,source_name,enabled').order('org_id');
  if(error) throw error; metaConnections=data||[]; return metaConnections;
}
async function getMetaEvents(){
  if(demoMode){
    return loadDemo().filter(x=>x.meta_lead_id).map((x,i)=>({id:'demo-event-'+x.id,org_id:x.org_id,lead_id:x.id,meta_lead_id:x.meta_lead_id,crm_status:x.status,event_name:eventNameFor(x.status),event_id:'demo-'+x.id+'-'+x.status,event_time:x.meta_synced_at||new Date().toISOString(),delivery_status:x.meta_sync_status||'queued',attempts:x.meta_sync_status==='sent'?1:0,last_attempt_at:x.meta_synced_at||null,error_message:''}));
  }
  const {data,error}=await sb.from('meta_events').select('id,org_id,lead_id,meta_lead_id,crm_status,event_name,event_id,event_time,delivery_status,attempts,last_attempt_at,error_message').order('created_at',{ascending:false}).limit(150);
  if(error)throw error;return data||[];
}
function parseBookingValue(raw){if(String(raw).trim()==='')return null;const value=Number(raw);if(!Number.isFinite(value)||value<0||value>9999999999.99||Math.abs(value*100-Math.round(value*100))>0.0001)throw new Error('Booking value must be a non-negative INR amount with at most two decimals');return value;}
async function saveLead(record){
  record.booking_value=parseBookingValue(record.booking_value??'');
  if(demoMode){const all=loadDemo();const i=all.findIndex(x=>x.id===record.id);if(i>=0)all[i]={...all[i],...record};else{record.id=crypto.randomUUID();all.unshift({...record,meta_sync_status:isMetaSource(record.source)&&((record.meta_lead_id)||(record.meta_ig_user_id))?'queued':'',meta_synced_at:''})}saveDemo(all);return all.find(x=>x.id===record.id)}
  const payload={...record};delete payload.created_at;delete payload.updated_at;delete payload.organizations;delete payload.client_name;delete payload.meta_sync_status;delete payload.meta_synced_at;
  let result;if(record.id)result=await sb.from('leads').update(payload).eq('id',record.id).select().single();else{delete payload.id;result=await sb.from('leads').insert(payload).select().single()}
  if(result.error)throw result.error;return result.data;
}
async function deleteLead(id){if(demoMode){saveDemo(loadDemo().filter(x=>x.id!==id));return}const {error}=await sb.from('leads').delete().eq('id',id);if(error)throw error}
async function saveMetaConnection(record){
  if(!record.org_id||!record.dataset_id)throw new Error('Client and Dataset ID are required');
  if(demoMode){const all=loadDemoMeta();const i=all.findIndex(x=>x.org_id===record.org_id);if(i>=0)all[i]=record;else all.push(record);saveDemoMeta(all);metaConnections=all;return record}
  const {data,error}=await sb.from('meta_connections').upsert(record,{onConflict:'org_id'}).select().single();if(error)throw error;await loadMetaConnections();return data;
}
async function syncLeadToMeta(id){
  const leadForSync=demoMode?loadDemo().find(x=>x.id===id):(await sb.from('leads').select('status').eq('id',id).single()).data;
  if(leadForSync?.status==='Not qualified')throw new Error('Not qualified is a CRM outcome and is not sent as a Meta event');
  if(demoMode){const all=loadDemo();const i=all.findIndex(x=>x.id===id);if(i<0)throw new Error('Lead not found');const lead=all[i];if(lead.source==='Meta Ads'&&!lead.meta_lead_id)throw new Error('This lead is missing a Meta Lead ID');if(isInstagramMetaSource(lead.source)&&!lead.meta_ig_user_id)throw new Error('This Instagram lead is missing its Instagram-scoped user ID');lead.meta_sync_status='sent';lead.meta_synced_at=new Date().toISOString();all[i]=lead;saveDemo(all);return {ok:true,simulated:true,event_name:lead.source==='Meta Ads'?eventNameFor(lead.status):({'New':'LeadSubmitted','Contacted':'LeadSubmitted','Qualified':'QualifiedLead','Won':'Purchase'})[lead.status]||lead.status}}
  const fn=isInstagramMetaSource((await sb.from('leads').select('source').eq('id',id).single()).data?.source)?'meta-business-messaging-event':'meta-crm-event';
  const {data,error}=await sb.functions.invoke(fn,{body:{lead_id:id}});
  if(error)throw error;
  if(data?.ok===false)throw new Error(data.error||'Meta sync failed');
  return data;
}
function eventNameFor(status){return ({New:'lead',Contacted:'contacted',Qualified:'qualified',Meeting:'meeting',Won:'converted',Lost:'lost'})[status]||status.toLowerCase()}
function money(v){return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(Number(v||0))}
function fmtDate(v){if(!v)return '—';return new Date(v+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}
function fmtDateTime(v){if(!v)return '—';return new Date(v).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}
function today(){return new Date().toISOString().slice(0,10)}
function statusTag(s){let c=s==='Won'||s==='Qualified'?'good':['Lost','Not qualified'].includes(s)?'bad':s==='Meeting'?'warn':'';return `<span class="tag ${c}">${escapeHtml(s)}</span>`}
function deliveryTag(s){let c=s==='sent'?'good':s==='failed'?'bad':s==='queued'?'warn':'';return `<span class="tag ${c}">${escapeHtml(s||'queued')}</span>`}
function toast(msg){const el=document.getElementById('toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2200)}
function escapeHtml(s){return String(s??'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]))}
function escapeAttr(s){return escapeHtml(s).replace(/`/g,'&#96;')}
function visibleRows(all){
  const scoped=filters.client==='all'?all:all.filter(x=>x.org_id===filters.client||x.client_name===filters.client);
  return {scoped,searched:scoped.filter(x=>{const q=filters.search.toLowerCase();return !q||[x.name,x.phone,x.location,x.client_name,x.service].some(v=>String(v||'').toLowerCase().includes(q))}).filter(x=>filters.status==='all'||x.status===filters.status)};
}
function clientList(){return (demoMode?demoOrgs:organizations).filter(o=>o.active!==false)}
function fillClientOptions(selected=''){
  const sel=document.getElementById('clientName');const list=clientList();sel.innerHTML='<option value="">Select client</option>'+list.map(o=>`<option value="${escapeAttr(o.id)}">${escapeHtml(o.name)}</option>`).join('');if(selected)sel.value=selected;if(demoMode&&!selected&&filters.client!=='all')sel.value=filters.client;
}
function updateClientFilter(){
  const sel=document.getElementById('clientFilter');const list=clientList();sel.innerHTML='<option value="all">All clients</option>'+list.map(o=>`<option value="${escapeAttr(o.id)}">${escapeHtml(o.name)}</option>`).join('');sel.value=filters.client;fillClientOptions(document.getElementById('clientName').value);
  const isClient=currentProfile?.role==='client';sel.disabled=isClient;sel.classList.toggle('hidden',isClient);
}
function clientNameById(id){return clientList().find(o=>o.id===id)?.name||''}
function connectionForOrg(orgId){return metaConnections.find(x=>x.org_id===orgId)||null}

async function render(){
 const version=++renderVersion;
 document.getElementById('leadsTable').setAttribute('aria-busy','true');
 try{
 const [page,recent,follow,due,events]=await Promise.all([getLeadPage(),getLeadPage({page:1,search:'',status:'all',size:8}),getLeadPage({page:followPage,search:'',status:'all',followup:true}),getLeadPage({page:1,search:'',status:'all',size:5,followup:true,due:today()}),getMetaEvents()]);
 if(version!==renderVersion)return;
 leadPage=page.page;followPage=follow.page;latestSummary=page.summary;
 const m=page.summary,total=Number(m.total),qualified=Number(m.qualified),won=Number(m.won),revenue=Number(m.revenue),meta=Number(m.meta);
 document.getElementById('metricLeads').textContent=total;document.getElementById('metricQualified').textContent=qualified;document.getElementById('metricBookings').textContent=won;document.getElementById('metricRevenue').textContent=money(revenue);
 document.getElementById('missingBookingValue').textContent=m.missing_booking_value||0;document.getElementById('avgDeal').textContent=money(m.booking_value_count?revenue/m.booking_value_count:0);document.getElementById('qualRate').textContent=total?Math.round(qualified/total*100)+'%':'0%';document.getElementById('bookingRate').textContent=total?Math.round(won/total*100)+'%':'0%';
 document.getElementById('metaTagged').textContent=meta;document.getElementById('readyMetaId').textContent=total?Math.round(meta/total*100)+'%':'0%';document.getElementById('readyQualified').textContent=total?Math.round(qualified/total*100)+'%':'0%';document.getElementById('readyValue').textContent=won?Math.round(m.value_tracked/won*100)+'%':'0%';document.getElementById('readyEvents').textContent=m.sent;
 const stages=['New','Contacted','Qualified','Meeting','Won','Lost','Not qualified'];document.getElementById('pipeline').innerHTML=stages.map(s=>`<div class="pipe"><span>${s}</span><strong>${m.stages[s]||0}</strong></div>`).join('');
 document.getElementById('todayFollowups').innerHTML=due.rows.length?due.rows.map(x=>`<div class="list-item"><div><strong>${escapeHtml(x.name)}</strong><div class="meta">${escapeHtml(x.client_name||'')} · ${escapeHtml(x.phone)}</div></div>${statusTag(x.status)}</div>`).join(''):'<div class="muted">No follow-ups due today.</div>';
 document.getElementById('recentLeads').innerHTML=tableHTML(recent.rows);document.getElementById('leadsTable').innerHTML=tableHTML(page.rows);renderPager('leadPager',page);
 document.getElementById('followupsList').innerHTML=follow.rows.length?follow.rows.map(x=>`<div class="follow-item"><div class="follow-left"><button class="clickable edit-lead" data-id="${escapeAttr(x.id)}">${escapeHtml(x.name)}</button><div class="meta">${escapeHtml(x.client_name||'')} · ${escapeHtml(x.phone)} · ${escapeHtml(x.location||'')}</div></div><div class="follow-right"><strong>${fmtDate(x.followup_date)}</strong>${statusTag(x.status)}</div></div>`).join(''):'<div class="muted">No pending follow-ups.</div>';renderPager('followPager',follow);
 await renderMetaPage(page.rows,[...recent.rows,...page.rows,...follow.rows],events);
 updateClientFilter();if(window.phase3Render)await window.phase3Render();
 }catch(error){if(version===renderVersion){document.getElementById('leadsTable').innerHTML=`<div role="alert">${escapeHtml(error.message)}</div>`;document.getElementById('leadPager').innerHTML='';toast(error.message);}}finally{if(version===renderVersion)document.getElementById('leadsTable').setAttribute('aria-busy','false');}
}
function tableHTML(rows){
  if(!rows.length)return '<div class="muted">No leads found.</div>';
  return `<table class="table"><thead><tr><th>Name</th><th>Client</th><th>Service</th><th>Budget</th><th>Booking value</th><th>Status</th><th>Follow-up</th><th>Source</th><th>Meta</th><th></th></tr></thead><tbody>${rows.map(x=>`<tr><td><button class="clickable edit-lead" data-id="${escapeAttr(x.id)}">${escapeHtml(x.name)}</button><div class="meta">${escapeHtml(x.phone)}</div></td><td>${escapeHtml(x.client_name||'—')}</td><td>${escapeHtml(x.service||'—')}</td><td>${money(x.budget)}</td><td>${x.booking_value==null?'—':money(x.booking_value)}</td><td>${statusTag(x.status)}</td><td>${fmtDate(x.followup_date)}</td><td>${escapeHtml(x.source||'—')}</td><td>${x.meta_lead_id||x.meta_ig_user_id?deliveryTag(x.meta_sync_status||'queued'):'—'}</td><td class="row-actions">${x.status==='Not qualified'?'':`<button class="mini-btn sync-lead" data-id="${escapeAttr(x.id)}">Sync</button>`}<button class="mini-btn delete-lead" data-id="${escapeAttr(x.id)}">Delete</button></td></tr>`).join('')}</tbody></table>`;
}
async function renderMetaPage(scoped,all,events){
  const metaLeads=scoped.filter(x=>x.source==='Meta Ads'&&x.meta_lead_id);const scopedEvents=events.filter(x=>filters.client==='all'||x.org_id===filters.client);const sent=scopedEvents.filter(x=>x.delivery_status==='sent').length;const pending=scopedEvents.filter(x=>x.delivery_status!=='sent').length;const latest=scopedEvents.find(x=>x.last_attempt_at)||scopedEvents.find(x=>x.event_time);
  document.getElementById('metaPageTagged').textContent=latestSummary?.meta_forms??metaLeads.length;document.getElementById('metaSent').textContent=latestSummary?.sent??sent;document.getElementById('metaPending').textContent=latestSummary?.pending??pending;document.getElementById('metaLastSync').textContent=latest?fmtDateTime(latest.last_attempt_at||latest.event_time):'—';
  const sel=document.getElementById('metaClientSelect');const list=clientList();const keep=sel.value|| (filters.client!=='all'?filters.client:list[0]?.id||'');sel.innerHTML=list.map(o=>`<option value="${escapeAttr(o.id)}">${escapeHtml(o.name)}</option>`).join('');if(keep)sel.value=keep;loadMetaConnectionForm(sel.value);
  document.getElementById('metaEventsTable').innerHTML=metaEventsHTML(scopedEvents,all);
  const c=connectionForOrg(sel.value);document.getElementById('metaConnectionStatus').innerHTML=c&&c.dataset_id?`<span class="status-dot ${c.enabled?'live':'off'}"></span>${c.enabled?'Connection configured':'Connection disabled'} · ${escapeHtml(c.dataset_id)}`:'<span class="status-dot off"></span>No dataset connected yet';
}
function loadMetaConnectionForm(orgId){const c=connectionForOrg(orgId)||{};document.getElementById('metaDatasetId').value=c.dataset_id||'';document.getElementById('metaSourceName').value=c.source_name||clientNameById(orgId)||'Dual Axis Media CRM';document.getElementById('metaEnabled').checked=c.enabled!==false;const canWrite=currentProfile?.role==='admin'||demoMode;document.getElementById('saveMetaConnectionBtn').disabled=!canWrite}
function metaEventsHTML(events,all){
  if(!events.length)return '<div class="muted">No Meta sync events recorded yet.</div>';
  const nameById=new Map(all.map(x=>[x.id,x.name]));return `<table class="table"><thead><tr><th>Lead</th><th>Client</th><th>CRM status</th><th>Event</th><th>Delivery</th><th>Attempts</th><th>Last attempt</th><th>Error</th></tr></thead><tbody>${events.map(x=>`<tr><td>${escapeHtml(nameById.get(x.lead_id)||x.meta_lead_id||'—')}</td><td>${escapeHtml(clientNameById(x.org_id)||'—')}</td><td>${statusTag(x.crm_status)}</td><td><code>${escapeHtml(x.event_name)}</code></td><td>${deliveryTag(x.delivery_status)}</td><td>${Number(x.attempts||0)}</td><td>${fmtDateTime(x.last_attempt_at||x.event_time)}</td><td class="error-cell">${escapeHtml(x.error_message||'—')}</td></tr>`).join('')}</tbody></table>`;
}
function switchView(v){currentView=v;document.querySelectorAll('.nav-link').forEach(b=>b.classList.toggle('active',b.dataset.view===v));document.querySelectorAll('.view').forEach(el=>el.classList.add('hidden'));document.getElementById(v+'View').classList.remove('hidden');document.getElementById('pageTitle').textContent=v[0].toUpperCase()+v.slice(1)}
function openDialog(lead){
  const d=document.getElementById('leadDialog');document.getElementById('dialogTitle').textContent=lead?'Edit lead':'Add lead';document.getElementById('leadId').value=lead?.id||'';document.getElementById('name').value=lead?.name||'';document.getElementById('phone').value=lead?.phone||'';document.getElementById('email').value=lead?.email||'';document.getElementById('service').value=lead?.service||'Wedding Photography';document.getElementById('weddingDate').value=lead?.wedding_date||'';document.getElementById('location').value=lead?.location||'';document.getElementById('budget').value=lead?.budget??'';document.getElementById('bookingValue').value=lead?.booking_value??'';document.getElementById('status').value=lead?.status||'New';document.getElementById('quality').value=lead?.quality||'Unknown';document.getElementById('followupDate').value=lead?.followup_date||today();document.getElementById('source').value=lead?.source||'Instagram Message Ad';document.getElementById('metaLeadId').value=lead?.meta_lead_id||'';document.getElementById('metaIgUserId').value=lead?.meta_ig_user_id||'';document.getElementById('metaIgAccountId').value=lead?.meta_instagram_account_id||'';document.getElementById('instagramUsername').value=lead?.instagram_username||'';document.getElementById('notes').value=lead?.notes||'';fillClientOptions(lead?.org_id||(filters.client!=='all'?filters.client:''));d.showModal();
}
function closeDialog(){document.getElementById('leadDialog').close()}
async function editById(id){const lead=await getLead(id);if(lead)openDialog(lead)}
async function deleteById(id){if(!confirm('Delete this lead?'))return;await deleteLead(id);toast('Lead deleted');await render()}
async function syncById(id){try{const result=await syncLeadToMeta(id);toast(result?.simulated?'Demo Meta sync recorded':(result?.duplicate?'Already synced':'Sent to Meta'));await render()}catch(e){console.error(e);toast('Meta sync failed: '+e.message);await render()}}
async function syncPending(){
 let page=1,ok=0,total=0;
 do{const result=await getLeadPage({page,search:'',status:'all',size:100});for(const x of result.rows){if(x.status==='Not qualified'||!(x.source==='Meta Ads'&&x.meta_lead_id||isInstagramMetaSource(x.source)&&x.meta_ig_user_id)||x.meta_sync_status==='sent')continue;total++;try{await syncLeadToMeta(x.id);ok++;}catch(e){console.error(e);}}if(page*result.size>=result.count)break;page++;}while(true);
 toast(`Synced ${ok} of ${total} pending leads`);await render();
}
async function initLiveSession(){const {data,error}=await sb.auth.getSession();if(error)throw error;if(data.session){currentUser=data.session.user;await getLiveContext();showApp(true)}else showApp(false)}
function bind(){
  document.querySelectorAll('.nav-link').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));document.querySelectorAll('[data-view-jump]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.viewJump)));
  document.getElementById('addLeadBtn').addEventListener('click',()=>openDialog());document.getElementById('closeDialog').addEventListener('click',closeDialog);document.getElementById('cancelBtn').addEventListener('click',closeDialog);document.getElementById('leadDialog').addEventListener('click',e=>{if(e.target.id==='leadDialog')closeDialog()});
  document.getElementById('leadForm').addEventListener('submit',async e=>{e.preventDefault();const id=document.getElementById('leadId').value;const before=id?await getLead(id):null;const clientOrgId=document.getElementById('clientName').value;if(!clientOrgId){toast('Please select a client');return}const record={id:id||undefined,org_id:clientOrgId,name:document.getElementById('name').value.trim(),phone:document.getElementById('phone').value.trim(),email:document.getElementById('email').value.trim()||null,service:document.getElementById('service').value,wedding_date:document.getElementById('weddingDate').value||null,location:document.getElementById('location').value.trim(),booking_value:document.getElementById('bookingValue').value,budget:Number(document.getElementById('budget').value||0),status:document.getElementById('status').value,quality:document.getElementById('quality').value,followup_date:document.getElementById('followupDate').value||null,source:document.getElementById('source').value,meta_lead_id:document.getElementById('metaLeadId').value.trim()||null,meta_ig_user_id:document.getElementById('metaIgUserId')?.value.trim()||null,meta_instagram_account_id:document.getElementById('metaIgAccountId')?.value.trim()||null,instagram_username:document.getElementById('instagramUsername')?.value.trim()||null,notes:document.getElementById('notes').value.trim()};try{const saved=await saveLead(record);closeDialog();toast(id?'Lead updated':'Lead added');const needsSync=record.status!=='Not qualified'&&(record.source==='Meta Ads'&&record.meta_lead_id||isInstagramMetaSource(record.source)&&record.meta_ig_user_id)&&(!before||before.status!==record.status||before.meta_lead_id!==record.meta_lead_id||before.meta_ig_user_id!==record.meta_ig_user_id);if(needsSync){try{await syncLeadToMeta(saved.id);toast('Lead saved + Meta feedback sent')}catch(syncErr){console.warn(syncErr);toast('Lead saved; Meta sync needs retry')}}await render()}catch(err){console.error(err);toast('Could not save lead: '+err.message)}});
  document.getElementById('leadSearch').addEventListener('input',e=>{filters.search=e.target.value;leadPage=1;renderVersion++;clearTimeout(searchTimer);searchTimer=setTimeout(()=>render(),300)});
  document.getElementById('statusFilter').addEventListener('change',e=>{filters.status=e.target.value;leadPage=1;render()});
  document.getElementById('clientFilter').addEventListener('change',e=>{filters.client=e.target.value;leadPage=followPage=1;render()});
  document.getElementById('leadPageSize').addEventListener('change',e=>{pageSize=Number(e.target.value);leadPage=followPage=1;render()});
  document.addEventListener('click',e=>{const button=e.target.closest('.page-button');if(!button||button.disabled)return;if(button.dataset.list==='leadPager')leadPage=Number(button.dataset.page);else followPage=Number(button.dataset.page);render()});
  document.getElementById('todayBtn').addEventListener('click',()=>{switchView('followups');toast('Showing the follow-up queue')});
  document.getElementById('metaClientSelect').addEventListener('change',e=>{loadMetaConnectionForm(e.target.value);const c=connectionForOrg(e.target.value);document.getElementById('metaConnectionStatus').innerHTML=c&&c.dataset_id?`<span class="status-dot ${c.enabled?'live':'off'}"></span>${c.enabled?'Connection configured':'Connection disabled'} · ${escapeHtml(c.dataset_id)}`:'<span class="status-dot off"></span>No dataset connected yet'});
  document.getElementById('saveMetaConnectionBtn').addEventListener('click',async()=>{const record={org_id:document.getElementById('metaClientSelect').value,dataset_id:document.getElementById('metaDatasetId').value.trim(),source_name:document.getElementById('metaSourceName').value.trim()||'Dual Axis Media CRM',enabled:document.getElementById('metaEnabled').checked};try{await saveMetaConnection(record);toast('Meta connection saved');await render()}catch(e){console.error(e);toast('Could not save connection: '+e.message)}});
  document.getElementById('syncAllBtn').addEventListener('click',syncPending);
  document.addEventListener('click',e=>{const ed=e.target.closest('.edit-lead');if(ed)editById(ed.dataset.id);const del=e.target.closest('.delete-lead');if(del)deleteById(del.dataset.id);const sy=e.target.closest('.sync-lead');if(sy)syncById(sy.dataset.id)});
  document.getElementById('logoutBtn').addEventListener('click',async()=>{if(!demoMode&&sb)await sb.auth.signOut();currentUser=null;showApp(false)});
  document.getElementById('loginForm').addEventListener('submit',async e=>{e.preventDefault();if(demoMode){showApp(true);return}const email=document.getElementById('loginEmail').value,password=document.getElementById('loginPassword').value;const {data,error}=await sb.auth.signInWithPassword({email,password});if(error){toast(error.message);return}currentUser=data.user;await getLiveContext();showApp(true)});
}
function showApp(show){document.getElementById('appView').classList.toggle('hidden',!show);document.getElementById('loginView').classList.toggle('hidden',show);if(window.applyRoleVisibility)window.applyRoleVisibility();if(show){document.getElementById('modePill').textContent=demoMode?'Demo mode':(currentProfile?.role==='admin'?'Admin':'Client');render().catch(e=>{console.error(e);toast(e.message)})}}
async function init(){bind();if(demoMode)showApp(true);else try{await initLiveSession()}catch(e){console.error(e);showApp(false);toast('Supabase connection error: '+e.message)}}
init();
