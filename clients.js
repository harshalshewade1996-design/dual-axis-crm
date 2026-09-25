// Dual Axis CRM — Phase 4 client manager
// Admin-only client workspace and login management.
(function(){
  const isAdmin = () => demoMode || currentProfile?.role === 'admin';
  const el = id => document.getElementById(id);
  const esc = v => typeof escapeHtml === 'function' ? escapeHtml(v) : String(v ?? '');
  const attr = v => typeof escapeAttr === 'function' ? escapeAttr(v) : esc(v);

  function hideClientTechnicalViews(){
    const admin = isAdmin();
    document.querySelectorAll('.admin-only-nav,.admin-only-view').forEach(x=>x.classList.toggle('hidden', !admin));
    if(!admin && currentView==='clients') switchView('dashboard');
    const metaNav=document.querySelector('.nav-link[data-view="meta"]');
    if(metaNav) metaNav.classList.toggle('hidden', !admin);
    const metaView=el('metaView');
    if(metaView) metaView.classList.toggle('hidden', currentView!=='meta' || !admin);
  }

  function clientRows(){
    const list = Array.isArray(organizations) ? organizations : [];
    return list.slice().sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
  }

  function clientTableHTML(){
    if(!clientRows().length) return '<div class="muted">No clients yet. Add your first client.</div>';
    return `<table class="table client-table"><thead><tr><th>Client</th><th>Contact</th><th>Email</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>${clientRows().map(c=>{
      const active=c.active!==false;
      return `<tr><td><strong>${esc(c.name)}</strong>${c.id===currentProfile?.org_id?'<div class="meta">Your client workspace</div>':''}</td><td>${esc(c.contact_name||'—')}</td><td>${esc(c.contact_email||'—')}</td><td>${active?'<span class="tag good">Active</span>':'<span class="tag bad">Inactive</span>'}</td><td>${typeof fmtDateTime==='function'?fmtDateTime(c.created_at):'—'}</td><td class="row-actions"><button class="mini-btn edit-client" data-id="${attr(c.id)}">Edit</button>${active?`<button class="mini-btn danger-btn deactivate-client" data-id="${attr(c.id)}">Remove</button>`:`<button class="mini-btn reactivate-client" data-id="${attr(c.id)}">Reactivate</button>`}</td></tr>`;
    }).join('')}</tbody></table>`;
  }

  window.applyRoleVisibility = hideClientTechnicalViews;

  function renderClients(){
    const box=el('clientsTable'); if(box) box.innerHTML=clientTableHTML();
    hideClientTechnicalViews();
  }

  function openClientDialog(org){
    if(!isAdmin())return;
    const d=el('clientDialog');
    el('clientDialogTitle').textContent=org?'Edit client':'Add client';
    el('clientOrgId').value=org?.id||'';
    el('clientBusinessName').value=org?.name||'';
    el('clientContactName').value=org?.contact_name||'';
    el('clientContactEmail').value=org?.contact_email||'';
    el('clientInstagramUsername').value=org?.instagram_username||'';
    el('clientFormHint').innerHTML=org
      ? 'Editing updates the client workspace details. Client leads and Instagram history stay intact.'
      : 'A temporary password will be generated when a new client is created. Share it securely with the client.';
    d.showModal();
  }

  function closeClientDialog(){el('clientDialog')?.close()}

  async function callClientFunction(body){
    if(demoMode){throw new Error('Client management is available after Supabase connection.');}
    const {data,error}=await sb.functions.invoke('admin-manage-client',{body});
    if(error) throw error;
    if(data?.ok===false) throw new Error(data.error||'Client operation failed');
    return data;
  }

  async function saveClient(e){
    e.preventDefault();
    if(!isAdmin())return;
    const id=el('clientOrgId').value;
    const body={
      action:id?'update':'create',
      org_id:id||undefined,
      name:el('clientBusinessName').value.trim(),
      contact_name:el('clientContactName').value.trim()||null,
      contact_email:el('clientContactEmail').value.trim(),
      instagram_username:el('clientInstagramUsername').value.trim()||null
    };
    if(!body.name||!body.contact_email){toast('Business name and login email are required');return}
    try{
      const result=await callClientFunction(body);
      closeClientDialog();
      await getLiveContext();
      await render();
      renderClients();
      if(body.action==='create' && result.email && result.temporary_password){
        const box=el('clientAccessNotice');
        box.classList.remove('hidden');
        box.innerHTML=`<strong>Client created.</strong><br>Login: <code>${esc(result.email)}</code><br>Temporary password: <code>${esc(result.temporary_password)}</code><br><span class="meta">Share these credentials securely. The password is not stored in the CRM.</span>`;
        box.scrollIntoView({behavior:'smooth',block:'nearest'});
      } else {
        toast(body.action==='create'?'Client created':'Client updated');
      }
    }catch(err){console.error(err);toast('Could not save client: '+err.message)}
  }

  async function changeClientState(id,active){
    if(!isAdmin())return;
    const org=clientRows().find(x=>x.id===id);
    if(!org)return;
    const label=active?'reactivate':'remove';
    if(!active && !confirm(`Remove ${org.name} from active client access? Their leads and history will be preserved.`))return;
    try{
      await callClientFunction({action:active?'reactivate':'deactivate',org_id:id});
      await getLiveContext();
      await render();
      renderClients();
      toast(active?'Client reactivated':'Client removed');
    }catch(err){console.error(err);toast(`Could not ${label} client: `+err.message)}
  }

  function bindClients(){
    const add=el('addClientBtn'); if(add)add.addEventListener('click',()=>openClientDialog());
    el('closeClientDialog')?.addEventListener('click',closeClientDialog);
    el('cancelClientBtn')?.addEventListener('click',closeClientDialog);
    el('clientDialog')?.addEventListener('click',e=>{if(e.target.id==='clientDialog')closeClientDialog()});
    el('clientForm')?.addEventListener('submit',saveClient);
    document.addEventListener('click',e=>{
      const edit=e.target.closest('.edit-client'); if(edit){const org=clientRows().find(x=>x.id===edit.dataset.id);if(org)openClientDialog(org);}
      const rem=e.target.closest('.deactivate-client'); if(rem)changeClientState(rem.dataset.id,false);
      const react=e.target.closest('.reactivate-client'); if(react)changeClientState(react.dataset.id,true);
    });
    renderClients();
  }

  const originalRender=window.render;
  if(typeof originalRender==='function'){
    // Keep the existing render behavior and refresh the admin client list after each data render.
    window.render=async function(){const r=await originalRender();renderClients();return r;};
  }

  // Phase 4 is intentionally initialized after the existing CRM scripts.
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindClients);else bindClients();
})();
