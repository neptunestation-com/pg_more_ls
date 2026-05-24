-- Variant C: run as app_user, RLS enforced. GUC set per session.

\timing on
\echo '================================================================'
\echo 'Variant C: RLS-enabled naive query (no JOIN, no EXISTS in user SQL)'
\echo '================================================================'
BEGIN;
SET LOCAL app.current_owner_id = '50';
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT * FROM line_items;
COMMIT;
