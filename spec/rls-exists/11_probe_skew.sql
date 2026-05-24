SET jit = off;
\timing on
\echo '=== Variant B with the heaviest owner (owner_id = 1) ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT li.* FROM line_items li
WHERE EXISTS (
    SELECT 1 FROM invoices i
    WHERE i.id = li.invoice_id
      AND EXISTS (
          SELECT 1 FROM customers c
          WHERE c.id = i.customer_id AND c.owner_id = 1
      )
);

\echo '=== Variant A with the heaviest owner (owner_id = 1) ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT li.* FROM line_items li
JOIN invoices i ON i.id = li.invoice_id
JOIN customers c ON c.id = i.customer_id
WHERE c.owner_id = 1;
