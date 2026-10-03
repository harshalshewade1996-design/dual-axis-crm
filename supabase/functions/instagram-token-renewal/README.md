# Automatic Instagram renewal

Live on 2026-10-03 in project oydzhtwpeoyfeuesyntd. The hourly cron job runs at minute 17 UTC (`17 * * * *`). It processes at most five active, enabled, correctly mapped accounts per run. Tokens must be unexpired and at least 24 hours old. Renewal becomes due after 30 days or with at most 14 days remaining.

## Reproduce

1. Apply `supabase/updates/instagram_token_renewal.sql` after the onboarding update. It enables pg_cron and pg_net in the extensions schema, adds protected run records and token leases, and resets renewal errors on reconnection.
2. Deploy `instagram-token-renewal/index.ts` with `_shared/instagram_oauth.ts`, JWT verification disabled. The handler validates a 256-bit single-use run ticket atomically before accessing any credentials. Existing Supabase server environment variables, `INSTAGRAM_TOKEN_ENCRYPTION_KEY` and `META_API_VERSION` are required. No new permanent scheduler secret is needed.
3. Deploy the updated onboarding function for renewal status and manual-refresh coordination. Publish `instagram-onboarding.js` to display automatic renewal and reconnect instructions.
4. Apply `supabase/updates/instagram_token_renewal_schedule.sql`. Only the database owner can enqueue runs. Each ticket expires in 10 minutes; only its SHA-256 hash is persisted in the run table. pg_net temporarily holds its plaintext in the owner-only HTTP queue until delivery.

All new functions are SECURITY INVOKER with an empty search path and revoked public/anon/authenticated execution. Token RPCs are service-role-only; enqueue is database-owner-only. The run table has RLS and no user read/write grants. RLS-without-policy advisor INFO is deliberate denial; existing unrelated auth/trigger-function warnings are unchanged.

## Failure and concurrency

Account leases last 10 minutes. Concurrent workers skip claimed rows. The saved token is replaced only if the organization, enabled mapping, account ID, prior ciphertext and lease still match. A refreshed token is checked against `/me` before saving. Revoked/permission-denied tokens are marked `reconnect_required`; transient failures preserve the old token and retry after 24 hours. Expired authorizations require a new connection link. An interrupted worker's leases expire automatically. Run records older than 30 days are removed.

The worker returns only counts and logs fixed outcome labels/numeric provider codes. It never logs provider text, token URLs, tokens, OAuth codes or ciphertext. A one-off verification run can be queued by the owner with `select public.enqueue_instagram_refresh(true);`; it still enforces age, expiry, mapping and access checks. Normal runs use false. Pausing: `select cron.unschedule('instagram-token-renewal');` retains all connection credentials.

## Verification

`node tests/instagram-renewal.test.mjs` exercises the real worker handler with mocked boundaries: unauthorized callers, forged run ID, replay, encrypted save, revoked token, account mismatch and secret-free logs. `tests/instagram-renewal.sql` passed against production in a rolled-back transaction: credential ACLs, ticket replay, inactive client, exclusive lease, stale-token rejection, preserved token on failure, retry delay and successful atomic save. No fixture clients remained.

Live owner-triggered renewal: HTTP 200, renewed=1, failed=0. @dualaxismedia's saved expiry moved from 2026-11-30 to **2026-12-02 08:44:56 UTC**; account ID remained 17841444533924528. A subsequent normal run returned HTTP 200, renewed=0, failed=0, confirming the newly renewed account is skipped. Unauthenticated HTTP POST returned 401. Cron active state verified. Renewal does not guarantee uninterrupted access if the owner revokes permission, the professional account loses eligibility, or Meta/Supabase is unavailable.

The existing successful OAuth exchange compatibility fix is included in this branch: versioned GET with explicit `access_token,expires_in,token_type` fields. Refresh uses the same version and fields pattern; the real refresh succeeded.
