import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const META_API_VERSION = Deno.env.get('META_API_VERSION') || 'v25.0';
export const META_ACCESS_TOKEN = Deno.env.get('META_ACCESS_TOKEN') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

export const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

export type MetaLead = {
  id: string;
  created_time?: string;
  field_data?: Array<{ name?: string; values?: string[] }>;
  ad_id?: string;
  adset_id?: string;
  campaign_id?: string;
  form_id?: string;
  page_id?: string;
  [key: string]: unknown;
};

export function normalizeFieldData(fieldData: MetaLead['field_data']) {
  const fields: Record<string, string> = {};
  for (const item of fieldData || []) {
    const name = String(item?.name || '').trim();
    if (!name) continue;
    const values = (item?.values || []).map(String).filter(Boolean);
    fields[name] = values.join(', ');
  }
  return fields;
}

function findField(fields: Record<string, string>, candidates: string[]) {
  const entries = Object.entries(fields).map(([k, v]) => [k.toLowerCase().replace(/[^a-z0-9]/g, ''), v] as const);
  for (const candidate of candidates) {
    const needle = candidate.toLowerCase().replace(/[^a-z0-9]/g, '');
    const exact = entries.find(([k, v]) => k === needle && v);
    if (exact) return exact[1];
  }
  for (const candidate of candidates) {
    const needle = candidate.toLowerCase().replace(/[^a-z0-9]/g, '');
    const partial = entries.find(([k, v]) => k.includes(needle) && v);
    if (partial) return partial[1];
  }
  return '';
}

