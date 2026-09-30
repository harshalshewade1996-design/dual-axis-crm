import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const metaToken = Deno.env.get('META_ACCESS_TOKEN')!;
const metaApiVersion = Deno.env.get('META_API_VERSION') || '';
const defaultDatasetId = Deno.env.get('META_DEFAULT_DATASET_ID') || '';

const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

const allowedStatuses = new Set(['New','Contacted','Qualified','Meeting','Won','Lost']);
const eventMap: Record<string, string> = {
  New: 'lead',
  Contacted: 'contacted',
  Qualified: 'qualified',
  Meeting: 'meeting',
  Won: 'converted',
  Lost: 'lost',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function getBearer(req: Request) {
  const h = req.headers.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

function cryptoHash(value: string) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)).then((buf) =>
    Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
  );
}

async function processEvent(leadId: string) {
  const { data: lead, error: leadError } = await admin
    .from('leads')
    .select('id,org_id,name,source,status,booking_value,meta_lead_id,updated_at')
    .eq('id', leadId)
    .single();
  if (leadError || !lead) throw new Error('Lead not found');

  if (lead.source !== 'Meta Ads') return { skipped: true, reason: 'not_meta_source' };
  if (!lead.meta_lead_id) return { skipped: true, reason: 'missing_meta_lead_id' };
  if (!allowedStatuses.has(lead.status)) return { skipped: true, reason: 'unsupported_status' };

  const { data: connection } = await admin
    .from('meta_connections')
    .select('dataset_id,source_name,enabled')
    .eq('org_id', lead.org_id)
    .maybeSingle();

  const datasetId = connection?.dataset_id || defaultDatasetId;
  if (!datasetId) return { skipped: true, reason: 'missing_dataset_id' };
  if (connection && !connection.enabled) return { skipped: true, reason: 'connection_disabled' };
  if (!metaToken) throw new Error('META_ACCESS_TOKEN secret is not configured');
  if (!metaApiVersion) throw new Error('META_API_VERSION secret is not configured');

  const eventName = eventMap[lead.status];
  const eventTime = Math.floor(new Date(lead.updated_at).getTime() / 1000);
  const eventId = await cryptoHash(`${lead.id}:${lead.status}:${lead.updated_at}`);
  const value = Number(lead.booking_value || 0);
  const customData: Record<string, unknown> = {
    lead_event_source: connection?.source_name || 'Dual Axis Media CRM',
    event_source: 'crm',
    crm_status: lead.status,
  };
  if (lead.status === 'Won' && value > 0) {
    customData.value = value;
    customData.currency = 'INR';
  }

  const { data: existing } = await admin
    .from('meta_events')
    .select('id,delivery_status,attempts')
    .eq('event_id', eventId)
    .maybeSingle();

  if (existing?.delivery_status === 'sent') return { sent: true, duplicate: true, event_id: eventId };

  await admin.from('meta_events').upsert({
    org_id: lead.org_id,
    lead_id: lead.id,
    meta_lead_id: lead.meta_lead_id,
    crm_status: lead.status,
    event_name: eventName,
    event_id: eventId,
    event_time: new Date(lead.updated_at).toISOString(),
    value: lead.status === 'Won' && value > 0 ? value : null,
    currency: lead.status === 'Won' && value > 0 ? 'INR' : null,
    delivery_status: 'queued',
    error_message: null,
  }, { onConflict: 'event_id' });

  const endpoint = `https://graph.facebook.com/${metaApiVersion}/${encodeURIComponent(datasetId)}/events?access_token=${encodeURIComponent(metaToken)}`;
  const payload = {
    data: [{
      event_name: eventName,
      event_time: eventTime,
      event_id: eventId,
      action_source: 'system_generated',
      user_data: { lead_id: lead.meta_lead_id },
      custom_data: customData,
    }],
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const responseJson = await response.json().catch(() => ({}));
  await admin.from('meta_events').update({
    delivery_status: response.ok ? 'sent' : 'failed',
    attempts: (existing?.attempts || 0) + 1,
    last_attempt_at: new Date().toISOString(),
    response_json: responseJson,
    error_message: response.ok ? null : JSON.stringify(responseJson),
  }).eq('event_id', eventId);

  if (!response.ok) {
    throw new Error(`Meta API error (${response.status}): ${JSON.stringify(responseJson)}`);
  }

  return { sent: true, event_id: eventId, event_name: eventName, meta: responseJson };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return json({ ok: true, service: 'meta-crm-event' });
    const token = getBearer(req);
    if (!token) return json({ error: 'Missing authorization' }, 401);

    if (!supabaseAnonKey) return json({ error: 'SUPABASE_ANON_KEY secret is not configured' }, 500);
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser(token);
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);

    const body = await req.json();
    const leadId = String(body.lead_id || '');
    if (!leadId) return json({ error: 'lead_id is required' }, 400);

    const { data: profile } = await admin.from('profiles').select('org_id,role').eq('user_id', user.id).single();
    if (!profile) return json({ error: 'Profile not found' }, 403);

    if (profile.role !== 'admin') {
      const { data: organization, error: orgError } = await admin.from('organizations')
        .select('active').eq('id', profile.org_id).maybeSingle();
      if (orgError || organization?.active !== true) return json({ error: 'Client account inactive' }, 403);
      const { data: lead } = await admin.from('leads').select('id,org_id').eq('id', leadId).single();
      if (!lead || lead.org_id !== profile.org_id) return json({ error: 'Forbidden' }, 403);
    }

    const result = await processEvent(leadId);
    return json({ ok: true, ...result });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
