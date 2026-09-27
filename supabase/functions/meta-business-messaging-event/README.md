# Meta Business Messaging conversion event

Sends CRM milestones for Instagram-originated leads through Meta's Conversions API for Business Messaging.

The request uses:

- `action_source: business_messaging`
- `messaging_channel: instagram`
- `user_data.ig_sid`
- `user_data.ig_account_id`

The Instagram identifiers are kept unhashed because they are identifiers created by Meta. Phone/email are SHA-256 hashed when available.

CRM mapping:

- New / Contacted → `LeadSubmitted`
- Qualified → `QualifiedLead`
- Meeting → `InitiateCheckout`
- Won → `Purchase`

This package sends the events to the configured Meta Dataset. Availability of a specific Meta optimization goal can depend on the campaign type, connected messaging source, account eligibility and Meta's current product rules; do not assume that every event is selectable as an optimization goal for Instagram Direct.

Required secrets:

- `META_ACCESS_TOKEN`
- `META_API_VERSION` (default `v26.0` in this package)
- `META_DEFAULT_DATASET_ID` (optional)
- Supabase service/auth secrets supplied by the Edge Function environment