export function fieldNumber(v: string) {
  if (!v) return 0;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function fieldDate(v: string) {
  if (!v) return null;
  const value = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const m = value.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return null;
}

export function parseLead(lead: MetaLead) {
  const fields = normalizeFieldData(lead.field_data);
  let name = findField(fields, ['full_name', 'fullname', 'name']);
  const first = findField(fields, ['first_name', 'firstname']);
  const last = findField(fields, ['last_name', 'lastname']);
  if (!name) name = [first, last].filter(Boolean).join(' ').trim();

  const phone = findField(fields, ['phone_number', 'phone', 'mobile', 'whatsapp_number', 'whatsapp']);
  const email = findField(fields, ['email', 'email_address']);
  const weddingDate = fieldDate(findField(fields, ['wedding_date', 'date', 'event_date']));
  const location = findField(fields, ['city', 'location', 'wedding_location', 'venue']);
  const budget = fieldNumber(findField(fields, ['budget', 'budget_range', 'wedding_budget']));
  const service = findField(fields, ['service', 'package', 'what_do_you_need', 'requirement']);

  return {
    name: name || 'Meta Lead',
    phone: phone || 'Not provided',
    email: email || null,
    wedding_date: weddingDate || null,
    location: location || null,
    budget,
    service: service || 'Wedding Photography',
    field_data: fields,
  };
}

export async function fetchMetaLead(leadgenId: string): Promise<MetaLead> {
  if (!META_ACCESS_TOKEN) throw new Error('META_ACCESS_TOKEN secret is not configured');
  const url = new URL(`https://graph.facebook.com/${META_API_VERSION}/${encodeURIComponent(leadgenId)}`);
  url.searchParams.set('fields', 'id,created_time,field_data,ad_id,adset_id,campaign_id,form_id,page_id');
  url.searchParams.set('access_token', META_ACCESS_TOKEN);
  const response = await fetch(url.toString());
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Meta lead retrieval failed (${response.status}): ${JSON.stringify(body)}`);
  return body as MetaLead;
}

export async function findSource(pageId: string, formId?: string | null) {
  if (formId) {
    const { data } = await admin.from('meta_lead_sources')
      .select('id,org_id,page_id,form_id,page_name,form_name,enabled')
      .eq('page_id', pageId).eq('form_id', formId).maybeSingle();
    if (data) return data.enabled ? data : null;
  }
  const { data } = await admin.from('meta_lead_sources')
    .select('id,org_id,page_id,form_id,page_name,form_name,enabled')
    .eq('page_id', pageId).is('form_id', null).maybeSingle();
  return data?.enabled ? data : null;
}

export async function importMetaLead(lead: MetaLead, hint?: { pageId?: string; formId?: string }) {
  const pageId = String(lead.page_id || hint?.pageId || '');
  const formId = String(lead.form_id || hint?.formId || '');
  if (!lead.id) throw new Error('Meta lead payload has no id');
  if (!pageId) throw new Error('Meta lead payload has no page_id');

  const raw = lead;
  const source = await findSource(pageId, formId || null);
  await admin.from('meta_lead_imports').upsert({
    org_id: source?.org_id || null,
    leadgen_id: lead.id,
    page_id: pageId,
    form_id: formId || null,
    ad_id: lead.ad_id || null,
    adset_id: lead.adset_id || null,
    campaign_id: lead.campaign_id || null,
    meta_created_time: lead.created_time || null,
    import_status: source ? 'queued' : 'unmapped',
    raw_json: raw,
    error_message: source ? null : 'No active CRM mapping for this Meta Page/form',
  }, { onConflict: 'leadgen_id' });

  if (!source) return { ok: true, imported: false, unmapped: true, leadgen_id: lead.id };

  const parsed = parseLead(lead);
  const { data: existing, error: lookupError } = await admin.from('leads')
    .select('id,status,quality,budget,notes,followup_date')
    .eq('meta_lead_id', lead.id).maybeSingle();
  if (lookupError) throw lookupError;

  const incoming = {
    org_id: source.org_id,
    name: parsed.name,
    phone: parsed.phone,
    email: parsed.email,
    service: parsed.service,
    wedding_date: parsed.wedding_date,
    location: parsed.location,
    source: 'Meta Ads',
    meta_lead_id: lead.id,
    meta_page_id: pageId,
    meta_form_id: formId || null,
    meta_ad_id: lead.ad_id || null,
    meta_adset_id: lead.adset_id || null,
    meta_campaign_id: lead.campaign_id || null,
    meta_created_time: lead.created_time || null,
    meta_field_data: parsed.field_data,
  };

  let savedLeadId: string;
  if (existing?.id) {
    const preserveStatus = existing.status && existing.status !== 'New' ? existing.status : 'New';
    const preserveQuality = existing.quality && existing.quality !== 'Unknown' ? existing.quality : 'Unknown';
    const preserveBudget = Number(existing.budget || 0) > 0 ? Number(existing.budget) : parsed.budget;
    const { data, error } = await admin.from('leads').update({
      ...incoming,
      status: preserveStatus,
      quality: preserveQuality,
      budget: preserveBudget,
      notes: existing.notes || null,
      followup_date: existing.followup_date || null,
    }).eq('id', existing.id).select('id').single();
    if (error) throw error;
    savedLeadId = data.id;
  } else {
    const { data, error } = await admin.from('leads').insert({
      ...incoming,
      budget: parsed.budget,
      status: 'New',
      quality: 'Unknown',
    }).select('id').single();
    if (error) throw error;
    savedLeadId = data.id;
  }

  await admin.from('meta_lead_imports').update({
    org_id: source.org_id,
    lead_id: savedLeadId,
    import_status: 'imported',
    error_message: null,
    imported_at: new Date().toISOString(),
    raw_json: raw,
  }).eq('leadgen_id', lead.id);

  return { ok: true, imported: true, duplicate: Boolean(existing?.id), leadgen_id: lead.id, lead_id: savedLeadId, org_id: source.org_id };
}


export async function markMetaImportFailed(leadgenId: string, errorMessage: string) {
  await admin.from('meta_lead_imports').update({
    import_status: 'failed',
    error_message: errorMessage.slice(0, 4000),
  }).eq('leadgen_id', leadgenId);
}

export async function importMetaLeadById(leadgenId: string, hint?: { pageId?: string; formId?: string }) {
  const lead = await fetchMetaLead(leadgenId);
  return importMetaLead(lead, hint);
}
