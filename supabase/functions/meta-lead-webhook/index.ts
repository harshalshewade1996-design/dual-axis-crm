import { importMetaLeadById, markMetaImportFailed } from '../_shared/meta_lead.ts';

const VERIFY_TOKEN = Deno.env.get('META_WEBHOOK_VERIFY_TOKEN') || '';
const APP_SECRET = Deno.env.get('META_APP_SECRET') || '';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256(secret: string, body: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
}

async function signatureValid(req: Request, body: string) {
  if (!APP_SECRET) return false;
  const header = req.headers.get('x-hub-signature-256') || '';
  if (!header.startsWith('sha256=')) return false;
  const expected = await hmacSha256(APP_SECRET, body);
  const received = header.slice(7).toLowerCase();
  if (received.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');
      if (mode === 'subscribe' && challenge && token === VERIFY_TOKEN && VERIFY_TOKEN) return new Response(challenge, { status: 200 });
      return new Response('Forbidden', { status: 403 });
    }

    if (req.method !== 'POST') return json({ ok: true, service: 'meta-lead-webhook' });

    const body = await req.text();
    if (!(await signatureValid(req, body))) return json({ error: 'Invalid signature' }, 403);

    let payload: any;
    try { payload = JSON.parse(body); } catch { return json({ error: 'Invalid JSON' }, 400); }

    // Acknowledge fast; import calls are still awaited here for a simple MVP.
    const results: unknown[] = [];
    for (const entry of payload?.entry || []) {
      const pageId = String(entry?.id || '');
      for (const change of entry?.changes || []) {
        if (change?.field !== 'leadgen') continue;
        const leadgenId = String(change?.value?.leadgen_id || '');
        const formId = String(change?.value?.form_id || '');
        if (!leadgenId) continue;
        try {
          results.push(await importMetaLeadById(leadgenId, { pageId, formId }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await markMetaImportFailed(leadgenId, message);
          results.push({ ok: false, leadgen_id: leadgenId, error: message });
        }
      }
    }

    return json({ ok: true, processed: results.length, results });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
