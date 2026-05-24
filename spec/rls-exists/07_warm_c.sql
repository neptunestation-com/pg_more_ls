SET jit = off;
\timing on

BEGIN;
SET LOCAL app.current_owner_id = '50';
\echo '=== C.1 ===' ;
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM line_items;
\echo '=== C.2 ===' ;
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM line_items;
\echo '=== C.3 ===' ;
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM line_items;
COMMIT;
