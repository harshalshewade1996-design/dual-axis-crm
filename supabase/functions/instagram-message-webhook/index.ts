// Dual Axis CRM — Instagram Messaging webhook
// Public endpoint for Meta's Instagram messaging webhooks.
// No Supabase JWT is required because Meta calls this endpoint directly.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const metaAppSecret = Deno.env.get('META_APP_SECRET') || '';
const verifyToken = Deno.env.get('META_WEBHOOK_VERIFY_TOKEN') || '';
const metaToken = Deno.env.get('META_ACCESS_TOKEN') || '';
const metaApiVersion = Deno.env.get('META_API_VERSION') || 'v26.0';

const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('');
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

async function validSignature(req: Request, body: string) {
  if (!metaAppSecret) return false;
  const header = req.headers.get('x-hub-signature-256') || '';
  if (!header.startsWith('sha256=')) return false;
  const expected = await hmacSha256(metaAppSecret, body);
  const received = header.slice(7).toLowerCase();
  if (received.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  return diff === 0;
}

function first(...values: unknown[]) {
  for (const value of values) {
    const s = value == null ? '' : String(value).trim();
    if (s) return s;
  }
  return '';
}

function isoFromTimestamp(value: unknown) {
  if (value == null || value === '') return new Date().toISOString();
  const n = Number(value);
  if (Number.isFinite(n)) {
    const ms = n > 10_000_000_000 ? n : n * 1000;
    return new Date(ms).toISOString();
  }
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function extractReferral(message: any, event: any) {
  return message?.referral || event?.referral || event?.postback?.referral || {};
}

function extractConversationId(event: any) {
  return first(
    event?.conversation?.id,
    event?.conversation_id,
    event?.message?.conversation_id,
    event?.thread?.id,
  );
}

function extractSenderName(event: any) {
  return first(
    event?.sender?.name,
    event?.sender?.username,
    event?.username,
    event?.user?.username,
  );
}

async function findConnection(instagramAccountId: string) {
  const { data, error } = await admin
    .from('meta_instagram_connections')
    .select('org_id,instagram_account_id,instagram_username,page_id,page_name,enabled')
    .eq('instagram_account_id', instagramAccountId)
    .maybeSingle();
  if (error) throw error;
  return data?.enabled ? data : null;
}

async function upsertEvent(record: Record<string, unknown>) {
  const { data, error } = await admin
    .from('instagram_message_events')
    .upsert(record, { onConflict: 'event_key' })
    .select('id,org_id,lead_id,event_key,event_status')
    .single();
  if (error) throw error;
  return data;
}

async function importMessage(instagramAccountId: string, event: any, payload: any) {
  const senderId = first(event?.sender?.id);
  if (!senderId) return { ignored: true, reason: 'missing_sender_id' };
  if (event?.message?.is_echo === true) return { ignored: true, reason: 'echo' };

  const message = event?.message || {};
  const messageId = first(message?.mid, event?.message_id, event?.id);
  const conversationId = extractConversationId(event);
  const referral = extractReferral(message, event);
  const adsContext = referral?.ads_context_data || {};
  const adId = first(referral?.ad_id, adsContext?.ad_id, referral?.ads_context_data?.ad_id);
  const source = first(referral?.source).toUpperCase();
  const adTitle = first(referral?.ads_context_data?.ad_title, referral?.headline);
  const postId = first(referral?.ads_context_data?.post_id);
  const ref = first(referral?.ref);
  const text = first(message?.text, message?.quick_reply?.payload, message?.attachments ? '[Attachment]' : '');
  const timestamp = isoFromTimestamp(event?.timestamp || message?.timestamp);

  const eventKey = messageId || await hmacSha256(metaAppSecret || 'dual-axis', JSON.stringify({
    instagramAccountId,
    senderId,
    conversationId,
    timestamp,
    text,
  }));

  let connection = await findConnection(instagramAccountId);
  const mappedOrgId = connection?.org_id || null;
  const eventBase = {
    org_id: mappedOrgId,
    event_key: eventKey,
    message_id: messageId || null,
    instagram_account_id: instagramAccountId,
    sender_id: senderId,
    conversation_id: conversationId || null,
    message_text: text || null,
    message_timestamp: timestamp,
    source: (source === 'ADS' || Boolean(adId)) ? 'instagram_message_ad' : 'instagram',
    referral_source: source || null,
    referral_type: first(referral?.type) || null,
    meta_ad_id: adId || null,
    meta_ad_title: adTitle || null,
    meta_post_id: postId || null,
    meta_ref: ref || null,
    referral_json: referral || {},
    raw_json: payload,
    event_status: connection ? 'received' : 'unmapped',
    error_message: connection ? null : 'No active CRM mapping for this Instagram account',
  };

  const logged = await upsertEvent(eventBase);
  if (!connection) return { ok: true, imported: false, unmapped: true, event_id: logged.id, event_key: eventKey };

  const username = extractSenderName(event);
  const defaultName = username ? `Instagram @${username.replace(/^@/, '')}` : 'Instagram Lead';
  const leadSource = (source === 'ADS' || Boolean(adId)) ? 'Instagram Message Ad' : 'Instagram';

  const { data: existing, error: lookupError } = await admin
    .from('leads')
    .select('id,name,phone,status,quality,budget,notes,meta_messaging_referral')
    .eq('org_id', connection.org_id)
    .eq('meta_ig_user_id', senderId)
    .maybeSingle();
  if (lookupError) throw lookupError;

  const referralMerge = {
    ...(existing?.meta_messaging_referral || {}),
    ...(referral || {}),
    ...(adId ? { ad_id: adId } : {}),
  };

  const incoming = {
    org_id: connection.org_id,
    name: existing?.name && existing.name !== 'Instagram Lead' ? existing.name : defaultName,
    phone: existing?.phone || 'Not provided',
    source: leadSource,
    meta_ig_user_id: senderId,
    meta_instagram_account_id: instagramAccountId,
    meta_conversation_id: conversationId || null,
    meta_message_id: messageId || null,
    instagram_username: username || null,
    meta_ad_id: adId || null,
    meta_ad_title: adTitle || null,
    last_inbound_message: text || null,
    last_inbound_at: timestamp,
    meta_messaging_referral: referralMerge,
    updated_at: new Date().toISOString(),
  };

  let leadId = existing?.id;
  if (leadId) {
    const { error } = await admin.from('leads').update(incoming).eq('id', leadId);
    if (error) throw error;
  } else {
    const { data, error } = await admin.from('leads').insert({
      ...incoming,
      service: 'Wedding Photography',
      budget: 0,
      status: 'New',
      quality: 'Unknown',
      notes: text ? `First Instagram message: ${text}` : null,
    }).select('id').single();
    if (error) throw error;
    leadId = data.id;
  }

  const { error: eventUpdateError } = await admin.from('instagram_message_events').update({
    org_id: connection.org_id,
    lead_id: leadId,
    event_status: 'imported',
    error_message: null,
  }).eq('event_key', eventKey);
  if (eventUpdateError) throw eventUpdateError;

  return {
    ok: true,
    imported: true,
    duplicate: Boolean(existing?.id),
    event_id: logged.id,
    event_key: eventKey,
    lead_id: leadId,
    org_id: connection.org_id,
    ad_id: adId || null,
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');
      if (mode === 'subscribe' && challenge && token === verifyToken && verifyToken) {
        return new Response(challenge, { status: 200 });
      }
      return new Response('Forbidden', { status: 403 });
    }

    if (req.method !== 'POST') return json({ ok: true, service: 'instagram-message-webhook' });

    const body = await req.text();
    if (!(await validSignature(req, body))) return json({ error: 'Invalid signature' }, 403);

    let payload: any;
    try { payload = JSON.parse(body); } catch { return json({ error: 'Invalid JSON' }, 400); }

    const results: unknown[] = [];
    for (const entry of payload?.entry || []) {
      const instagramAccountId = first(entry?.id, entry?.instagram_account_id);
      for (const event of entry?.messaging || []) {
        try {
          results.push(await importMessage(instagramAccountId, event, payload));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          results.push({ ok: false, error: message });
        }
      }
    }

    return json({ ok: true, processed: results.length, results });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
