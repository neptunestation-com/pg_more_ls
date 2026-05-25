-- Enable pgTAP for in-database test cases.
--
-- Tests live in supabase/tests/ and are run via `supabase test db`
-- (against a linked project) or against a local supabase stack.
-- See supabase/README.md "Running tests" for the workflow.

create extension if not exists pgtap with schema extensions;
