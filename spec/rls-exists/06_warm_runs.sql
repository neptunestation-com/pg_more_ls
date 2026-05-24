-- Stable warm-cache passes: 3 runs of each variant, JIT off, EXPLAIN ANALYZE only.
SET jit = off;
\timing on

\echo '=== A.1 ===' ;
EXPLAIN (ANALYZE, BUFFERS)
SELECT li.* FROM line_items li
JOIN invoices i ON i.id = li.invoice_id
JOIN customers c ON c.id = i.customer_id
WHERE c.owner_id = 50;

\echo '=== A.2 ===' ;
EXPLAIN (ANALYZE, BUFFERS)
SELECT li.* FROM line_items li
JOIN invoices i ON i.id = li.invoice_id
JOIN customers c ON c.id = i.customer_id
WHERE c.owner_id = 50;

\echo '=== A.3 ===' ;
EXPLAIN (ANALYZE, BUFFERS)
SELECT li.* FROM line_items li
JOIN invoices i ON i.id = li.invoice_id
JOIN customers c ON c.id = i.customer_id
WHERE c.owner_id = 50;

\echo '=== B.1 ===' ;
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

\echo '=== B.2 ===' ;
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

\echo '=== B.3 ===' ;
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
