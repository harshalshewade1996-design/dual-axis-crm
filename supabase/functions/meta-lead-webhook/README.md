# Meta Lead Ads webhook

Public webhook endpoint used by Meta's Page `leadgen` subscription.

GET performs Meta's webhook verification handshake. POST validates `X-Hub-Signature-256` when `META_APP_SECRET` is configured, reads the `leadgen_id`, retrieves the lead from the Graph API, maps Page/form → CRM client, and creates/updates the CRM lead.

Required secrets:
- `META_ACCESS_TOKEN`
- `META_API_VERSION` (defaults to `v25.0` in the shared helper)
- `META_WEBHOOK_VERIFY_TOKEN`
- `META_APP_SECRET` (strongly recommended for production)

The webhook is intentionally not protected by Supabase JWT because Meta must be able to call it publicly.
