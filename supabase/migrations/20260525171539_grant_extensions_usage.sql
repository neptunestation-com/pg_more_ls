-- Grant USAGE on the `extensions` schema and EXECUTE on all functions
-- within it to PUBLIC.
--
-- Why: the supabase CLI's `test db --linked` flow connects as a
-- per-session role (`cli_login_postgres`) that lacks default access
-- to the extensions schema on hardened supabase.com projects. Without
-- this grant, pgTAP function calls in supabase/tests/*.sql fail with
-- `function plan(integer) does not exist` even though pgtap is
-- installed in `extensions`. Granting to PUBLIC keeps it broad but
-- low-risk for a test extension.

grant usage on schema extensions to public;
grant execute on all functions in schema extensions to public;
