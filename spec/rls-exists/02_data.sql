-- Synthetic data with deterministic seed.
-- 1,000 customers across 100 owners (Zipf-ish: a few owners hold many customers).
-- 50,000 invoices, skewed so some customers have many, most have few.
-- 500,000 line_items, skewed across invoices.

SELECT setseed(0.42);

-- ---- customers --------------------------------------------------------------
-- Owner assignment uses a power transform: owner_id = floor(100 * r^2) + 1.
-- That puts more customers under low-numbered owners, but every owner gets some.
INSERT INTO customers (id, owner_id, name)
SELECT  g                                              AS id,
        (floor(100 * power(random(), 2)) + 1)::int     AS owner_id,
        'customer-' || g                               AS name
FROM    generate_series(1, 1000) g;

-- ---- invoices ---------------------------------------------------------------
-- Customer choice is skewed: floor(1000 * r^1.7) + 1 favors low ids.
INSERT INTO invoices (id, customer_id, invoice_date, amount)
SELECT  g                                                          AS id,
        (floor(1000 * power(random(), 1.7)) + 1)::bigint           AS customer_id,
        date '2024-01-01' + (random() * 700)::int                  AS invoice_date,
        (random() * 9999 + 1)::numeric(12,2)                       AS amount
FROM    generate_series(1, 50000) g;

-- ---- line_items -------------------------------------------------------------
-- Invoice choice skewed similarly so distribution of items per invoice varies.
INSERT INTO line_items (id, invoice_id, description, quantity, unit_price)
SELECT  g                                                          AS id,
        (floor(50000 * power(random(), 1.4)) + 1)::bigint          AS invoice_id,
        'item-' || g                                               AS description,
        (1 + (random() * 19)::int)                                 AS quantity,
        (random() * 199 + 1)::numeric(10,2)                        AS unit_price
FROM    generate_series(1, 500000) g;

ANALYZE customers;
ANALYZE invoices;
ANALYZE line_items;

-- Sanity stats: how many rows per owner, and the distribution.
\echo '--- customers per owner (top 5) ---'
SELECT owner_id, count(*) AS n_customers
FROM customers GROUP BY owner_id ORDER BY n_customers DESC LIMIT 5;

\echo '--- invoices per customer (summary) ---'
SELECT min(n), percentile_cont(0.5) WITHIN GROUP (ORDER BY n) AS p50,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY n) AS p90, max(n)
FROM (SELECT customer_id, count(*) AS n FROM invoices GROUP BY customer_id) t;

\echo '--- line_items per invoice (summary) ---'
SELECT min(n), percentile_cont(0.5) WITHIN GROUP (ORDER BY n) AS p50,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY n) AS p90, max(n)
FROM (SELECT invoice_id, count(*) AS n FROM line_items GROUP BY invoice_id) t;

\echo '--- candidate owners by reachable line_items ---'
SELECT c.owner_id, count(li.*) AS reachable_line_items
FROM customers c
JOIN invoices i  ON i.customer_id = c.id
JOIN line_items li ON li.invoice_id = i.id
GROUP BY c.owner_id
ORDER BY reachable_line_items
OFFSET 40 LIMIT 10;
