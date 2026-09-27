import { admin, importMetaLead, markMetaImportFailed, META_ACCESS_TOKEN, META_API_VERSION } from '../_shared/meta_lead.ts';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
  }});
}

async function getUser(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const anon = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const url = Deno.env.get('SUPABASE_URL')!;
  const client = (await import('https://esm.sh/@supabase/supabase-js@2')).createClient(url, anon, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: { user } } = await client.auth.getUser(token);
  return user || null;
}

async function fetchPage(url: string) {
  const r = await fetch(url);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Meta backfill read failed (${r.status}): ${JSON.stringify(body)}`);
  return body;
}

async function runBackfill(formId: string, since?: string, until?: string) {
  if (!META_ACCESS_TOKEN) throw new Error('META_ACCESS_TOKEN secret is not configured');
  const url = new URL(`https://graph.facebook.com/${META_API_VERSION}/${encodeURIComponent(formId)}/leads`);
  url.searchParams.set('fields', 'id,created_time,field_data,ad_id,adset_id,campaign_id,form_id,page_id');
  url.searchParams.set('limit', '100');
  url.searchParams.set('access_token', META_ACCESS_TOKEN);
  const sinceMs = since ? new Date(since + 'T00:00:00Z').getTime() : Number.NEGATIVE_INFINITY;
  const untilMs = until ? new Date(until + 'T23:59:59Z').getTime() : Number.POSITIVE_INFINITY;

  let next = url.toString();
  let total = 0;
  let imported = 0;
  let unmapped = 0;
  let failed = 0;
  let pages = 0;

  while (next && pages < 20) {
    const body = await fetchPage(next);
    pages++;
    for (const lead of body?.data || []) {
      const createdMs = lead?.created_time ? new Date(lead.created_time).getTime() : Date.now();
      if (createdMs < sinceMs || createdMs > untilMs) continue;
      total++;
      try {
        const result = await importMetaLead(lead, { formId });
        if (result.imported) imported++; else if (result.unmapped) unmapped++;
      } catch (error) { failed++; await markMetaImportFailed(String(lead?.id || ''), error instanceof Error ? error.message : String(error)); }
    }
    next = body?.paging?.next || '';
  }
  return { form_id: formId, total, imported, unmapped, failed, pages_scanned: pages };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  try {
    if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
    const user = await getUser(req);
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const { data: profile } = await admin.from('profiles').select('org_id,role').eq('user_id', user.id).single();
    if (!profile || profile.role !== 'admin') return json({ error: 'Admin only' }, 403);

    const body = await req.json();
    const requestedFormId = String(body.form_id || '').trim();
    const since = body.since ? String(body.since) : undefined;
    const until = body.until ? String(body.until) : undefined;

    let sourcesQuery = admin.from('meta_lead_sources').select('form_id,page_id').eq('enabled', true);
    if (requestedFormId) sourcesQuery = sourcesQuery.eq('form_id', requestedFormId);
    const { data: sources, error } = await sourcesQuery;
    if (error) throw error;

    const results = [];
    for (const source of sources || []) {
      if (!source.form_id) continue; // Backfill requires a specific form.
      results.push(await runBackfill(String(source.form_id), since, until));
    }
    return json({ ok: true, results });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
