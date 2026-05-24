-- Strip policies down to one level and observe what changes.
SET jit = off;
\timing on

-- Snapshot current plan so we have a before/after baseline.
\echo '=== Baseline: all 3 policies present, naive Variant C ==='
SET ROLE app_user;
BEGIN;
SET LOCAL app.current_owner_id = '50';
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM line_items;
COMMIT;
RESET ROLE;

-- Drop just the line_items policy and recreate it as a non-EXISTS, "owner_id"
-- column-style policy. To do that we need an owner_id column on line_items
-- (denormalized). We'll add it temporarily and see if a flat policy works.
\echo '=== Add owner_id denorm column and a flat policy on line_items ==='
ALTER TABLE line_items ADD COLUMN owner_id int;
UPDATE line_items li SET owner_id = c.owner_id
FROM invoices i, customers c
WHERE i.id = li.invoice_id AND c.id = i.customer_id;
CREATE INDEX line_items_owner_id_idx ON line_items (owner_id);
ANALYZE line_items;

DROP POLICY line_items_select ON line_items;
CREATE POLICY line_items_select ON line_items
    FOR SELECT
    USING (owner_id = (SELECT current_setting('app.current_owner_id'))::int);

\echo '=== Variant C, flat (column-based) policy on line_items ==='
SET ROLE app_user;
BEGIN;
SET LOCAL app.current_owner_id = '50';
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM line_items;
COMMIT;
RESET ROLE;

-- Restore the original EXISTS-based policy so other probes still match the
-- baseline schema.
DROP POLICY line_items_select ON line_items;
CREATE POLICY line_items_select ON line_items
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM invoices i
            WHERE i.id = line_items.invoice_id
        )
    );
ALTER TABLE line_items DROP COLUMN owner_id;
ANALYZE line_items;
