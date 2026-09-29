import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

const rows = { leads: [], instagram_message_events: [] };
let active = true;
let profile = null;
let profileRequests = 0;
let handler;
const query = table => {
  const filters = [];
  let operation = 'select';
  let payload;
  const q = {
    select() { return q; },
    eq(key, value) { filters.push([key, value]); return q; },
    maybeSingle() {
      if (table === 'meta_instagram_connections') return Promise.resolve({ data: { org_id: 'org-1', enabled: true } });
      if (table === 'organizations') return Promise.resolve({ data: { active } });
      return Promise.resolve({ data: rows[table].find(row => filters.every(([key, value]) => row[key] === value)) || null });
    },
    upsert(value) { operation = 'upsert'; payload = value; return q; },
    insert(value) { operation = 'insert'; payload = value; return q; },
    update(value) { operation = 'update'; payload = value; return q; },
    single() {
      const row = { id: `${table}-${rows[table].length + 1}`, ...payload };
      rows[table].push(row);
      return Promise.resolve({ data: row });
    },
    then(resolve, reject) {
      if (operation === 'update') Object.assign(rows[table].find(row => filters.every(([key, value]) => row[key] === value)), payload);
      return Promise.resolve({ error: null }).then(resolve, reject);
    },
  };
  return q;
};

const source = stripTypeScriptTypes((await readFile(new URL('./index.ts', import.meta.url), 'utf8')).replace(/^import \{ createClient \}.*\n/m, ''));
vm.runInNewContext(source, {
  createClient: () => ({ from: query }),
  Deno: { env: { get: key => ({ META_APP_SECRET: 'test-secret', META_INSTAGRAM_ACCESS_TOKEN: 'test-profile-token' })[key] || '' }, serve: fn => { handler = fn; } },
  fetch: async (url, options) => {
    profileRequests++;
    assert.match(url, /\/ig-user\?fields=name,username$/);
    assert.equal(options.headers.Authorization, 'Bearer test-profile-token');
    return profile ? Response.json(profile) : Response.json({ error: 'Unavailable' }, { status: 403 });
  },
  crypto: webcrypto, TextEncoder, Request, Response, URL, Date, AbortSignal, console,
});

async function send(mid, referral) {
  const body = JSON.stringify({ entry: [{ id: 'ig-account', messaging: [{ sender: { id: 'ig-user' }, message: { mid, text: 'Hello', ...(referral ? { referral } : {}) } }] }] });
  const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode('test-secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = Array.from(new Uint8Array(await webcrypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))).map(x => x.toString(16).padStart(2, '0')).join('');
  return (await handler(new Request('https://example.test/webhook', { method: 'POST', body, headers: { 'x-hub-signature-256': `sha256=${signature}` } }))).json();
}

active = false;
assert.equal((await send('inactive', { source: 'ADS', ad_id: 'ad-1' })).results[0].reason, 'client_account_inactive');
assert.equal(rows.leads.length, 0);
assert.equal(rows.instagram_message_events.length, 0);

active = true;
assert.equal((await send('ad', { source: 'ADS', ad_id: 'ad-1', ads_context_data: { ad_title: 'First ad' } })).results[0].imported, true);
assert.equal(rows.leads[0].name, 'Instagram Lead');
profile = { name: 'Asha Patel', username: 'asha.patel' };
assert.equal((await send('organic')).results[0].imported, true);
assert.equal(rows.leads.length, 1);
assert.equal(rows.leads[0].name, 'Asha Patel');
assert.equal(rows.leads[0].instagram_username, 'asha.patel');
assert.equal(rows.leads[0].source, 'Instagram Message Ad');
assert.equal(rows.leads[0].meta_ad_id, 'ad-1');
assert.equal(rows.leads[0].meta_ad_title, 'First ad');
rows.leads[0].name = 'Asha from wedding enquiry';
profile = null;
assert.equal((await send('new-ad', { source: 'ADS', ad_id: 'ad-2' })).results[0].imported, true);
assert.equal(rows.leads[0].name, 'Asha from wedding enquiry');
assert.equal(rows.leads[0].instagram_username, 'asha.patel');
assert.equal(profileRequests, 2);
assert.equal(rows.leads[0].meta_ad_id, 'ad-2');
assert.equal(rows.leads[0].meta_ad_title, null);
console.log('Webhook inactive-client, sender profile, manual name, and attribution checks passed');
