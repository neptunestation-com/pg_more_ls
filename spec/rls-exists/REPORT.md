# Does PostgreSQL flatten EXISTS inside RLS policies into a semi-join?

**Short answer: no.** A hand-written EXISTS chain is hoisted out of the
subquery and turned into a flattened join (a "subquery-pullup + dedup"
implementation of a semi-join). The same EXISTS chain inside an RLS policy
is **not** hoisted: it gets trapped behind a security-barrier wrapper and
becomes a `(hashed SubPlan)` filter on the table scan. The semantics are
correct, but the resulting plan is structurally different and, in this
benchmark, **~10–20× slower** than the hand-written equivalent.

PostgreSQL 17.7 on aarch64-linux (Debian image, `postgres:17`).

---

## 1. Setup

### 1.1 Container

```bash
docker run -d --name rls-exp -e POSTGRES_PASSWORD=postgres -p 55444:5432 postgres:17
```

`SELECT version()` → `PostgreSQL 17.7 (Debian 17.7-3.pgdg13+1) on aarch64-unknown-linux-gnu`.

### 1.2 Schema (`01_schema.sql`)

```sql
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
CREATE INDEX customers_owner_id_idx     ON customers  (owner_id);
CREATE INDEX invoices_customer_id_idx   ON invoices   (customer_id);
CREATE INDEX line_items_invoice_id_idx  ON line_items (invoice_id);
```

### 1.3 Data generation (`02_data.sql`)

Deterministic via `setseed(0.42)`. Owner assignment uses `floor(100 * r^2)+1`
so a few owners get many customers; invoice/customer assignment and
line-item/invoice assignment use similar power-law transforms to introduce
skew.

```sql
INSERT INTO customers (id, owner_id, name)
SELECT g, (floor(100 * power(random(), 2))   + 1)::int, 'customer-'||g
FROM   generate_series(1, 1000) g;

INSERT INTO invoices (id, customer_id, invoice_date, amount)
SELECT g, (floor(1000 * power(random(), 1.7))+ 1)::bigint,
          date '2024-01-01' + (random()*700)::int,
          (random()*9999 + 1)::numeric(12,2)
FROM   generate_series(1, 50000) g;

INSERT INTO line_items (id, invoice_id, description, quantity, unit_price)
SELECT g, (floor(50000*power(random(),1.4))  + 1)::bigint,
          'item-'||g, 1+(random()*19)::int, (random()*199+1)::numeric(10,2)
FROM   generate_series(1, 500000) g;

ANALYZE customers; ANALYZE invoices; ANALYZE line_items;
```

Resulting distribution:

| metric | min | p50 | p90 | max |
|---|---|---|---|---|
| invoices per customer | 16 | 40 | 76 | 831 |
| line_items per invoice | 1 | 9 | 15 | 209 |

Owner-50 (chosen as a representative "middle" owner) reaches **9 customers
→ 318 invoices → 3,317 line_items** — about 0.66% of the 500k line_items
table, selective enough that the planner clearly *should* prefer index-driven
joins over full scans.

### 1.4 RLS (`03_rls.sql`)

```sql
DROP ROLE IF EXISTS app_user;
CREATE ROLE app_user LOGIN PASSWORD 'app_user';
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT ON customers, invoices, line_items TO app_user;

ALTER TABLE customers  ENABLE ROW LEVEL SECURITY; ALTER TABLE customers  FORCE ROW LEVEL SECURITY;
ALTER TABLE invoices   ENABLE ROW LEVEL SECURITY; ALTER TABLE invoices   FORCE ROW LEVEL SECURITY;
ALTER TABLE line_items ENABLE ROW LEVEL SECURITY; ALTER TABLE line_items FORCE ROW LEVEL SECURITY;

CREATE POLICY customers_select ON customers FOR SELECT USING (
    owner_id = (SELECT current_setting('app.current_owner_id'))::int
);

CREATE POLICY invoices_select ON invoices FOR SELECT USING (
    EXISTS (SELECT 1 FROM customers c
            WHERE c.id = invoices.customer_id
              AND c.owner_id = (SELECT current_setting('app.current_owner_id'))::int)
);

CREATE POLICY line_items_select ON line_items FOR SELECT USING (
    EXISTS (SELECT 1 FROM invoices i WHERE i.id = line_items.invoice_id)
);
```

