-- The three EXPLAIN variants. Run from a session that already has the GUC.
-- Caller is responsible for connecting as the right role:
--   variants A and B are run as the table owner (RLS disabled in practice for
--   non-forced; here both A and B are run *as app_user with RLS disabled at the
--   table level* via SET row_security = off, so the policies are not applied.)

\timing on
\echo '================================================================'
\echo 'Variant A: no RLS, explicit JOIN'
\echo '================================================================'
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT li.*
FROM   line_items li
JOIN   invoices   i ON i.id = li.invoice_id
JOIN   customers  c ON c.id = i.customer_id
WHERE  c.owner_id = 50;

\echo '================================================================'
\echo 'Variant B: no RLS, hand-written nested EXISTS'
\echo '================================================================'
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT li.*
FROM   line_items li
WHERE  EXISTS (
    SELECT 1
    FROM   invoices i
    WHERE  i.id = li.invoice_id
      AND  EXISTS (
          SELECT 1
          FROM   customers c
          WHERE  c.id = i.customer_id
            AND  c.owner_id = 50
      )
);
