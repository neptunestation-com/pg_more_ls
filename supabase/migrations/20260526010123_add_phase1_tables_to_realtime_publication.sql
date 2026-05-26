-- Phase 1 follow-up: add user-facing tables to the supabase_realtime
-- publication so the frontend's `postgres_changes` subscriptions
-- actually receive events.
--
-- Without this, the initial SELECT on page load works (RLS gates it
-- correctly) but later writes — the worker's INSERT into schema_*
-- after an introspect, a user creating a new target via the api,
-- a new org via the dashboard, etc. — never propagate to the
-- subscribed client. The graph only updates on hard refresh.
--
-- Symptom seen during the first end-to-end test of v0.1.0-poc:
-- "Refresh schema" enqueued, worker logged
-- "introspect: target X — 6 tables, 42 columns, 7 FKs", but the
-- frontend graph stayed empty until Cmd+Shift+R.

alter publication supabase_realtime add table
    public.orgs,
    public.target_databases,
    public.schema_tables,
    public.schema_columns,
    public.schema_relationships;