The line_items policy deliberately omits the owner_id re-check: visibility
cascades transitively through the invoices policy.

Smoke test as `app_user` returns the expected 9 / 318 / 3,317 rows.

---

## 2. The three variants

The logical query is "fetch all line items for the current owner's invoices."

* **A** — no RLS, explicit 3-way `JOIN` (run as `postgres`, which is BYPASSRLS).
* **B** — no RLS, hand-written nested `EXISTS`.
* **C** — RLS on, naive `SELECT * FROM line_items` as `app_user`.

All measurements use `EXPLAIN (ANALYZE, BUFFERS, VERBOSE)` with `jit = off`
(JIT compilation in the first hot pass of C added ~100ms of compile time;
disabling it gives cleaner steady-state numbers). Each variant was run 3
times after an initial warm-up.

### 2.1 Variant A — explicit JOIN

```
Nested Loop  (cost=9.44..1476.54 rows=4500 width=37) (actual time=0.039..9.930 rows=3317 loops=1)
  Output: li.id, li.invoice_id, li.description, li.quantity, li.unit_price
  Buffers: shared hit=4590
  ->  Nested Loop  (cost=9.02..962.31 rows=450 width=8) (actual time=0.025..0.976 rows=318 loops=1)
        Output: i.id
        Buffers: shared hit=324
        ->  Bitmap Heap Scan on public.customers c  (cost=4.34..12.87 rows=9 width=8) (actual time=0.010..0.022 rows=9 loops=1)
              Output: c.id, c.owner_id, c.name
              Recheck Cond: (c.owner_id = 50)
              Heap Blocks: exact=5
              Buffers: shared hit=7
              ->  Bitmap Index Scan on customers_owner_id_idx  (cost=0.00..4.34 rows=9 width=0) (actual time=0.006..0.006 rows=9 loops=1)
                    Index Cond: (c.owner_id = 50)
                    Buffers: shared hit=2
        ->  Bitmap Heap Scan on public.invoices i  (cost=4.68..104.99 rows=50 width=16) (actual time=0.014..0.099 rows=35 loops=9)
              Output: i.id, i.customer_id, i.invoice_date, i.amount
              Recheck Cond: (i.customer_id = c.id)
              Heap Blocks: exact=299
              Buffers: shared hit=317
              ->  Bitmap Index Scan on invoices_customer_id_idx  (cost=0.00..4.67 rows=50 width=0) (actual time=0.008..0.008 rows=35 loops=9)
                    Index Cond: (i.customer_id = c.id)
                    Buffers: shared hit=18
  ->  Index Scan using line_items_invoice_id_idx on public.line_items li  (cost=0.42..1.02 rows=12 width=37) (actual time=0.006..0.026 rows=10 loops=318)
        Output: li.id, li.invoice_id, li.description, li.quantity, li.unit_price
        Index Cond: (li.invoice_id = i.id)
        Buffers: shared hit=4266
Planning:
  Buffers: shared hit=315
Planning Time: 0.675 ms
Execution Time: 10.137 ms
```

Three nested loops driven from the most selective side: bitmap-index lookup
on `customers(owner_id=50)` → 9 rows → bitmap-index lookup on
`invoices(customer_id=c.id)` → 318 rows → btree lookup on
`line_items(invoice_id=i.id)` → 3,317 rows. **No SubPlan, no Semi Join.**

### 2.2 Variant B — hand-written nested EXISTS

