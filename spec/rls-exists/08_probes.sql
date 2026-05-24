SET jit = off;
\timing on

-- -------------------------------------------------------------------------
-- Probe 1: can Variant B be coerced into a SubPlan plan by disabling joins?
-- If we turn off hash/merge joins, the planner should still produce a
-- nested-loop join or a SubPlan fallback. We want to see whether the cost
-- of the "true semi-join" path is what was preferred in the baseline.
-- -------------------------------------------------------------------------
\echo '=== Probe 1a: B with enable_hashjoin = off, enable_mergejoin = off ==='
SET enable_hashjoin = off;
SET enable_mergejoin = off;
EXPLAIN (ANALYZE, BUFFERS)
SELECT li.* FROM line_items li
WHERE EXISTS (
    SELECT 1 FROM invoices i
    WHERE i.id = li.invoice_id
      AND EXISTS (
          SELECT 1 FROM customers c
          WHERE c.id = i.customer_id AND c.owner_id = 50
      )
);
RESET enable_hashjoin;
RESET enable_mergejoin;

\echo '=== Probe 1b: B with all joins off, nested loop only ==='
SET enable_hashjoin = off;
SET enable_mergejoin = off;
SET enable_nestloop = on;  -- still allowed; this forces nl
EXPLAIN (ANALYZE, BUFFERS)
SELECT li.* FROM line_items li
WHERE EXISTS (
    SELECT 1 FROM invoices i
    WHERE i.id = li.invoice_id
      AND EXISTS (
          SELECT 1 FROM customers c
          WHERE c.id = i.customer_id AND c.owner_id = 50
      )
);
RESET enable_hashjoin;
RESET enable_mergejoin;
RESET enable_nestloop;
