import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
const metaToken = Deno.env.get('META_ACCESS_TOKEN') || '';
const metaApiVersion = Deno.env.get('META_API_VERSION') || 'v26.0';
const defaultDatasetId = Deno.env.get('META_DEFAULT_DATASET_ID') || '';
const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

const eventMap: Record<string, string> = {
  New: 'LeadSubmitted',
  Contacted: 'LeadSubmitted',
  Qualified: 'QualifiedLead',
  Won: 'Purchase',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function getBearer(req: Request) {
  const h = req.headers.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

async function hash(value: string) {
  const normalized = value.trim().toLowerCase();
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function stableEventId(leadId: string, eventName: string, updatedAt: string) {
  return hash(`${leadId}:${eventName}:${updatedAt}`);
}

async function processLead(leadId: string) {
  const { data: lead, error } = await admin.from('leads').select(
    'id,org_id,name,phone,email,source,status,budget,meta_ig_user_id,meta_instagram_account_id,last_inbound_at,updated_at'
  ).eq('id', leadId).single();
  if (error || !lead) throw new Error('Lead not found');

  if (String(lead.source) !== 'Instagram Message Ad') {
    return { skipped: true, reason: 'not_instagram_source' };
  }
  if (!lead.meta_ig_user_id || !lead.meta_instagram_account_id) {
    return { skipped: true, reason: 'missing_ig_identifiers' };
  }
  if (lead.status === 'Lost') return { skipped: true, reason: 'lost_lead' };

  const { data: connection } = await admin.from('meta_connections')
    .select('dataset_id,source_name,enabled')
    .eq('org_id', lead.org_id).maybeSingle();
  const datasetId = connection?.dataset_id || defaultDatasetId;
  if (!datasetId) return { skipped: true, reason: 'missing_dataset_id' };
  if (connection && !connection.enabled) return { skipped: true, reason: 'connection_disabled' };
  if (!metaToken) throw new Error('META_ACCESS_TOKEN secret is not configured');

  const eventName = eventMap[String(lead.status)];
  if (!eventName) return { skipped: true, reason: 'status_not_mapped' };

  const eventTimeSource = lead.updated_at || lead.last_inbound_at || new Date().toISOString();
  const eventTime = Math.floor(new Date(eventTimeSource).getTime() / 1000);
  const eventId = await stableEventId(lead.id, eventName, eventTimeSource);
  const value = Number(lead.budget || 0);

  const { data: existing } = await admin.from('instagram_meta_events')
    .select('id,delivery_status,attempts')
    .eq('event_id', eventId).maybeSingle();
  if (existing?.delivery_status === 'sent') return { sent: true, duplicate: true, event_id: eventId, event_name: eventName };

  await admin.from('instagram_meta_events').upsert({
    org_id: lead.org_id,
    lead_id: lead.id,
    ig_sid: lead.meta_ig_user_id,
    ig_account_id: lead.meta_instagram_account_id,
    crm_status: lead.status,
    event_name: eventName,
    event_id: eventId,
    event_time: new Date(eventTimeSource).toISOString(),
    value: lead.status === 'Won' && value > 0 ? value : null,
    currency: lead.status === 'Won' && value > 0 ? 'INR' : null,
    delivery_status: 'queued',
    error_message: null,
  }, { onConflict: 'event_id' });

  const userData: Record<string, unknown> = {
    ig_sid: lead.meta_ig_user_id,
    ig_account_id: lead.meta_instagram_account_id,
  };
  if (lead.phone && lead.phone !== 'Not provided') userData.ph = [await hash(lead.phone.replace(/\D/g, ''))];
  if (lead.email) userData.em = [await hash(lead.email)];
  if (lead.name) userData.external_id = [await hash(`${lead.org_id}:${lead.id}`)];

  const payload = {
    data: [{
      event_name: eventName,
      event_time: eventTime,
      event_id: eventId,
      action_source: 'business_messaging',
      messaging_channel: 'instagram',
      user_data: userData,
      custom_data: {
        lead_event_source: connection?.source_name || 'Dual Axis Media CRM',
        crm_status: lead.status,
        ...(lead.status === 'Won' && value > 0 ? { value, currency: 'INR' } : {}),
      },
    }],
  };

  const endpoint = `https://graph.facebook.com/${metaApiVersion}/${encodeURIComponent(datasetId)}/events?access_token=${encodeURIComponent(metaToken)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const responseJson = await response.json().catch(() => ({}));

  await admin.from('instagram_meta_events').update({
    delivery_status: response.ok ? 'sent' : 'failed',
    attempts: (existing?.attempts || 0) + 1,
    last_attempt_at: new Date().toISOString(),
    response_json: responseJson,
    error_message: response.ok ? null : JSON.stringify(responseJson),
  }).eq('event_id', eventId);

  if (!response.ok) throw new Error(`Meta API error (${response.status}): ${JSON.stringify(responseJson)}`);
  return { sent: true, event_id: eventId, event_name: eventName, meta: responseJson };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return json({ ok: true, service: 'meta-business-messaging-event' });
    const bearer = getBearer(req);
    if (!bearer || !supabaseAnonKey) return json({ error: 'Unauthorized' }, 401);
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser(bearer);
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);

    const { data: profile } = await admin.from('profiles').select('org_id,role').eq('user_id', user.id).single();
    if (!profile) return json({ error: 'Profile not found' }, 403);
    const body = await req.json();
    const leadId = String(body.lead_id || '');
    if (!leadId) return json({ error: 'lead_id is required' }, 400);

    if (profile.role !== 'admin') {
      const { data: organization, error: orgError } = await admin.from('organizations')
        .select('active').eq('id', profile.org_id).maybeSingle();
      if (orgError || organization?.active !== true) return json({ error: 'Client account inactive' }, 403);
      const { data: lead } = await admin.from('leads').select('org_id').eq('id', leadId).single();
      if (!lead || lead.org_id !== profile.org_id) return json({ error: 'Forbidden' }, 403);
    }

    return json({ ok: true, ...(await processLead(leadId)) });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