```
Nested Loop  (cost=963.86..1482.17 rows=4500 width=37) (actual time=0.449..3.903 rows=3317 loops=1)
  Output: li.id, li.invoice_id, li.description, li.quantity, li.unit_price
  Buffers: shared hit=4590
  ->  HashAggregate  (cost=963.44..967.94 rows=450 width=8) (actual time=0.442..0.482 rows=318 loops=1)
        Output: i.id
        Group Key: i.id
        Batches: 1  Memory Usage: 45kB
        Buffers: shared hit=324
        ->  Nested Loop  (cost=9.02..962.31 rows=450 width=8) (actual time=0.026..0.378 rows=318 loops=1)
              Output: i.id
              Buffers: shared hit=324
              ->  Bitmap Heap Scan on public.customers c  (cost=4.34..12.87 rows=9 width=8) (actual time=0.014..0.019 rows=9 loops=1)
                    Output: c.id, c.owner_id, c.name
                    Recheck Cond: (c.owner_id = 50)
                    Heap Blocks: exact=5
                    Buffers: shared hit=7
                    ->  Bitmap Index Scan on customers_owner_id_idx  (cost=0.00..4.34 rows=9 width=0) (actual time=0.009..0.009 rows=9 loops=1)
                          Index Cond: (c.owner_id = 50)
                          Buffers: shared hit=2
              ->  Bitmap Heap Scan on public.invoices i  (cost=4.68..104.99 rows=50 width=16) (actual time=0.007..0.035 rows=35 loops=9)
                    Output: i.id, i.customer_id, i.invoice_date, i.amount
                    Recheck Cond: (i.customer_id = c.id)
                    Heap Blocks: exact=299
                    Buffers: shared hit=317
                    ->  Bitmap Index Scan on invoices_customer_id_idx  (cost=0.00..4.67 rows=50 width=0) (actual time=0.003..0.003 rows=35 loops=9)
                          Index Cond: (i.customer_id = c.id)
                          Buffers: shared hit=18
  ->  Index Scan using line_items_invoice_id_idx on public.line_items li  (cost=0.42..1.02 rows=12 width=37) (actual time=0.003..0.009 rows=10 loops=318)
        Output: li.id, li.invoice_id, li.description, li.quantity, li.unit_price
        Index Cond: (li.invoice_id = i.id)
        Buffers: shared hit=4266
Planning:
  Buffers: shared hit=26
Planning Time: 0.284 ms
Execution Time: 4.086 ms
```

**The EXISTS chain was fully flattened.** What was once a nested
correlated subquery is now an inner Nested Loop (`customers ⋈ invoices`)
producing 318 invoice ids, deduplicated through a `HashAggregate`, then
joined to `line_items` by index. There is no `SubPlan` node and no
`Semi Join` node — instead the planner used the canonical "subquery pullup
+ HashAggregate dedup + inner join" lowering for an EXISTS semi-join. (The
HashAggregate is the deduplication side; the `Group Key: i.id` makes it a
unique-by-id projection. The `Semi Join` node label would have been the
*other* possible lowering — explicit semi-join cardinality semantics — and
the planner picked dedup-then-join as cheaper here. See §3.3 for what
"Semi Join" actually means in `EXPLAIN`.)

### 2.3 Variant C — RLS, naive query

