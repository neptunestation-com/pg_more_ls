-- Classic billing schema for RLS-EXISTS planner experiment.
-- Three tables, FK chain customers -> invoices -> line_items.

DROP TABLE IF EXISTS line_items CASCADE;
DROP TABLE IF EXISTS invoices   CASCADE;
DROP TABLE IF EXISTS customers  CASCADE;

CREATE TABLE customers (
    id        bigint PRIMARY KEY,
    owner_id  int    NOT NULL,
    name      text   NOT NULL
);

CREATE TABLE invoices (
    id           bigint PRIMARY KEY,
    customer_id  bigint NOT NULL REFERENCES customers(id),
    invoice_date date   NOT NULL,
    amount       numeric(12,2) NOT NULL
);

CREATE TABLE line_items (
    id          bigint PRIMARY KEY,
    invoice_id  bigint NOT NULL REFERENCES invoices(id),
    description text   NOT NULL,
    quantity    int    NOT NULL,
    unit_price  numeric(10,2) NOT NULL
);

CREATE INDEX customers_owner_id_idx ON customers (owner_id);
CREATE INDEX invoices_customer_id_idx ON invoices (customer_id);
CREATE INDEX line_items_invoice_id_idx ON line_items (invoice_id);
