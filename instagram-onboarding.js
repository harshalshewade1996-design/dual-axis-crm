// Admin-led OAuth links. Tokens never enter the browser or localStorage.
let igReviewSession=null,igOnboardingVersion=0,igOnboardingBusy=false;
function igSelectedClient(){return document.getElementById('phase3IgClient').value;}
function igResetReview(){
  igReviewSession=null;
  document.getElementById('igConfirmAccount').hidden=true;
  document.getElementById('igLinkLabel').hidden=true;
  document.getElementById('igCopyLink').hidden=true;
  document.getElementById('igAuthorizationLink').value='';
}
async function igOnboardingRequest(action,orgId,extra={}){
  if(demoMode)throw new Error('Connect Supabase to authorize a real Instagram account.');
  const {data,error}=await sb.functions.invoke('instagram-onboarding',{body:{action,org_id:orgId,...extra}});
  if(error){let detail;try{detail=await error.context?.json();}catch{}throw new Error(detail?.error||'Instagram onboarding is not available yet.');}
  if(data?.error)throw new Error(data.error);
  return data;
}
async function igCheckAuthorization(){
  const orgId=igSelectedClient(),request=++igOnboardingVersion;
  igReviewSession=null;document.getElementById('igConfirmAccount').hidden=true;
  document.getElementById('igRefreshToken').hidden=true;
  if(!orgId)return;
  const status=document.getElementById('igAuthorizationStatus');status.textContent='Checking authorization…';
  try{
    const data=await igOnboardingRequest('status',orgId);
    if(request!==igOnboardingVersion||orgId!==igSelectedClient())return;
    const session=data.session,connection=data.connection;
    if(session?.status==='authorized'&&Date.parse(session.expires_at)>Date.now()){
      igReviewSession={...session,org_id:orgId};
      status.textContent=`Ready to connect @${session.instagram_username} (${session.instagram_account_id}) to ${phase3ClientName(orgId)}. Confirm this is the correct account.`;
      document.getElementById('igConfirmAccount').hidden=false;
    }else if(connection){
      const expired=Date.parse(connection.expires_at)<=Date.now();
      status.textContent=expired?'Authorization expired. Create a new connection link.':`Account authorized until ${new Date(connection.expires_at).toLocaleDateString('en-IN')}. Refresh authorization before it expires.`;
      document.getElementById('igRefreshToken').hidden=expired;
    }else if(!data.configured){status.textContent='Instagram onboarding needs app configuration. Existing manual mappings still work.';}
    else if(session?.status==='awaiting'&&Date.parse(session.expires_at)>Date.now()){status.textContent='Waiting for the client to authorize Instagram. Check again after they finish.';}
    else{status.textContent='Create a new connection link for this client.';}
  }catch(e){if(request===igOnboardingVersion)status.textContent=e.message;}
}
async function igOnboardingAction(action){
  if(igOnboardingBusy)return;
  const orgId=igSelectedClient();if(!orgId){toast('Select a client first');return;}
  const review=igReviewSession;
  if(action==='activate'&&review?.org_id!==orgId){toast('Check authorization again');return;}
  igOnboardingBusy=true;
  const buttons=['igCreateLink','igCheckAuthorization','igConfirmAccount','igRefreshToken'];buttons.forEach(id=>document.getElementById(id).disabled=true);
  try{
    const data=await igOnboardingRequest(action,orgId,action==='activate'?{session_id:review.id}:{});
    if(orgId!==igSelectedClient())return;
    if(action==='start'){
      igResetReview();document.getElementById('igAuthorizationLink').value=data.url;
      document.getElementById('igLinkLabel').hidden=false;document.getElementById('igCopyLink').hidden=false;
      document.getElementById('igAuthorizationStatus').textContent='Share this link with the Instagram account owner. It expires in 30 minutes.';
    }else{toast(action==='activate'?'Client Instagram connected':'Instagram authorization refreshed');await phase3IgRender();await igCheckAuthorization();}
  }catch(e){document.getElementById('igAuthorizationStatus').textContent=e.message;}
  finally{igOnboardingBusy=false;buttons.forEach(id=>document.getElementById(id).disabled=false);}
}
function igOnboardingVisibility(){
  document.getElementById('igOnboardingPanel').hidden=!(demoMode||currentProfile?.role==='admin');
}
const igPreviousRender=window.phase3Render;
window.phase3Render=async function(){await igPreviousRender();igOnboardingVisibility();};
document.getElementById('phase3IgClient').addEventListener('change',()=>{++igOnboardingVersion;igResetReview();igCheckAuthorization();});
document.getElementById('igCreateLink').addEventListener('click',()=>igOnboardingAction('start'));
document.getElementById('igCheckAuthorization').addEventListener('click',igCheckAuthorization);
document.getElementById('igConfirmAccount').addEventListener('click',()=>igOnboardingAction('activate'));
document.getElementById('igRefreshToken').addEventListener('click',()=>igOnboardingAction('refresh'));
document.getElementById('igCopyLink').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(document.getElementById('igAuthorizationLink').value);toast('Connection link copied');}catch{toast('Select and copy the link manually');}});
igOnboardingVisibility();
