import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

function makeTemporaryPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = new Uint32Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, n => chars[n % chars.length]).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ ok: false, error: 'Server configuration is incomplete' }, 500);

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const authHeader = req.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ ok: false, error: 'Authentication required' }, 401);

  const { data: userData, error: userError } = await adminClient.auth.getUser(jwt);
  if (userError || !userData.user) return json({ ok: false, error: 'Invalid authentication session' }, 401);

  const callerId = userData.user.id;
  const { data: callerProfile, error: profileError } = await adminClient
    .from('profiles')
    .select('user_id,role')
    .eq('user_id', callerId)
    .single();
  if (profileError || callerProfile?.role !== 'admin') return json({ ok: false, error: 'Admin access required' }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Invalid JSON body' }, 400); }

  const action = String(body.action || '');
  if (!['create', 'update', 'deactivate', 'reactivate'].includes(action)) {
    return json({ ok: false, error: 'Unsupported action' }, 400);
  }

  try {
    if (action === 'create') {
      const name = String(body.name || '').trim();
      const contactEmail = String(body.contact_email || '').trim().toLowerCase();
      const contactName = body.contact_name ? String(body.contact_name).trim() : null;
      const instagramUsername = body.instagram_username ? String(body.instagram_username).trim() : null;
      if (!name || !contactEmail) return json({ ok: false, error: 'Business name and login email are required' }, 400);

      const tempPassword = makeTemporaryPassword();
      const { data: createdUser, error: authError } = await adminClient.auth.admin.createUser({
        email: contactEmail,
        password: tempPassword,
        email_confirm: true,
      });
      if (authError || !createdUser.user) return json({ ok: false, error: authError?.message || 'Could not create client login' }, 400);

      const { data: org, error: orgError } = await adminClient
        .from('organizations')
        .insert({ name, active: true, contact_name: contactName, contact_email: contactEmail, instagram_username: instagramUsername })
        .select('id,name,active,contact_name,contact_email,instagram_username,created_at')
        .single();
      if (orgError || !org) {
        await adminClient.auth.admin.deleteUser(createdUser.user.id);
        return json({ ok: false, error: orgError?.message || 'Could not create client workspace' }, 400);
      }

      const { error: profileInsertError } = await adminClient.from('profiles').insert({
        user_id: createdUser.user.id,
        org_id: org.id,
        role: 'client',
        full_name: contactName || name,
      });
      if (profileInsertError) {
        await adminClient.from('organizations').delete().eq('id', org.id);
        await adminClient.auth.admin.deleteUser(createdUser.user.id);
        return json({ ok: false, error: profileInsertError.message }, 400);
      }

      return json({ ok: true, client: org, email: contactEmail, temporary_password: tempPassword });
    }

    const orgId = String(body.org_id || '');
    if (!orgId) return json({ ok: false, error: 'org_id is required' }, 400);

    if (action === 'update') {
      const name = String(body.name || '').trim();
      const contactEmail = String(body.contact_email || '').trim().toLowerCase();
      const contactName = body.contact_name ? String(body.contact_name).trim() : null;
      const instagramUsername = body.instagram_username ? String(body.instagram_username).trim() : null;
      if (!name || !contactEmail) return json({ ok: false, error: 'Business name and login email are required' }, 400);

      const { data: currentProfile, error: profileLookupError } = await adminClient
        .from('profiles')
        .select('user_id')
        .eq('org_id', orgId)
        .eq('role', 'client')
        .limit(1)
        .maybeSingle();
      if (profileLookupError) throw profileLookupError;

      const { data: org, error: orgError } = await adminClient
        .from('organizations')
        .update({ name, contact_name: contactName, contact_email: contactEmail, instagram_username: instagramUsername })
        .eq('id', orgId)
        .select('id,name,active,contact_name,contact_email,instagram_username,created_at')
        .single();
      if (orgError) throw orgError;

      if (currentProfile?.user_id) {
        const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(currentProfile.user_id, {
          email: contactEmail,
          email_confirm: true,
        });
        if (authUpdateError) throw authUpdateError;
        const { error: profileUpdateError } = await adminClient.from('profiles').update({ full_name: contactName || name }).eq('user_id', currentProfile.user_id);
        if (profileUpdateError) throw profileUpdateError;
      }

      return json({ ok: true, client: org });
    }

    const active = action === 'reactivate';
    const { data: org, error: stateError } = await adminClient
      .from('organizations')
      .update({ active })
      .eq('id', orgId)
      .select('id,name,active,contact_name,contact_email,instagram_username,created_at')
      .single();
    if (stateError) throw stateError;

    return json({ ok: true, client: org });
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: error?.message || 'Client operation failed' }, 500);
  }
});
