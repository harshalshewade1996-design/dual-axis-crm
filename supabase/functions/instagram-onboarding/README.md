# Client Instagram onboarding

Admin-led flow: select client → create 30-minute link → account owner authorizes Instagram → admin checks returned username/account ID → confirm → subscribe messaging webhooks and atomically save mapping + encrypted token.

This uses **Instagram API with Instagram Login**, not Facebook Page tokens. The professional account owner signs in on Instagram; no Instagram password is collected by CRM. The owner does not need a CRM login. Only authenticated CRM admins can create links, inspect authorization status, activate or refresh a connection. All POST routes manually call `auth.getUser` and check the database profile role. The public GET callback is protected by a hashed random single-use state. Callback redirects carry only a fixed success/failure flag.

## Deployment

1. Apply `supabase/updates/instagram_onboarding.sql` once. Both encrypted-token tables have RLS enabled, with no grants/policies for public, anon or authenticated. Two transaction functions are SECURITY INVOKER, executable only by service_role. Do not expose token tables to clients or add read policies.
2. Set these Edge secrets in Supabase (never in frontend files):
   - `META_INSTAGRAM_APP_ID` and `META_INSTAGRAM_APP_SECRET`: **Instagram** App ID/secret from the existing app's Instagram Login setup; these can differ from the Facebook App ID/secret.
   - `INSTAGRAM_TOKEN_ENCRYPTION_KEY`: a random 32-byte key represented as 64 hexadecimal characters. Keep a secure backup. Changing it requires reconnecting stored accounts or explicitly re-encrypting them first.
   - `META_API_VERSION`: the supported version configured for the Meta app.
   - `CRM_ORIGIN`: `https://harshalshewade1996-design.github.io`
   - `CRM_INSTAGRAM_RETURN_URL`: `https://harshalshewade1996-design.github.io/dual-axis-crm/instagram-connected.html`
   - `META_INSTAGRAM_LEGACY_ACCOUNT_ID`: `17841444533924528` **only if** the existing global `META_INSTAGRAM_ACCESS_TOKEN` still belongs to @dualaxismedia. This scopes the old fallback to its verified account. No other client may use it.
3. Deploy `instagram-onboarding` with JWT verification off (GET is the external callback; POST still checks user JWT and admin role). Include `_shared/instagram_oauth.ts` in the deployment bundle. Deploy the updated `instagram-message-webhook` with the same shared file.
4. In the existing Meta app's Instagram Business Login settings, register the exact redirect URI:
   `https://oydzhtwpeoyfeuesyntd.supabase.co/functions/v1/instagram-onboarding`
5. Keep the existing signed webhook callback and verify token. Enable the Instagram webhook fields `messages`, `messaging_postbacks`, `messaging_referral`. Account activation subscribes those fields for the authorized account.
6. Publish frontend files, including both `instagram-connected.*` and `instagram-onboarding.js`. Review permissions `instagram_business_basic` and `instagram_business_manage_messages`; external client access depends on the app's approved access and account eligibility. This code cannot grant Meta App Review approval.
7. Test with a consenting professional account owner. Review username and account ID in CRM, confirm, send a real inbound DM, and verify it lands in that client's organization with the sender profile. Verify a second client does not see it. Until this test passes, OAuth/network behavior is unverified in production.

## Lifecycle and limits

- Blank/manual mappings are retained; onboarding replaces a selected client's mapping only after admin confirmation and successful subscription. A unique account cannot be assigned to another organization. Old leads are not reassigned or backfilled.
- Each client has a separate AES-GCM encrypted token, bound to its organization. Webhook lookups use only the credential matching that organization **and** receiving account ID. Missing, expired, mismatched or unreadable credentials fall back to webhook-provided names; they do not borrow another client's token.
- **Refresh authorization** renews valid tokens at least 24 hours old. Expired/revoked tokens require a new link. Scheduled renewal and Meta deauthorization/data-deletion callbacks are not included in this change; implement those before unattended external-client rollout. Disabling the existing mapping pauses imports but does not revoke the owner's Meta authorization.
- New links cancel previous pending links and reviews for that client. Expired pending ciphertext is cleared when an admin creates another link. No state/code/token is written to browser localStorage or logged. URLs holding tokens are used only for Meta's server-side token exchange/refresh endpoints and are never returned to the client.
- Subscription occurs before the database transaction. If the commit fails, no mapping/token is activated, but Meta may retain a subscription. Retrying the confirmed review is safe; unmatched messages remain unmapped. If replacing an account, its old remote subscription remains until removed in Meta; the CRM no longer imports it for this organization.

Tests: `node tests/instagram-onboarding.test.mjs` (Node 24 TypeScript stripping), existing pagination and booking-value tests. Network boundaries are mocked; no real client authorization or conversion is sent by the test.
