# Supabase backend source

`migrations/001-004` were recovered from the owner's Phase 3 and Phase 4 uploads. `005_status_and_access_hardening.sql` records the status and access fixes applied to the live project on 2026-09-26. They describe the order used to build the schema; **do not run them against the existing production database** without first comparing its schema and migration history. The original setup files use `create table if not exists` and replace functions and policies, so replaying them can undo later protections.

The Edge Function directories contain the uploaded source snapshots. The owner deployed `meta-business-messaging-event` and `meta-crm-event` from the copies in this repository on 2026-09-26 and 2026-09-27 respectively. Their deployment succeeded, but no real ad lead has yet verified delivery to Meta. The other function files came from the uploaded Phase 3 package (`instagram-message-webhook`, `meta-lead-webhook`, `meta-lead-backfill`) and the supplied Phase 4 `admin-manage-client/index.ts`; their exact deployed versions have **not** been compared with the dashboard. `config.toml` records the Phase 3 JWT settings, but live dashboard settings still need confirmation.

The original Instagram webhook snapshot may replace an existing ad lead's source or ad identifiers when a later organic DM arrives. Confirm the live code before changing that function.

Keep all access tokens, app secrets, verify tokens, and service-role keys in Supabase secrets. This repository contains only source that reads secrets by name. A single `META_ACCESS_TOKEN` must have access to each configured client's dataset; a token generated for one dataset does not automatically authorize other datasets.

Next: export or compare the live SQL definitions and deployed function versions, then check RLS, grants, and organization checks for every table and function. Verify a real eligible Meta event in Events Manager before relying on conversion feedback.
