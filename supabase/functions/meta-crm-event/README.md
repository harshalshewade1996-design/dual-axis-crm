# Meta CRM event function

Deploy as a Supabase Edge Function named `meta-crm-event`.

Required Supabase secrets:

- `META_ACCESS_TOKEN` — Meta token with permission to send events to the configured dataset(s).
- `META_API_VERSION` — Graph API version such as `v24.0` (verify the current supported version before production).
- `META_DEFAULT_DATASET_ID` — optional fallback dataset ID.

Client-specific dataset IDs live in `public.meta_connections` so one function can serve multiple client organizations. The access token never goes into browser JavaScript.

The function accepts:

```json
{ "lead_id": "<supabase lead uuid>" }
```

It reads the lead from Supabase, requires `source = Meta Ads` and a stored Meta lead ID, maps the CRM status to a funnel event, and sends the CRM event to Meta's dataset Events endpoint.
