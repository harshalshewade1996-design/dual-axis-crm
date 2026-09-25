# Dual Axis Media — CRM Phase 2

A lightweight CRM for wedding lead generation with a Meta CRM feedback layer.

## What Phase 2 adds

- Meta section in the CRM.
- Per-client Meta dataset connection using `meta_connections`.
- Meta event log with queued / sent / failed states.
- Server-side Supabase Edge Function named `meta-crm-event`.
- Automatic sync when a Meta lead is added or its CRM stage changes.
- Manual `Sync` button per lead and `Sync pending leads` action.
- Stage mapping: New → lead, Contacted → contacted, Qualified → qualified, Meeting → meeting, Won → converted, Lost → lost.
- Meta Lead ID stays with the lead record so events can be matched back to the original lead.
- The Meta access token is never stored in browser JavaScript.

## Important architecture

Browser → Supabase Auth/RLS → Supabase Edge Function → Meta dataset Events endpoint.

The browser calls the edge function with the Supabase-authenticated user's session and a lead UUID. The function re-reads the lead, checks the user's client access, checks the Meta connection, and sends the CRM stage event server-side.

## Setup

1. Run `schema.sql` from Phase 1.
2. Run `phase2.sql` in the Supabase SQL Editor.
3. Deploy `supabase/functions/meta-crm-event/index.ts` as an Edge Function named `meta-crm-event`.
4. Set these Supabase Function secrets:
   - `META_ACCESS_TOKEN`
   - `META_API_VERSION` (verify the currently supported Graph API version before production)
   - `META_DEFAULT_DATASET_ID` (optional fallback)
5. Open the CRM as an admin and use **Meta** → **Client Meta connection** to save each client's Dataset ID.
6. Test with a Meta lead that contains the original Meta Lead ID.
7. Verify delivery in Meta Events Manager before selecting a Conversion Leads optimization stage in Ads Manager.

## Security notes

- Never put the Meta access token in `supabase-config.js` or any frontend file.
- The Meta Lead ID is sent to the server as the primary match key. Do not put CRM notes, private comments, or other unnecessary personal data in the Meta payload.
- The Edge Function checks the authenticated user and the lead's organization before sending.
- Client users cannot edit `meta_connections`; only the admin role can save them.

## Demo mode

Open `index.html` directly. Demo mode uses browser localStorage and simulates successful Meta sends. It does not contact Meta.

## Meta payload used by the server

The function posts to the configured dataset's `/events` endpoint with a CRM/system-generated lead event containing the Meta Lead ID, event time, event ID, CRM stage metadata, and INR value for Won leads when a booking value is present.

This implementation is based on the current public Meta CRM conversion event pattern. Verify the exact fields and supported Graph API version in Meta's current documentation before production, because Meta API requirements can change.


## Phase 3

Phase 3 adds automatic Instagram Message Ads + Meta Ads → CRM import, Page/form-to-client mapping, Meta attribution IDs, inbound import logs, and an admin-only backfill/reconciliation function. See `PHASE3_SETUP.md`.