```
Seq Scan on public.line_items  (cost=0.00..8325417.00 rows=250000 width=37) (actual time=105.299..128.079 rows=3317 loops=1)
  Output: line_items.id, line_items.invoice_id, line_items.description, line_items.quantity, line_items.unit_price
  Filter: (ANY (line_items.invoice_id = (hashed SubPlan 14).col1))
  Rows Removed by Filter: 496683
  Buffers: shared hit=4542
  SubPlan 14
    ->  Seq Scan on public.invoices i  (cost=0.00..417118.00 rows=25000 width=8) (actual time=6.387..8.649 rows=318 loops=1)
          Output: i.id
          Filter: (ANY (i.customer_id = (hashed SubPlan 13).col1))
          Rows Removed by Filter: 49682
          Buffers: shared hit=375
          SubPlan 13
            ->  Result  (cost=4.40..12.93 rows=10 width=8) (actual time=0.027..0.032 rows=9 loops=1)
                  Output: c.id
                  One-Time Filter: (((InitPlan 12).col1)::integer = ((InitPlan 11).col1)::integer)
                  Buffers: shared hit=7
                  InitPlan 11
                    ->  Result  (cost=0.00..0.01 rows=1 width=32) (actual time=0.004..0.004 rows=1 loops=1)
                          Output: current_setting('app.current_owner_id'::text)
                  InitPlan 12
                    ->  Result  (cost=0.00..0.01 rows=1 width=32) (actual time=0.001..0.001 rows=1 loops=1)
                          Output: current_setting('app.current_owner_id'::text)
                  ->  Bitmap Heap Scan on public.customers c  (cost=4.40..12.93 rows=10 width=8) (actual time=0.020..0.025 rows=9 loops=1)
                        Output: c.id, c.owner_id, c.name
                        Recheck Cond: (c.owner_id = ((InitPlan 11).col1)::integer)
                        Heap Blocks: exact=5
                        Buffers: shared hit=7
                        ->  Bitmap Index Scan on customers_owner_id_idx  (cost=0.00..4.36 rows=10 width=0) (actual time=0.010..0.010 rows=9 loops=1)
                              Index Cond: (c.owner_id = ((InitPlan 11).col1)::integer)
                              Buffers: shared hit=2
Planning:
  Buffers: shared hit=196
Planning Time: 1.011 ms
JIT:
  Functions: 51
  Options: Inlining true, Optimization true, Expressions true, Deforming true
  Timing: Generation 1.243 ms (Deform 0.312 ms), Inlining 47.273 ms, Optimization 30.327 ms, Emission 25.152 ms, Total 103.994 ms
Execution Time: 146.132 ms
```

**Fundamentally different shape.** The outer node is a full sequential
scan of `line_items`. Filtered against `(hashed SubPlan 14)`, which is
itself a Seq Scan of `invoices` filtered by `(hashed SubPlan 13)` on
`customers`. The two nested EXISTS expressions from the policies were not
pulled up into joins — instead the planner kept them as subqueries and
applied the "hashed SubPlan" optimization, which executes the inner
expression *once*, materializes the result set into an in-memory hash
table, and then probes it per outer row.

The InitPlan-cached `current_setting('app.current_owner_id')` works as
intended — you can see InitPlan 11 / 12 evaluating once. So the GUC
lookup isn't the bottleneck; the structural shape of the plan is.

Per-pass timings (warm cache, `jit = off`):

| Variant | run 1 | run 2 | run 3 |
|---|---|---|---|
| A — explicit JOIN     | 6.62 ms | 2.91 ms | 2.51 ms |
| B — hand EXISTS chain | 2.36 ms | 1.66 ms | 1.73 ms |
| C — RLS naive         | 44.39 ms | 26.78 ms | 21.93 ms |

C is ~10–20× slower than A or B; the steady-state cost is dominated by a
500k-row Seq Scan and 496,683 rows being rejected by the filter.

---

## 3. What each plan tells us

### 3.1 Variant A: plain old indexed nested-loop join

The user's JOIN is a regular inner join. The planner picks the most
selective source (customers via `owner_id` index), drives nested loops
outward, and reads only 4,590 buffer pages. Nothing surprising.

### 3.2 Variant B: EXISTS gets hoisted into the join tree

The defining feature: the EXISTS chain has been *flattened* (in PostgreSQL
optimizer terms, "pulled up" via `convert_EXISTS_to_ANY` /
`pull_up_sublinks`). What was conceptually two nested correlated
subqueries becomes a single join tree topped by a deduplicator.

Two observations worth noting:

1. **No explicit "Semi Join" node.** Despite this being a semantic
   semi-join, the planner's lowering choice is "subquery pullup + dedup
   the inner side + plain Nested Loop". That's mathematically equivalent
   to a semi-join and shares performance characteristics, but it's a
   different physical strategy than `Hash Semi Join` or
   `Nested Loop Semi Join`. With a less-selective owner (probe 11) the
   planner switched the inner subjoin to a `Hash Join` but still finished
   with `HashAggregate` + `Nested Loop` instead of a `Hash Semi Join` —
   *the planner did not produce a "Semi Join" node in any variant I tried*.
