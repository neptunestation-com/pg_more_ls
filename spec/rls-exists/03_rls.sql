-- RLS setup: non-superuser role, GUC, FORCE RLS, EXISTS-based policies.

-- Custom GUC namespace 'app' so SET LOCAL app.current_owner_id = N works.
DO $$
BEGIN
    -- Pre-register the GUC so we can SET LOCAL it. PG 17 allows custom_variable
    -- classes implicitly, but assigning at the system level here is harmless.
    PERFORM set_config('app.current_owner_id', '0', false);
END $$;

DROP ROLE IF EXISTS app_user;
CREATE ROLE app_user LOGIN PASSWORD 'app_user';
GRANT USAGE  ON SCHEMA public TO app_user;
GRANT SELECT ON customers, invoices, line_items TO app_user;

-- Enable + FORCE RLS so the table owner (postgres) is not exempted.
ALTER TABLE customers   ENABLE  ROW LEVEL SECURITY;
ALTER TABLE customers   FORCE   ROW LEVEL SECURITY;
ALTER TABLE invoices    ENABLE  ROW LEVEL SECURITY;
ALTER TABLE invoices    FORCE   ROW LEVEL SECURITY;
ALTER TABLE line_items  ENABLE  ROW LEVEL SECURITY;
ALTER TABLE line_items  FORCE   ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customers_select  ON customers;
DROP POLICY IF EXISTS invoices_select   ON invoices;
DROP POLICY IF EXISTS line_items_select ON line_items;

-- Note the (SELECT current_setting(...)) wrapper: this is the well-known
-- "init-plan trick" that lets the planner fold the value into an InitPlan
-- evaluated once per query, instead of re-evaluating it per row.

CREATE POLICY customers_select ON customers
    FOR SELECT
    USING (
        owner_id = (SELECT current_setting('app.current_owner_id'))::int
    );

CREATE POLICY invoices_select ON invoices
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM   customers c
            WHERE  c.id = invoices.customer_id
              AND  c.owner_id = (SELECT current_setting('app.current_owner_id'))::int
        )
    );

CREATE POLICY line_items_select ON line_items
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM   invoices i
            WHERE  i.id = line_items.invoice_id
              -- Note: we deliberately do NOT re-check owner here. The invoices
              -- policy fires when this EXISTS subquery is rewritten, so
              -- visibility cascades transitively.
        )
    );
