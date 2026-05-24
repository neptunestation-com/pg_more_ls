SET jit = off;
\timing on

BEGIN;
SET LOCAL app.current_owner_id = '50';

\echo '=== Probe 2a: Variant C with seq scan off ==='
SET LOCAL enable_seqscan = off;
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM line_items;

\echo '=== Probe 2b: Variant C, written as explicit JOIN by the user ==='
-- This is the form a developer might use to "help" the planner under RLS.
-- The user-supplied query is a JOIN, but each table reference still has the
-- policy applied. So we should see ONE flattened join from the user SQL plus
-- the policy SubPlans layered on top.
SET LOCAL enable_seqscan = on;
EXPLAIN (ANALYZE, BUFFERS)
SELECT li.*
FROM   line_items li
JOIN   invoices   i ON i.id = li.invoice_id
JOIN   customers  c ON c.id = i.customer_id
WHERE  c.owner_id = (SELECT current_setting('app.current_owner_id'))::int;

\echo '=== Probe 2c: Variant C, with hashjoin/mergejoin off ==='
SET LOCAL enable_hashjoin = off;
SET LOCAL enable_mergejoin = off;
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM line_items;

COMMIT;