2. **Disabling hashjoin/mergejoin did not change B's plan** — already a
   Nested Loop — but it confirms the dedup-then-join path is not contingent
   on hash join availability.

### 3.3 Variant C: EXISTS is trapped behind a security barrier

The RLS rewriter doesn't just stitch the policy expression into the WHERE
clause. Each table reference is wrapped in an implicit `securityQuals`
subquery flagged as a *security barrier*. The barrier is what stops the
planner from pulling the policy EXISTS up into the user's query tree, and
it exists for sound reasons: the qual evaluation order has to be
controllable so a malicious "leaky" operator in a user predicate can't see
rows the policy would have hidden.

Inside the barrier, though, the planner can still simplify. It converts
`EXISTS (SELECT 1 FROM invoices WHERE ...)` into the IN-style
`(ANY (... = (hashed SubPlan).col1))`. A "hashed SubPlan" is itself an
optimization — the subquery is evaluated once at startup and its results
cached in an in-memory hash table; subsequent probes are O(1). So
**Variant C is not a correlated-subquery plan executed per row** in the
worst sense. It is a single-evaluation, hash-cached SubPlan. That is one
step better than a fully correlated SubPlan but two steps worse than a
flattened join, because:

* the planner cannot push the predicate down into a `line_items`
  index scan — it has no `invoice_id IN (small_set)` it can hand to the
  btree — so the line_items table is read in full;
* it never gets the chance to choose a join ordering; the order is fixed
  by the policy structure ("filter line_items by EXISTS over invoices");
* there is no chance to use a `Nested Loop Semi Join` driven by the
  small customer-side, which is what makes Variant A and B fast.

Probe outputs that confirm the security-barrier hypothesis:

* **Probe 2a** (Variant C with `enable_seqscan = off`): the planner falls
  back to a true correlated SubPlan — `Index Scan using invoices_pkey`
  with `loops=500000`, 312 ms total. This is the worst case, but it
  proves the planner has access to correlated execution and chose
  hashed-SubPlan over it on cost grounds — both happen *inside* the
  barrier; *neither* path produced a real join with `line_items`.
* **Probe 2c** (Variant C with `enable_hashjoin = off` AND
  `enable_mergejoin = off`): plan is **unchanged**. The hashed-SubPlan
  filter is not a join, so disabling join methods doesn't affect it.
  This is the smoking gun: if the planner *could* produce a semi-join
  for this query, those toggles would have made it visible. They don't.

### 3.4 What if the user writes the JOIN under RLS? (Probe 2b)

```sql
SELECT li.* FROM line_items li
JOIN invoices  i ON i.id = li.invoice_id
JOIN customers c ON c.id = i.customer_id
WHERE c.owner_id = (SELECT current_setting('app.current_owner_id'))::int;
```

This is the same query Variant A submits, just under the RLS regime.
Plan:

```
Result  (One-Time Filter on InitPlans)
  Nested Loop                                       <- li × (c ⋈ i)
    Nested Loop                                     <- c ⋈ i
      Index Scan on customers c                     <- c's policy as filter
      Bitmap Heap Scan on invoices i
        Filter: ANY (customer_id = (hashed SubPlan 21).col1)  <- i's policy
    Index Scan on line_items li
      Filter: EXISTS(SubPlan 8)                     <- li's policy, per-row
        Index Scan on invoices i_1 (loops=3317)
          Filter: ANY (customer_id = (hashed SubPlan 7).col1) <- i's policy AGAIN
```

Two observations:

1. The **user's** join structure (li × i × c) is preserved as joins —
   the planner is happy to do that just like Variant A. The plan runs in
   ~3.5 ms.
2. But each table reference still carries its own policy, and the
   line_items policy's EXISTS is *still* a per-row SubPlan against a
   per-row index scan of invoices (3,317 loops). This is now cheap
   because there are only 3,317 outer rows, but the policy machinery is
   still there. The cost was 14k+ buffer hits versus ~4.6k for variants
   A and B.

