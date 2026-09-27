# Instagram Messaging webhook

Primary Phase 3 integration for Dual Axis Media CRM.

Flow:

Instagram Click-to-Message ad → Instagram Direct webhook → CRM lead → CRM pipeline.

The webhook stores the inbound message, Instagram sender ID, conversation ID when present, and Meta referral/ad information when Meta supplies it. Click-to-Instagram attribution can be carried in the referral object and can include `ad_id` plus `ads_context_data`.

Required Supabase secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `META_APP_SECRET`
- `META_WEBHOOK_VERIFY_TOKEN`
- `META_ACCESS_TOKEN` (reserved for future Meta profile/conversion calls)
- `META_API_VERSION` (current approved Graph API version; default `v26.0` in this package)

Webhook URL after deployment:

`https://YOUR_PROJECT.supabase.co/functions/v1/instagram-message-webhook`

Meta verification uses `hub.mode`, `hub.verify_token`, and `hub.challenge`. POST requests validate `X-Hub-Signature-256` using `META_APP_SECRET`.

Configure one row in `meta_instagram_connections` for each Instagram professional account/client. `org_id` determines which client owns the inbound messages.
