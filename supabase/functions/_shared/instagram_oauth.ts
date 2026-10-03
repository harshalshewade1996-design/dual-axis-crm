// Pure helpers shared by onboarding, webhook and tests. No credentials in responses/logs.
export const SCOPES = ['instagram_business_basic', 'instagram_business_manage_messages'];
export function authorizationUrl(appId: string, redirect: string, state: string) {
  const url = new URL('https://www.instagram.com/oauth/authorize');
  url.search = new URLSearchParams({client_id: appId, redirect_uri: redirect,
    response_type: 'code', scope: SCOPES.join(','), state,
    enable_fb_login: '0', force_authentication: '1'}).toString();
  return url.toString();
}
export async function digest(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
    .map(x => x.toString(16).padStart(2, '0')).join('');
}
export function randomState() { return Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,'0')).join(''); }
function base64(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)); }
function unbase64(value: string) { return Uint8Array.from(atob(value), c=>c.charCodeAt(0)); }
async function key(secret: string) {
  if (!/^[0-9a-f]{64}$/i.test(secret)) throw new Error('Instagram token encryption is not configured');
  return crypto.subtle.importKey('raw', Uint8Array.from(secret.match(/../g)!, x=>parseInt(x,16)), 'AES-GCM', false, ['encrypt','decrypt']);
}
export async function encryptToken(token: string, secret: string, binding: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:new TextEncoder().encode(binding)}, await key(secret), new TextEncoder().encode(token));
  return 'v1.'+base64(iv)+'.'+base64(new Uint8Array(encrypted));
}
export async function decryptToken(value: string, secret: string, binding: string) {
  const [version, iv, ciphertext] = value.split('.');
  if (version !== 'v1' || !iv || !ciphertext) throw new Error('Invalid stored authorization');
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM', iv:unbase64(iv), additionalData:new TextEncoder().encode(binding)}, await key(secret), unbase64(ciphertext)));
}
export function tokenResult(result: any) {
  // Meta has returned both flat and single-entry wrapped exchange responses.
  const data = result?.data;
  if (data && (result.access_token || !Array.isArray(data) || data.length !== 1)) throw new Error('Ambiguous Instagram authorization');
  const row = data ? data[0] : result;
  if (typeof row?.access_token !== 'string' || !row.access_token) throw new Error('Instagram did not return an access token');
  return row;
}
export function accountResult(result: any) {
  // user_id is the professional account ID used in webhook entry.id; never use the app-scoped id.
  if (typeof result?.user_id==='number'&&!Number.isSafeInteger(result.user_id)) throw new Error('Instagram returned an unsafe account ID');
  if (!/^\d+$/.test(String(result?.user_id || '')) || !result?.username) throw new Error('Instagram professional account could not be verified');
  return {instagram_account_id:String(result.user_id), instagram_username:String(result.username)};
}
export function expiry(seconds: unknown) {
  const duration = Number(seconds);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 90*86400) throw new Error('Instagram token expiry could not be verified');
  return new Date(Date.now()+duration*1000).toISOString();
}
export async function metaJson(url: string | URL, options: RequestInit = {}) {
  const response = await fetch(url, {...options, signal:AbortSignal.timeout(10000)});
  const data = await response.json().catch(()=>null);
  // Provider errors may echo secrets. Return a controlled error; never log raw data/URL.
  if (!response.ok || data?.error || !data) {
    const error = new Error('Instagram request failed. Check permissions or reconnect the account.');
    const message=typeof data?.error?.message==='string'?data.error.message:'';
    const reason=/Unsupported request.*method type.*get/i.test(message)?'get_method_unsupported':
      /client.*secret|app.*secret/i.test(message)?'app_secret_rejected':
      /permission|scope/i.test(message)?'permission_rejected':
      /expired/i.test(message)?'token_expired':
      /invalid.*token|token.*invalid/i.test(message)?'token_rejected':
      /unsupported request/i.test(message)?'request_unsupported':'unclassified';
    Object.assign(error, {http_status:response.status,
      provider_reason:reason,
      provider_code:Number.isSafeInteger(data?.error?.code)?data.error.code:null,
      provider_subcode:Number.isSafeInteger(data?.error?.error_subcode)?data.error.error_subcode:null});
    throw error;
  }
  return data;
}