So the security-barrier wrapper isn't a death sentence — it just prevents
the *policy* EXISTS from being flattened. The *user* query above it is
free to be flattened normally. A developer working around the RLS
penalty by writing the join explicitly gets most of the speed back
(~3.5 ms vs 22 ms), at the cost of relying on the line_items policy's
predicate to be cheap to evaluate per-row.

### 3.5 What if the policy is a flat column predicate? (Probe 3)

Adding a denormalized `owner_id` column to `line_items` and changing the
policy to `owner_id = (SELECT current_setting(...))::int` (no EXISTS at
all):

```
Bitmap Heap Scan on line_items  (cost=59.19..7973.40 rows=5000 width=41) (actual time=0.289..1.475 rows=3317 loops=1)
  Recheck Cond: (owner_id = ((InitPlan 1).col1)::integer)
  Buffers: shared hit=2393 read=5
  InitPlan 1
    ->  Result  (current_setting('app.current_owner_id'))
  ->  Bitmap Index Scan on line_items_owner_id_idx (rows=3317)
```

**1.5 ms execution.** This is the ideal: an indexable predicate that the
security-barrier wrapping doesn't impede because there's no subquery to
flatten in the first place — the policy collapses to `column = constant`
once the InitPlan resolves.

So the penalty we are observing in Variant C is specifically a penalty for
having an **EXISTS-based RLS policy**, not RLS in general.

---

## 4. Direct answer to the central question

> Does the planner produce semi-join nodes in Variant B and Variant C, or
> correlated subplan nodes?

Neither variant produces a named `Semi Join` node — but the *effective*
treatment is very different:

| | What the planner does | Effective shape |
|---|---|---|
| **B** | Pulls up the EXISTS chain into the outer join tree; dedups the right-hand side with HashAggregate; uses a regular inner join | A flattened semi-join, implemented as "pullup + dedup + join" |
| **C** | Wraps the policy in a security-barrier subquery; cannot pull up across the barrier; lowers the EXISTS to a `(hashed SubPlan)` filter on the table scan | A single-evaluation hashed-set filter; no join formed between `line_items` and `invoices`/`customers` |

> Are the plans for B and C structurally similar?

**No.** Variant B drives the plan from the most selective table
(customers, 9 rows) outward into line_items via indexed nested loops.
Variant C drives the plan from `line_items` and filters it against a
materialized set — there is no join between line_items and its parents
in the C plan at all. They share neither node ordering, nor join
strategy, nor scan choice on `line_items`.

> Does the RLS policy get flattened into a semi-join like the hand-written
> EXISTS?

**No.** The RLS rewriter installs the policy as a `securityQuals`
subquery marked as a *security barrier*. PostgreSQL's subquery-pullup
pass refuses to flatten security-barrier subqueries (this is enforced in
`is_simple_subquery()` in `src/backend/optimizer/prep/prepjointree.c`).
The EXISTS lives the rest of its life as a SubPlan-form filter on the
table scan — at best a hashed SubPlan (single evaluation, hash-probed),
at worst a per-row correlated SubPlan if the hashed form is unavailable.

> How does Variant A compare?

In this benchmark Variant A (explicit JOIN, no RLS) is slightly slower
than B because A has to materialize a `customer × invoice` join in the
middle whereas B benefits from HashAggregate deduplication first. Both
are dominated by the same outer Nested Loop into `line_items`. At a less
selective owner (owner_id = 1, 105 customers, 50k line items) the
ordering flipped — A: 29 ms, B: 53 ms — because B's dedup step became
more expensive while A's plain hash-then-nested-loop did not. The
practical takeaway is that A and B are within 2× of each other across
selectivities and the choice between them is cost-driven; C is in a
different performance class entirely.

---

## 5. Caveats and surprises

