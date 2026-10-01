# Dual Axis Media — CRM Phase 2

Backend source and historical SQL are in [`supabase/`](supabase/README.md).
Read its deployment notes before applying any database migrations.

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

### Lead pagination

Apply `supabase/updates/lead_pagination.sql` before deploying this frontend. It installs `crm_lead_page` with SECURITY INVOKER, authenticated-only EXECUTE, and paging indexes; existing table RLS controls every result and aggregate. The update is idempotent and was applied to production on 2026-09-30.

The lead list and follow-up queue use 25/50/100 rows per page. Search and status filters run on the server; changing filters resets the page. Dashboard and pipeline totals cover all accessible leads for the selected client. Apply the booking-value update below to report confirmed Won booking amounts. CRM Meta event totals are database aggregates; the event log still shows its latest 150 entries. Instagram and Instant Form import logs still have their existing limits.

Run `node tests/pagination.test.mjs` for pagination, filtering, deletion and stale-request checks. Database validation used 1,105 uncommitted fixture leads and rolled back the transaction.

## Actual booking value
Apply `supabase/updates/booking_value.sql` before deploying the frontend and the two feedback functions. `booking_value` is nullable, nonnegative numeric(12,2), in INR. It is the agreed total package amount, not the budget or deposit. Existing values are not backfilled from budgets. Revenue sums booking_value for Won leads; average deal value divides by Won leads with a recorded amount (zero is known). Reports show missing Won amounts. Editing an amount does not automatically resend a conversion; historical sent events remain unchanged. Future feedback uses booking_value, never budget.

Validation: `node tests/booking-value.test.mjs` and `node tests/pagination.test.mjs`.
# Client Instagram authorization

Admin-led connection links and per-client encrypted profile lookup tokens are implemented in this branch. See [onboarding deployment and validation](supabase/functions/instagram-onboarding/README.md). This requires Instagram App settings/secrets, database update, Edge deployments and a real-account authorization test before rollout; it does not change Meta conversion feedback credentials.