* **No `Semi Join` node ever materialized.** I ran the experiment across
  multiple selectivity points and planner toggles, and never observed
  `Hash Semi Join`, `Merge Semi Join`, or `Nested Loop Semi Join` in
  the plans for B or anywhere else. PostgreSQL appears to prefer the
  pullup-and-dedup lowering for two-level EXISTS chains in this shape.
  The `Semi Join` node *type* exists in the planner, but on these
  queries the cost model consistently chose another path. This is
  worth flagging because the original question framed "semi-join nodes"
  as the success signal, when really the structural success signal is
  "EXISTS got hoisted into the join tree", which B exhibits and C does
  not.
* **The "hashed SubPlan" idiom in C is not the worst case.** It looks
  superficially like a correlated SubPlan but only evaluates the inner
  query once. The actual worst case is what Probe 2a triggers
  (`enable_seqscan = off`): a true per-row correlated SubPlan, 500k
  loops, 312 ms.
* **JIT inflates the cold-cache timing of Variant C** by 100+ ms because
  the planner's estimated cost crosses the JIT threshold (8.3M default
  cost units; default `jit_above_cost = 100000`). The cost estimate
  itself is wildly inflated — `rows=250000` versus actual `rows=3317`
  — because PostgreSQL can't get a good selectivity estimate from a
  hashed-SubPlan filter. With `jit = off` the C plan runs in ~22 ms;
  with `jit = on` it runs in ~146 ms the first time and then ~25 ms
  thereafter (JIT cache is per-session/backend).
* **The `(SELECT current_setting(...))` InitPlan pattern works.** You
  can see InitPlans 11 and 12 evaluating exactly once in the Variant C
  plan. Reading the GUC isn't the problem.
* **`auto_explain.log_nested_statements` was not needed.** Because the
  policy expressions get inlined into the query tree before planning,
  the full structure (including the policy-injected SubPlans) is visible
  in regular `EXPLAIN ANALYZE` output. There are no "hidden" nested
  statements to dump; what you see is what's running.
* **The performance asymmetry is *specific* to EXISTS policies.** A
  column-based policy with the same `(SELECT current_setting(...))`
  InitPlan pattern was the fastest plan of all (1.5 ms) because it
  collapses to a plain indexable predicate. So the practical lesson is:
  **don't write RLS policies as EXISTS chains if you can avoid them**;
  denormalize an `owner_id` (or tenant_id, or whatever) onto every
  table that needs to be filtered, and write the policies as
  `column = current_owner`. This is a well-known piece of Supabase /
  PostgreSQL RLS folklore, and the experiment here gives it a clean
  mechanistic explanation: the security barrier prevents the planner
  from making the join the user expected.

---

## 6. Reproduction

Files in this directory (`out/rls-exists/`):

* `01_schema.sql` — schema & indexes
* `02_data.sql` — synthetic data + ANALYZE
* `03_rls.sql` — role, GUC, policies
* `04_variants.sql` — Variants A and B (run as superuser)
* `05_variant_c.sql` — Variant C (run as `app_user`)
* `06_warm_runs.sql`, `07_warm_c.sql` — 3-run warm cache passes
* `08_probes.sql`, `09_probes_c.sql` — planner toggles on B and C
* `10_probes_minimal.sql` — flat column policy comparison
* `11_probe_skew.sql` — heaviest-owner sensitivity
* `*.txt` — captured psql output for each script

To rerun from scratch:

```bash
docker run -d --name rls-exp -e POSTGRES_PASSWORD=postgres -p 55444:5432 postgres:17
until pg_isready -h localhost -p 55444 -U postgres; do sleep 1; done
PG="psql -h localhost -p 55444 -U postgres -v ON_ERROR_STOP=1"
PGPASSWORD=postgres $PG -f 01_schema.sql
PGPASSWORD=postgres $PG -f 02_data.sql
PGPASSWORD=postgres $PG -f 03_rls.sql
PGPASSWORD=postgres $PG -f 04_variants.sql
PGPASSWORD=app_user  $PG -U app_user -d postgres -f 05_variant_c.sql
```
