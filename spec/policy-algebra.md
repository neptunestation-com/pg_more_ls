# Formal Specification of the Policy Algebra

**Version**: 1.0
**Date**: 2026-02-21
**Status**: Draft

## Abstract

This document formally specifies a *policy algebra* for PostgreSQL Row-Level
Security (RLS). The algebra defines a decidable domain-specific language whose
expressions compile deterministically to native PostgreSQL security artifacts.
By restricting the language to atoms, clauses, and policies composed under
well-defined lattice operations, the system enables static analysis —
satisfiability, subsumption, redundancy, contradiction, and tenant-isolation
proofs — that is impossible over arbitrary SQL. The specification spans the
full governance lifecycle: definition, analysis, optimization, compilation,
drift detection, and reconciliation.

## Notation Conventions

| Symbol | Meaning                                                  |
|--------|----------------------------------------------------------|
| ∧      | Logical conjunction (AND)                                |
| ∨      | Logical disjunction (OR)                                 |
| ¬      | Logical negation (NOT)                                   |
| ⊥      | Falsity / unsatisfiable / contradiction                  |
| ⊤      | Truth / tautology                                        |
| ⊆      | Subset or subsumption                                    |
| ⊇      | Superset                                                 |
| ⊑      | Lattice ordering (less restrictive than or equal)        |
| ⊔      | Lattice join (least upper bound)                         |
| ⊓      | Lattice meet (greatest lower bound)                      |
| △      | Symmetric difference                                     |
| ⟦·⟧    | Denotation (semantic interpretation)                     |
| ⊢      | Entailment / proves                                      |
| ∀      | Universal quantifier                                     |
| ∃      | Existential quantifier                                   |
| →      | Implication or maps-to                                   |
| ∅      | Empty set                                                |
| ∈      | Set membership                                           |
| ∉      | Not a member of                                          |
| ≡      | Logical equivalence                                      |
| ⊒      | Reverse lattice ordering (more permissive than or equal) |
| 𝒫      | Power set                                                |
| ⋁      | Indexed disjunction (big OR)                             |
| ⋀      | Indexed conjunction (big AND)                            |
| \|S\|  | Cardinality of set S                                     |

## Running Example Schema

The specification uses the following multi-tenant SaaS schema throughout. ASCII
diagram showing tables, primary keys, foreign keys, and the presence or absence
of `tenant_id`:

```
┌──────────────────┐       ┌──────────────────┐
│     tenants      │       │      users       │
├──────────────────┤       ├──────────────────┤
│ id          PK   │◄──┐   │ id          PK   │
│ name             │   │   │ tenant_id   FK───┼──┐
│ plan             │   │   │ email            │  │
└──────────────────┘   │   │ role             │  │
                       │   └──────────────────┘  │
                       │                         │
    ┌──────────────────┼─────────────────────────┘
    │                  │
    │   ┌──────────────────┐       ┌──────────────────┐
    │   │    projects      │       │      tasks       │
    │   ├──────────────────┤       ├──────────────────┤
    │   │ id          PK   │◄──────│ project_id  FK   │
    ├──►│ tenant_id   FK   │       │ id          PK   │
    │   │ name             │       │ title            │
    │   │ owner_id    FK───┼──►users│ assignee_id FK──┼──►users
    │   │ is_deleted  bool │       │ status           │
    │   └──────────────────┘       └──────────────────┘
    │
    │   ┌──────────────────┐       ┌──────────────────┐
    │   │    comments      │       │      files       │
    │   ├──────────────────┤       ├──────────────────┤
    │   │ id          PK   │       │ id          PK   │
    ├──►│ tenant_id   FK   │       │ project_id  FK───┼──►projects
    │   │ task_id     FK───┼──►tasks│ name            │
    │   │ author_id   FK───┼──►users│ size            │
    │   │ body             │       └──────────────────┘
    │   └──────────────────┘
    │
    │   ┌──────────────────┐
    │   │     config       │
    │   ├──────────────────┤
    │   │ key         PK   │       ◄── NOTE: no tenant_id
    │   │ value            │
    └───┤                  │
        └──────────────────┘
```

**Key observations**:

- `users`, `projects`, `comments` carry `tenant_id` directly.
- `tasks` and `files` inherit tenant context through FK to `projects`.
- `config` has no `tenant_id` — it is a global table, unaffected by tenant-isolation selectors.

---

## 1. Introduction & Motivation

### 1.1 The Problem: Arbitrary RLS Is Undecidable

PostgreSQL Row-Level Security allows attaching arbitrary SQL predicates to
tables via `CREATE POLICY`. These predicates execute as part of every query,
filtering rows according to security rules. The mechanism is powerful: any
boolean SQL expression is a valid RLS predicate.

This power is also the fundamental problem. SQL is Turing-complete. An RLS
predicate may invoke user-defined functions, reference arbitrary subqueries,
or encode complex recursive logic. As a consequence:

**Theorem 1.1** (Undecidability of arbitrary RLS). *Given an arbitrary set of
RLS policies expressed as SQL predicates, determining whether a given row is
accessible to a given user is undecidable in general.*

*Sketch*. Reduce from the halting problem. Encode a Turing machine's transition
function as a PL/pgSQL function invoked within an RLS `USING` clause. The
predicate returns `true` if and only if the machine halts. Determining row
accessibility therefore requires solving the halting problem. ∎

This undecidability means that no tool can, in general:

- Prove that tenant isolation holds across all policies
- Detect contradictory policies that block all access
- Identify redundant policies that can be safely removed
- Verify that a policy change preserves the intended access semantics

Organizations managing hundreds of tables and dozens of interacting policies
face an intractable verification burden if policies are authored as raw SQL.

### 1.2 The Compiler Insight

The solution is a shift in perspective: *do not analyze arbitrary SQL; instead,
generate SQL from a language where analysis is decidable.*

This is precisely the strategy used by optimizing compilers. A compiler does
not reason about arbitrary machine code. It operates on a structured
intermediate representation (IR) where transformations are provably correct,
then emits machine code as a final step.

Applied to RLS:

1. Define a **domain-specific language** (DSL) with restricted expressiveness.
2. Perform all **analysis and optimization** on the DSL's abstract syntax tree.
3. **Compile** the DSL deterministically to PostgreSQL `CREATE POLICY` statements.

RLS becomes a *compilation target*, not an authoring surface. The DSL is
designed so that the properties we care about — satisfiability, subsumption,
isolation — are decidable by construction.

### 1.3 Relationship to Prior Work

The algebra draws on five established formalisms, each covering a distinct
aspect of the system:

**Bonatti et al.'s access-control algebra** (2002). Bonatti, De Capitani di
Vimercati, and Samarati formalized access-control policies as algebraic
objects supporting union (grant), intersection (restriction), and difference
(exception) operations. Our permissive/restrictive composition directly
corresponds to their grant/restriction operators. The effective access
predicate `(∨ permissive) ∧ (∧ restrictive)` is an instance of their
composition framework.

**Lattice theory**. Policies ordered by subsumption form a lattice. The join
(⊔) corresponds to disjunction of permissive policies; the meet (⊓) to
conjunction of restrictive policies. Redundancy detection reduces to
identifying elements dominated by existing lattice members.

**SMT solving** (Satisfiability Modulo Theories). The atoms of our algebra —
column comparisons with session variables and literals — fall within the
quantifier-free fragments of linear integer arithmetic (QF-LIA) and equality
with uninterpreted functions (QF-EUF). These are decidable theories supported
by solvers such as Z3 and cvc5. We use SMT to check clause satisfiability,
detect contradictions, and prove tenant isolation.

**Formal Concept Analysis** (Ganter & Wille). Selectors — predicates over
table metadata — define a Galois connection between the power set of tables
and the power set of structural attributes. The closed sets (formal concepts)
correspond to natural groupings of tables sharing common structure, providing
a principled foundation for policy targeting.

**Galois connections for compiler correctness**. The compilation function from
DSL policies to SQL artifacts, paired with the denotational semantics of each,
forms a Galois connection. This structure provides the framework for stating
and proving that compilation preserves the intended access semantics.

### 1.4 Scope and Audience

This specification covers the **full lifecycle** of the policy algebra:

- **Definition**: atoms, clauses, policies, selectors, relationship traversal
- **Analysis**: satisfiability, subsumption, redundancy, contradiction, isolation
- **Optimization**: rewrite rules, normal forms, termination
- **Compilation**: deterministic translation to PostgreSQL artifacts
- **Monitoring**: drift detection and reconciliation

The intended audience is **senior engineers** implementing or evaluating the
policy engine, as well as researchers interested in the formal foundations of
database access control.

---

## 2. Atoms & Value Sources

Atoms are the irreducible predicates of the policy algebra. Every policy
ultimately reduces to a boolean combination of atoms, each representing a
single comparison.

### 2.1 Value Sources

A **value source** produces a scalar value for comparison. The algebra
recognizes four kinds:

**Definition 2.1** (Value source).
```
ValueSource ::= col(name)
              | session(key)
              | lit(v)
              | fn(name, args)
```

Where:

- `col(name)` — references a column of the table to which the policy is
  attached. The column must exist in the table's schema. Example: `col('tenant_id')`.

- `session(key)` — retrieves a runtime session variable via PostgreSQL's
  `current_setting(key)`. Example: `session('app.tenant_id')` compiles to
  `(SELECT current_setting('app.tenant_id'))`, with a `::T` cast appended
  when used in a comparison against a non-text column of type `T`
  (§ 10.2, `session_expr`).

- `lit(v)` — a literal constant value: string, integer, boolean, or null.
  Example: `lit('admin')`, `lit(42)`, `lit(true)`.

- `fn(name, args)` — a call to a whitelisted, pure, deterministic function.
  The function must be registered in the policy engine's function allowlist.
  Example: `fn('auth.uid', [])` compiles to `auth.uid()`.

**Definition 2.2** (Value source type). Each value source has an associated
type drawn from `{text, integer, bigint, uuid, boolean, timestamp, jsonb}`.
Type compatibility is enforced at policy definition time, not at compilation.

### 2.2 Atoms

**Definition 2.3** (Atom). An atom is a triple `(left, op, right)` where:
- `left` and `right` are value sources
- `op` is a comparison operator from the set `{=, !=, <, >, <=, >=, IN, NOT IN, IS NULL, IS NOT NULL, LIKE, NOT LIKE}`

For unary operators (`IS NULL`, `IS NOT NULL`), `right` is omitted (or equivalently, `right = lit(null)`).

BNF fragment:

```
<atom>         ::= <value_source> <binary_op> <value_source>
                 | <value_source> <unary_op>

<binary_op>    ::= "=" | "!=" | "<" | ">" | "<=" | ">="
                 | "IN" | "NOT IN" | "LIKE" | "NOT LIKE"

<unary_op>     ::= "IS NULL" | "IS NOT NULL"

<value_source> ::= "col(" <identifier> ")"
                 | "session(" <string_literal> ")"
                 | "lit(" <literal_value> ")"
                 | "fn(" <identifier> "," "[" <arg_list> "]" ")"
```

**Examples**:

| Atom                                              | Informal meaning                    |
|---------------------------------------------------|-------------------------------------|
| `(col('tenant_id'), =, session('app.tenant_id'))` | Row's tenant matches session tenant |
| `(col('role'), =, lit('admin'))`                  | User role is admin                  |
| `(col('is_deleted'), =, lit(false))`              | Row is not soft-deleted             |
| `(col('status'), IN, lit(['active', 'pending']))` | Status is active or pending         |
| `(col('deleted_at'), IS NULL, _)`                 | No deletion timestamp               |

### 2.3 Atom Normal Form

To enable comparison and deduplication, atoms are normalized to a canonical
form.

**Definition 2.4** (Atom normal form). An atom is in normal form when:

1. **Column-left ordering**: if exactly one operand is `col(...)`, it appears
   on the left. If both are columns, they are ordered lexicographically by
   column name.
2. **Operator canonicalization**: `>` is rewritten to `<` (with operands
   swapped); `>=` to `<=`; `!=` to `NOT =`.
3. **Literal simplification**: `lit(true)` in a boolean equality is absorbed
   (e.g., `col('active') = lit(true)` normalizes to `col('active') IS NOT NULL`
   only for boolean columns where null means false; otherwise left as-is).

**Algorithm**: `normalize_atom(a) → a'` applies rules 1–3 in sequence.

### 2.4 Atom Equivalence and Subsumption

**Definition 2.5** (Atom equivalence). Two atoms `a₁` and `a₂` are equivalent,
written `a₁ ≡ a₂`, if and only if their normal forms are syntactically
identical.

**Definition 2.6** (Atom subsumption). Atom `a₁` subsumes atom `a₂`, written
`a₁ ⊑ a₂`, if every row satisfying `a₂` also satisfies `a₁`. Equivalently,
`a₂ ⊢ a₁` (a₂ entails a₁).

Examples of subsumption:

- `col('x') IS NOT NULL` ⊑ `col('x') = lit(5)` — equality implies non-null
- `col('x') IN lit([1,2,3])` ⊑ `col('x') IN lit([1,2])` — subset of IN-list

### 2.5 Decidability of Atom Satisfiability

**Property 2.1** (Decidability). *The satisfiability of any finite conjunction
of atoms is decidable.*

*Proof sketch*. Each atom translates to a formula in the quantifier-free
theory of linear integer arithmetic with equality and uninterpreted functions
(QF-LIA ∪ QF-EUF). Column references become free variables; session variables
become distinct free variables; literals become constants. The conjunction of
translated atoms is a QF-LIA/EUF formula, which is decidable by the
Nelson-Oppen combination procedure as implemented in SMT solvers. ∎

---

## 3. Clauses

A clause is the fundamental unit of row-level access control: a conjunction of
atoms that must all be satisfied for a row to match.

### 3.1 Definition

**Definition 3.1** (Clause). A clause `c` is a finite set of atoms, interpreted
as their conjunction:

```
c = {a₁, a₂, ..., aₙ}     meaning     a₁ ∧ a₂ ∧ ... ∧ aₙ
```

The empty clause `{}` is the trivial clause, equivalent to `⊤` (always true).

BNF fragment:

```
<clause>    ::= <atom>
              | <atom> "AND" <clause>
```

### 3.2 Clause Normal Form

**Definition 3.2** (Clause normal form). A clause is in normal form when:

1. Every constituent atom is in atom normal form (Def. 2.4).
2. Atoms are sorted lexicographically by their normal-form string representation.
3. Duplicate atoms (by equivalence, Def. 2.5) are removed.
4. If any pair of atoms is contradictory, the entire clause is replaced by `⊥`.

A pair of atoms is contradictory when their conjunction is unsatisfiable. Common
cases detected syntactically:

- `col(x) = lit(v₁)` ∧ `col(x) = lit(v₂)` where `v₁ ≠ v₂`
- `col(x) IS NULL` ∧ `col(x) = lit(v)` for any non-null `v`
- `col(x) = lit(v)` ∧ `col(x) != lit(v)`

**Algorithm**: `normalize_clause(c) → c'`:

```
function normalize_clause(c):
    c' ← {normalize_atom(a) | a ∈ c}
    c' ← deduplicate(c')
    if has_syntactic_contradiction(c'):
        return ⊥
    return sort(c')
```

### 3.3 Clause Properties

**Property 3.1** (Clause satisfiability). *A normalized clause `c` is
satisfiable if and only if `c ≠ ⊥`. For non-syntactic contradictions, SMT
solving (Property 2.1) provides a complete decision procedure.*

**Property 3.2** (Clause subsumption). *Clause `c₁` subsumes clause `c₂`,
written `c₁ ⊑ c₂`, if and only if every atom in `c₁` is subsumed by some atom
in `c₂` or implied by the conjunction of atoms in `c₂`.*

A sufficient syntactic check: `c₁ ⊆ c₂` (every atom in c₁ appears in c₂)
implies `c₂ ⊑ c₁`. Note the direction: more atoms means more constraints,
hence fewer matching rows, hence the clause with more atoms is subsumed by
(is less permissive than) the clause with fewer atoms.

More precisely: if `c₁ ⊆ c₂` then `⟦c₂⟧ ⊆ ⟦c₁⟧` (the denotation of c₂ is a
subset of the denotation of c₁), so `c₁ ⊑ c₂` in the "more permissive"
ordering.

**Property 3.3** (Idempotence). *For any clause `c`: `c ∧ c = c`.*

*Proof*. Clause conjunction merges atom sets. Deduplication yields the original
set. ∎

**Example**:

```
c₁ = {col('tenant_id') = session('app.tenant_id')}
c₂ = {col('tenant_id') = session('app.tenant_id'), col('role') = lit('editor')}

c₁ subsumes c₂:  c₁ ⊆ c₂, so ⟦c₂⟧ ⊆ ⟦c₁⟧
    c₁ is more permissive (fewer constraints, more rows match)
```

---

## 4. Policies

A policy is a named, typed collection of clauses that applies to specific SQL
commands on tables selected by a selector predicate.

### 4.1 Definition

**Definition 4.1** (Policy). A policy is a 5-tuple:

```
p = (name, type, commands, selector, clauses)
```

Where:

- `name` ∈ String — a unique identifier for the policy
- `type` ∈ {`permissive`, `restrictive`}
- `commands` ⊆ {`SELECT`, `INSERT`, `UPDATE`, `DELETE`}, non-empty
- `selector` — a selector predicate (Section 6) determining which tables this
  policy applies to
- `clauses` = {c₁, c₂, ..., cₙ} — a non-empty finite set of clauses

BNF fragment:

```
<policy>          ::= "POLICY" <identifier>
                      <policy_type>
                      <command_list>
                      <selector_clause>
                      <clause_block>

<policy_type>     ::= "PERMISSIVE" | "RESTRICTIVE"

<command_list>    ::= "FOR" <command> ("," <command>)*

<command>         ::= "SELECT" | "INSERT" | "UPDATE" | "DELETE"

<selector_clause> ::= "SELECTOR" <selector>

<clause_block>    ::= "CLAUSE" <clause> ("OR" "CLAUSE" <clause>)*
```

### 4.2 Policy Denotation

**Definition 4.2** (Policy denotation). The denotation of a policy `p` is the
disjunction of its clauses:

```
⟦p⟧ = ⟦c₁⟧ ∨ ⟦c₂⟧ ∨ ... ∨ ⟦cₙ⟧
```

A row satisfies a policy if it satisfies *any* of the policy's clauses.

### 4.3 USING vs WITH CHECK

For write commands (`INSERT`, `UPDATE`, `DELETE`), PostgreSQL distinguishes:

- **USING**: filters which existing rows are visible (relevant for `UPDATE`,
  `DELETE`, and `SELECT` within an `UPDATE`/`DELETE`)
- **WITH CHECK**: validates new or modified rows (relevant for `INSERT` and
  the new values in `UPDATE`)

In this algebra, each policy carries a single set of clauses that serves as
both `USING` and `WITH CHECK` by default. A policy may optionally specify
separate `with_check_clauses` when the write-validation predicate differs from
the read-visibility predicate.

**Definition 4.3** (Policy with distinct check). An extended policy is a
6-tuple `(name, type, commands, selector, using_clauses, check_clauses)` where
`check_clauses` defaults to `using_clauses` if unspecified.

### 4.4 Example: Tenant Isolation Policy

```
POLICY tenant_isolation
  PERMISSIVE
  FOR SELECT, INSERT, UPDATE, DELETE
  SELECTOR has_column('tenant_id')
  CLAUSE col('tenant_id') = session('app.tenant_id')
```

This defines a single permissive policy with one clause containing one atom.
The selector `has_column('tenant_id')` causes it to apply to `users`,
`projects`, and `comments` in our running example, but *not* to `tasks`,
`files` (no direct `tenant_id`), or `config` (global table).

---

## 5. Composition — The Policy Lattice

This section defines how multiple policies on a single table combine to produce
an effective access predicate. The composition rules follow PostgreSQL's native
semantics and correspond to Bonatti et al.'s access-control algebra.

### 5.1 Table Policy Set

**Definition 5.1** (Table policy set). For a given table `T` and command `CMD`,
the *table policy set* is the set of all policies whose selector matches `T`
and whose command set includes `CMD`:

```
Policies(T, CMD) = {p | match(p.selector, T) ∧ CMD ∈ p.commands}
```

This set partitions into permissive and restrictive subsets:

```
P(T, CMD) = {p ∈ Policies(T, CMD) | p.type = permissive}
R(T, CMD) = {p ∈ Policies(T, CMD) | p.type = restrictive}
```

### 5.2 Effective Access Predicate

**Definition 5.2** (Effective access predicate). The effective access predicate
for table `T` under command `CMD` is:

```
effective(T, CMD) = (⋁ₚ∈P ⟦p⟧) ∧ (⋀ᵣ∈R ⟦r⟧)
```

Expanding policy denotations:

```
effective(T, CMD) = (⋁ₚ∈P ⋁_{c∈p.clauses} ⟦c⟧) ∧ (⋀ᵣ∈R ⋁_{c∈r.clauses} ⟦c⟧)
```

### 5.3 Default Deny

**Definition 5.3** (Default deny). If `P(T, CMD) = ∅` (no permissive policies
apply), then `effective(T, CMD) = ⊥`. No rows are accessible.

This follows from the convention that an empty disjunction is `⊥`.

Restrictive policies alone cannot grant access — they can only further restrict
access already granted by permissive policies.

### 5.4 Connection to Bonatti's Algebra

Bonatti et al. (2002) define an access-control algebra with three operators:

| Bonatti operator               | This algebra                   | Effect                           |
|--------------------------------|--------------------------------|----------------------------------|
| `+` (grant/union)              | Permissive policy disjunction  | Expands accessible rows          |
| `&` (restriction/intersection) | Restrictive policy conjunction | Narrows accessible rows          |
| `−` (exception/difference)     | Not directly supported         | Would allow row-level exceptions |

The effective predicate formula maps directly:

```
effective = (+_{p∈P} ⟦p⟧) & (&_{r∈R} ⟦r⟧)
```

The absence of the exception operator (`−`) is deliberate: exceptions
complicate analysis and are not needed for the patterns targeted by this
algebra (tenant isolation, role-based access, soft-delete filtering).

### 5.5 Monotonicity Properties

**Property 5.1** (Monotonicity of permissive extension). *Adding a permissive
policy to `P` can only increase (or maintain) the set of accessible rows.*

*Proof*. Let `P' = P ∪ {p_new}`. Then:

```
⋁_{p∈P'} ⟦p⟧ = (⋁_{p∈P} ⟦p⟧) ∨ ⟦p_new⟧ ⊇ ⋁_{p∈P} ⟦p⟧
```

Since `A ∨ B ⊇ A` for any predicates A, B (in terms of satisfying rows), the
effective predicate's permissive component can only grow. ∎

**Property 5.2** (Anti-monotonicity of restrictive extension). *Adding a
restrictive policy to `R` can only decrease (or maintain) the set of accessible
rows.*

*Proof*. Let `R' = R ∪ {r_new}`. Then:

```
⋀_{r∈R'} ⟦r⟧ = (⋀_{r∈R} ⟦r⟧) ∧ ⟦r_new⟧ ⊆ ⋀_{r∈R} ⟦r⟧
```

Since `A ∧ B ⊆ A` for any predicates A, B. ∎

### 5.6 Policy Subsumption and Redundancy

**Definition 5.4** (Policy subsumption). Permissive policy `p₁` subsumes
permissive policy `p₂`, written `p₁ ⊒ p₂`, if:

```
⟦p₂⟧ ⊆ ⟦p₁⟧
```

That is, every row accessible under `p₂` is also accessible under `p₁`.

**Definition 5.5** (Policy redundancy). A policy `p` in policy set `S` is
*redundant* if removing it does not change the effective access predicate:

```
effective_S(T, CMD) = effective_{S∖{p}}(T, CMD)
```

**Lemma 5.1** (Subsumed permissive policy is redundant). *If permissive policy
`p₂` is subsumed by another permissive policy `p₁ ∈ P`, then `p₂` is redundant
in `P`.*

*Proof sketch*. Since `⟦p₂⟧ ⊆ ⟦p₁⟧`:

```
⋁_{p∈P} ⟦p⟧ = ⟦p₁⟧ ∨ ⟦p₂⟧ ∨ ⋁_{p∈P∖{p₁,p₂}} ⟦p⟧
             = ⟦p₁⟧ ∨ ⋁_{p∈P∖{p₁,p₂}} ⟦p⟧        (absorption: A ∨ B = A when B ⊆ A)
```

Removing `p₂` leaves the disjunction unchanged. ∎

A sufficient syntactic condition for policy subsumption: `p₁ ⊒ p₂` if for
every clause `c₂ ∈ p₂.clauses`, there exists a clause `c₁ ∈ p₁.clauses` such
that `c₁ ⊑ c₂` (i.e., `c₁` has a subset of `c₂`'s atoms, so `c₁` is at least
as permissive).

### 5.7 Worked Example

Consider two policies on the `projects` table for `SELECT`:

```
POLICY tenant_isolation          POLICY soft_delete
  PERMISSIVE                       RESTRICTIVE
  FOR SELECT                       FOR SELECT
  SELECTOR has_column('tenant_id') SELECTOR has_column('is_deleted')
  CLAUSE                           CLAUSE
    col('tenant_id') =               col('is_deleted') = lit(false)
      session('app.tenant_id')
```

Both selectors match `projects` (which has both `tenant_id` and `is_deleted`).

Partition:
```
P = {tenant_isolation}
R = {soft_delete}
```

Effective predicate:
```
effective(projects, SELECT)
  = (⟦tenant_isolation⟧) ∧ (⟦soft_delete⟧)
  = (col('tenant_id') = session('app.tenant_id'))
    ∧ (col('is_deleted') = lit(false))
```

A `SELECT` on `projects` returns only rows where the tenant matches *and* the
row is not soft-deleted.

---

## 6. Selectors & Table Matching

Selectors decouple policies from specific table names. Instead of enumerating
tables, a policy declares structural criteria. Tables matching those criteria
receive the policy automatically — including tables added in the future.

### 6.1 Selector Predicates

**Definition 6.1** (Selector). A selector is a predicate over table metadata,
constructed from the following grammar:

```
<selector>       ::= <base_selector>
                    | <selector> "AND" <selector>
                    | <selector> "OR" <selector>
                    | "NOT" <selector>
                    | "(" <selector> ")"
                    | "ALL"

<base_selector>  ::= "has_column(" <identifier> ("," <type>)? ")"
                    | "in_schema(" <identifier> ")"
                    | "named(" <pattern> ")"
                    | "tagged(" <tag> ")"
```

Where:

- `has_column(name, type?)` — matches tables that have a column with the given
  name, optionally restricted to a specific type. Example:
  `has_column('tenant_id', 'uuid')`.

- `in_schema(s)` — matches tables in the specified PostgreSQL schema. Example:
  `in_schema('public')`.

- `named(pat)` — matches tables whose name matches the given pattern (SQL
  `LIKE` syntax). Example: `named('audit_%')`.

- `tagged(t)` — matches tables that carry the specified metadata tag (stored
  as a PostgreSQL comment or in a governance metadata table). Example:
  `tagged('pii')`.

- `ALL` — matches every table in the governed set.

### 6.2 Table Metadata Context

**Definition 6.2** (Table metadata context). The metadata context `M` is the
set of structural facts about all tables in the governed database, extracted
from `pg_catalog`:

```
M = { (table_name, schema_name, columns, tags) | table ∈ governed_tables }
```

Where `columns` is a set of `(column_name, column_type)` pairs, and `tags` is
a set of string labels.

### 6.3 Matching Function

**Definition 6.3** (Selector matching). The function `match` evaluates a
selector against the metadata context to produce a set of matching tables:

```
match : Selector × M → 𝒫(Table)

match(has_column(n, t), M) = {T ∈ M | (n, t') ∈ T.columns ∧ (t = _ ∨ t = t')}
match(in_schema(s), M)     = {T ∈ M | T.schema = s}
match(named(pat), M)       = {T ∈ M | T.name LIKE pat}
match(tagged(t), M)        = {T ∈ M | t ∈ T.tags}
match(s₁ AND s₂, M)       = match(s₁, M) ∩ match(s₂, M)
match(s₁ OR s₂, M)        = match(s₁, M) ∪ match(s₂, M)
match(NOT s, M)            = M ∖ match(s, M)
match(ALL, M)              = M
```

**Example**: In our running schema:

```
match(has_column('tenant_id'), M) = {users, projects, comments}
match(has_column('is_deleted'), M) = {projects}
match(ALL, M) = {users, projects, tasks, comments, files, config}
```

### 6.4 Connection to Formal Concept Analysis

The selector mechanism admits a natural interpretation in Formal Concept
Analysis (FCA):

- **Objects** = the set of governed tables
- **Attributes** = structural properties (has column X, in schema Y, etc.)
- **Incidence relation** = table T has attribute A iff the corresponding base
  selector is satisfied

A **formal concept** is a pair `(extent, intent)` where:
- `extent` is a maximal set of tables sharing all attributes in `intent`
- `intent` is a maximal set of attributes shared by all tables in `extent`

The closure operators forming the Galois connection between `𝒫(Tables)` and
`𝒫(Attributes)` are:

```
α(T_set) = {a ∈ Attributes | ∀T ∈ T_set: T has a}    (common attributes)
β(A_set) = {T ∈ Tables | ∀a ∈ A_set: T has a}         (common tables)
```

A selector `s` defines an attribute set, and `match(s, M)` computes `β` applied
to that set. This means selectors are computing extents of (possibly non-closed)
attribute sets. The formal concepts represent the natural "policy groups" —
maximal clusters of tables sharing structural properties.

### 6.5 Selector Monotonicity

**Property 6.1** (Selector monotonicity). *For a fixed selector `s`, if a new
table `T_new` is added to the governed database and `match(s, M)` included
tables `T₁, ..., Tₖ`, then `match(s, M ∪ {T_new}) ⊇ {T₁, ..., Tₖ}`.*

*Proof*. Selector evaluation depends only on each table's own metadata. Adding
a new table cannot change the metadata of existing tables, so existing matches
are preserved. The new table either matches (expanding the set) or doesn't
(leaving it unchanged). ∎

This property ensures that policy coverage is stable under schema evolution:
existing protections are never silently dropped when new tables are added.

---

## 7. Relationship Traversal

Some tables do not carry a direct `tenant_id` column but inherit tenant context
through foreign-key relationships. The `tasks` table in our running example has
no `tenant_id` but references `projects`, which does. Relationship traversal
allows policies to express this indirect access pattern.

### 7.1 Declared Relationships

**Definition 7.1** (Relationship). A declared relationship is a 4-tuple:

```
rel(source_table, source_col, target_table, target_col)
```

Where `source_table.source_col` is a foreign key referencing
`target_table.target_col`.

**Example**: `rel(tasks, project_id, projects, id)` declares that
`tasks.project_id` references `projects.id`.

Relationships are declared explicitly in the policy configuration, not inferred
from database constraints. This ensures that only intentional access paths are
used for policy traversal.

### 7.2 Traversal Atoms

**Definition 7.2** (Traversal atom). A traversal atom extends the atom grammar
with an existential subquery:

```
<traversal_atom> ::= "exists(" <relationship> "," <clause> ")"
```

Semantics: `exists(rel(S, sc, T, tc), clause)` is satisfied for a row `r` of
table `S` if there exists a row `r'` in table `T` such that `r.sc = r'.tc` and
`clause(r')` holds.

**Example**:

```
exists(
  rel(tasks, project_id, projects, id),
  {col('tenant_id') = session('app.tenant_id')}
)
```

This atom on the `tasks` table checks: "there exists a project row whose `id`
matches this task's `project_id` and whose `tenant_id` matches the session
tenant." This provides tenant isolation for `tasks` through the relationship
to `projects`.

Extended BNF:

```
<atom> ::= <value_source> <binary_op> <value_source>
         | <value_source> <unary_op>
         | <traversal_atom>

<traversal_atom> ::= "exists(" <relationship> "," <clause> ")"

<relationship>   ::= "rel(" <identifier> "," <identifier> ","
                            <identifier> "," <identifier> ")"
```

### 7.3 Traversal Depth

**Definition 7.3** (Traversal depth). The *depth* of an atom is defined
recursively:

```
depth(value_source op value_source) = 0
depth(value_source unary_op)        = 0
depth(exists(rel, clause))          = 1 + max({depth(a) | a ∈ clause})
```

The depth of a clause is `max({depth(a) | a ∈ clause})`.

**Definition 7.4** (Maximum traversal depth). The policy engine enforces a
global maximum traversal depth `D` (default `D = 2`). Any atom with
`depth(a) > D` is rejected at definition time.

### 7.4 Properties

**Property 7.1** (Bounded compilation). *A traversal atom of depth `d` compiles
to at most `d` nested `EXISTS` subqueries. With maximum depth `D`, the compiled
SQL has at most `D` levels of nesting.*

*Proof*. By structural induction on the traversal atom. Base case: a
non-traversal atom compiles to a flat SQL expression (depth 0). Inductive step:
`exists(rel, clause)` compiles to `EXISTS (SELECT 1 FROM T WHERE join_cond AND compile(clause))`, adding one nesting level to whatever `compile(clause)`
produces. ∎

**Property 7.2** (No recursive traversal). *The algebra does not support
recursive relationship traversal. Hierarchical access patterns (e.g., org trees)
require pre-computed closure tables rather than recursive policy expressions.*

This restriction is essential for decidability. Recursive traversal would
require fixpoint computation, pushing the algebra beyond the decidable fragment.

### 7.5 Example: Tenant Isolation via Traversal

For `tasks` (no `tenant_id`) and `files` (no `tenant_id`):

```
POLICY tenant_isolation_via_project
  PERMISSIVE
  FOR SELECT, INSERT, UPDATE, DELETE
  SELECTOR named('tasks') OR named('files')
  CLAUSE
    exists(
      rel(_, project_id, projects, id),
      {col('tenant_id') = session('app.tenant_id')}
    )
```

When applied to `tasks`, the compiled SQL becomes:

```sql
CREATE POLICY tenant_isolation_via_project ON tasks
  USING (EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = tasks.project_id
      AND projects.tenant_id = (SELECT current_setting('app.tenant_id'))::uuid
  ));
```

---

## 8. Analysis

Because the algebra is decidable, policies can be analyzed *at design time*,
before any SQL is generated or executed. This section defines the key analysis
operations: satisfiability, subsumption, redundancy, contradiction, and tenant
isolation proofs.

### 8.1 Satisfiability

Satisfiability asks: "Can this clause/policy ever match any row?" An
unsatisfiable clause is a contradiction — a bug in the policy definition.

#### SMT Encoding

Each atom is encoded as an SMT formula in the combined theory QF-LIA ∪ QF-EUF:

```
function encode_atom(a) → SMT formula:
    match a:
        (col(x), =, col(y))        → x_var = y_var
        (col(x), =, session(k))    → x_var = k_var
        (col(x), =, lit(v))        → x_var = v_const
        (col(x), !=, lit(v))       → x_var ≠ v_const
        (col(x), <, lit(v))        → x_var < v_const
        (col(x), IN, lit([v₁..]))  → x_var = v₁ ∨ ... ∨ x_var = vₙ
        (col(x), IS NULL, _)       → x_null = true
        (col(x), IS NOT NULL, _)   → x_null = false
        exists(rel, clause)         → encode_traversal(rel, clause)

function encode_clause(c) → SMT formula:
    return ⋀_{a ∈ c} encode_atom(a)

function encode_traversal(rel(S, sc, T, tc), clause):
    -- Introduce fresh variables for the target table row
    target_vars ← fresh_vars(T)
    join_cond   ← sc_var = target_vars[tc]
    return ∃ target_vars: join_cond ∧ encode_clause(clause)[T → target_vars]
```

The satisfiability check: submit the formula to an SMT solver. If the solver
returns `UNSAT`, the clause is a contradiction.

#### Pseudocode

```
function check_satisfiability(clause c) → {SAT, UNSAT, UNKNOWN}:
    c' ← normalize_clause(c)
    if c' = ⊥:
        return UNSAT                    -- Syntactic contradiction detected
    φ ← encode_clause(c')
    result ← smt_solve(φ, timeout=5s)
    return result
```

#### Example

Consider the clause: `{col('role') = lit('admin'), col('role') = lit('viewer')}`.

After normalization, syntactic contradiction detection finds two equality atoms
on the same column with different literal values. The clause reduces to `⊥`
without needing the SMT solver.

For a subtler case: `{col('age') > lit(65), col('age') < lit(18)}`. Syntactic
checks may not catch this. The SMT encoding produces:

```
age_var > 65 ∧ age_var < 18
```

The solver returns `UNSAT`: no integer satisfies both constraints.

### 8.2 Subsumption

Subsumption determines whether one policy's access grant is entirely contained
within another's.

**Definition 8.1** (Policy subsumption via clauses). Permissive policy `p₁`
subsumes permissive policy `p₂`, written `p₁ ⊒ p₂`, if:

```
∀c₂ ∈ p₂.clauses, ∃c₁ ∈ p₁.clauses: c₁ ⊑ c₂
```

That is, every clause of `p₂` is subsumed by some clause of `p₁`.

**Algorithm**:

```
function check_subsumption(p₁, p₂) → bool:
    for each c₂ ∈ p₂.clauses:
        found ← false
        for each c₁ ∈ p₁.clauses:
            if clause_subsumes(c₁, c₂):
                found ← true
                break
        if not found:
            return false
    return true

function clause_subsumes(c₁, c₂) → bool:
    -- Syntactic check: c₁ ⊆ c₂ (c₁'s atoms are a subset of c₂'s)
    if atoms(c₁) ⊆ atoms(c₂):
        return true
    -- Semantic check: ask SMT if c₂ ⊢ c₁
    φ ← encode_clause(c₂) ∧ ¬encode_clause(c₁)
    return smt_solve(φ) = UNSAT
```

### 8.3 Redundancy

**Definition 8.2** (Redundancy). Policy `p` is redundant in policy set `S` if:

```
effective_S(T, CMD) ≡ effective_{S∖{p}}(T, CMD)
```

**Algorithm**:

```
function check_redundancy(p, S, T, CMD) → bool:
    if p.type = permissive:
        -- p is redundant if every clause is subsumed by another permissive policy
        P_others ← P(T, CMD) ∖ {p}
        for each c ∈ p.clauses:
            subsumed ← false
            for each p' ∈ P_others:
                for each c' ∈ p'.clauses:
                    if clause_subsumes(c', c):
                        subsumed ← true; break
                if subsumed: break
            if not subsumed:
                return false
        return true
    else:  -- restrictive
        -- p is redundant if its predicate is implied by the permissive disjunction
        -- (i.e., every row that passes the permissive filter also passes p)
        φ_perm ← encode_permissive_disjunction(P(T, CMD))
        φ_p    ← encode_policy(p)
        φ      ← φ_perm ∧ ¬φ_p
        return smt_solve(φ) = UNSAT
```

### 8.4 Contradiction

**Definition 8.3** (Contradiction). The effective access predicate for table `T`
under command `CMD` is *contradictory* if it is unsatisfiable:

```
effective(T, CMD) = ⊥
```

This means no rows are ever accessible — likely a policy authoring error.

**Algorithm**:

```
function check_contradiction(T, CMD, S) → bool:
    φ ← encode(effective(T, CMD))
    return smt_solve(φ) = UNSAT
```

**Example**: If the only permissive policy on `projects` requires
`col('role') = lit('admin')` and the only restrictive policy requires
`col('role') = lit('viewer')`, the effective predicate is:

```
col('role') = lit('admin') ∧ col('role') = lit('viewer')
```

This is unsatisfiable. The analysis flags a contradiction.

### 8.5 Tenant Isolation Proof

The most important analysis: proving that tenant data is properly isolated.
The question is: *can any session ever access a row belonging to a different
tenant?*

#### Formal Statement

**Definition 8.4** (Tenant isolation). Table `T` satisfies tenant isolation
if there is no row `r` and two distinct sessions `s₁ ≠ s₂` (differing in
`app.tenant_id`) such that both sessions can access `r`:

```
¬∃ r, s₁, s₂:
    s₁.tenant_id ≠ s₂.tenant_id
    ∧ effective(T, CMD)[session → s₁](r)
    ∧ effective(T, CMD)[session → s₂](r)
```

If this formula is **unsatisfiable**, tenant isolation holds.

#### SMT Encoding

```
function prove_tenant_isolation(T, CMD, S) → {PROVEN, FAILED, UNKNOWN}:
    -- Create two session variable sets
    s₁_vars ← fresh_session_vars("s1")
    s₂_vars ← fresh_session_vars("s2")
    row_vars ← fresh_row_vars(T)

    -- Encode: sessions differ in tenant_id
    φ_diff ← s₁_vars['app.tenant_id'] ≠ s₂_vars['app.tenant_id']

    -- Encode: both sessions can access the same row
    φ_eff₁ ← encode(effective(T, CMD))[session → s₁_vars, row → row_vars]
    φ_eff₂ ← encode(effective(T, CMD))[session → s₂_vars, row → row_vars]

    φ ← φ_diff ∧ φ_eff₁ ∧ φ_eff₂

    result ← smt_solve(φ)
    if result = UNSAT:
        return PROVEN       -- No cross-tenant access possible
    else if result = SAT:
        return FAILED       -- Counterexample: cross-tenant access exists
    else:
        return UNKNOWN      -- Solver timeout
```

#### Sufficient Condition

**Theorem 8.1** (Sufficient condition for tenant isolation). *If every
permissive clause for table `T` contains the atom
`col('tenant_id') = session('app.tenant_id')` (directly or via a depth-1
traversal to a table with such a clause), then tenant isolation holds for `T`.*

*Proof sketch*. Suppose two sessions `s₁` and `s₂` with different tenant IDs
both access row `r`. Each must satisfy at least one permissive clause (by
default deny). Every permissive clause requires the row's `tenant_id` (direct
or via traversal) to equal the session's `app.tenant_id`. So:

```
r.tenant_id = s₁.app.tenant_id     (from s₁ satisfying some permissive clause)
r.tenant_id = s₂.app.tenant_id     (from s₂ satisfying some permissive clause)
```

Therefore `s₁.app.tenant_id = s₂.app.tenant_id`, contradicting the assumption
that they differ. ∎

---

## 9. Optimization & Rewrite Rules

The policy engine applies rewrite rules to simplify policies before compilation.
Each rule preserves the denotation (semantic equivalence) while reducing
syntactic complexity.

### 9.1 Rewrite Rules

**Rule 1: Idempotence**

```
a ∧ a = a
```

Duplicate atoms within a clause are removed.

*Example*: `{col('x')=lit(1), col('x')=lit(1)}` → `{col('x')=lit(1)}`.

**Rule 2: Absorption**

```
c₁ ∨ (c₁ ∧ c₂) = c₁
```

In a disjunction of clauses within a policy, if clause `c₁` subsumes clause
`c₁ ∪ c₂` (because `c₁ ⊆ c₁ ∪ c₂`), the more restrictive clause is absorbed.

*Example*: Policy with clauses:
- `c₁ = {col('tenant_id') = session('app.tenant_id')}`
- `c₂ = {col('tenant_id') = session('app.tenant_id'), col('active') = lit(true)}`

`c₁ ⊆ c₂`, so `c₂` is absorbed. Policy reduces to `{c₁}`.

**Rule 3: Contradiction Elimination**

```
col(x) = lit(v₁) ∧ col(x) = lit(v₂)  →  ⊥     when v₁ ≠ v₂
```

A clause containing contradictory atoms is replaced by `⊥` and removed from the
policy's clause set.

*Example*: `{col('role')=lit('admin'), col('role')=lit('viewer')}` → `⊥`.
This clause is dropped.

**Rule 4: Tautology Detection**

```
col(x) = col(x)  →  ⊤
```

A tautological atom is removed from a clause (since `a ∧ ⊤ = a`).

If all atoms in a clause are tautological, the clause becomes `⊤`. A policy
containing a `⊤` clause is equivalent to `⊤` (since `⊤ ∨ c = ⊤`).

**Rule 5: Subsumption Elimination in Disjunctions**

```
If c₁ ⊑ c₂ (c₁ subsumes c₂), then c₁ ∨ c₂ = c₁
```

Within a policy's clause set, if one clause subsumes another, the subsumed
(more restrictive) clause is removed.

*Example*: Policy with clauses:
- `c₁ = {col('tenant_id') = session('tid')}`
- `c₂ = {col('tenant_id') = session('tid'), col('status') = lit('active')}`

`c₁` subsumes `c₂` (c₁ ⊆ c₂ as atom sets), so `c₂` is eliminated.

**Rule 6: Atom Merging**

```
col(x) = lit(v) ∧ col(x) IN lit([v, w₁, w₂, ...])  →  col(x) = lit(v)
```

When an equality atom and an IN-list atom reference the same column, and the
equality value appears in the IN-list, the IN-list is redundant.

More generally: `col(x) IN lit(S₁) ∧ col(x) IN lit(S₂) → col(x) IN lit(S₁ ∩ S₂)`.

*Example*: `{col('status')=lit('active'), col('status') IN lit(['active','pending','archived'])}` → `{col('status')=lit('active')}`.

### 9.2 Policy Normal Form

**Definition 9.1** (Policy normal form). A policy is in normal form when:

1. Every clause is in clause normal form (Def. 3.2).
2. All unsatisfiable clauses (`⊥`) have been removed from the clause set.
3. No clause in the set is subsumed by another clause in the same set.
4. No further rewrite rules (1–6) apply.

If removing unsatisfiable clauses leaves the clause set empty, the policy
itself is unsatisfiable and is flagged as an error.

### 9.3 Normalization Algorithm

```
function normalize_policy(p) → p':
    -- Phase 1: normalize individual clauses
    clauses ← {normalize_clause(c) | c ∈ p.clauses}

    -- Phase 2: remove unsatisfiable clauses
    clauses ← {c ∈ clauses | c ≠ ⊥}

    -- Phase 3: apply rewrite rules until fixpoint
    changed ← true
    while changed:
        changed ← false

        -- Absorption / subsumption elimination (Rules 2, 5)
        for each pair (c₁, c₂) ∈ clauses × clauses, c₁ ≠ c₂:
            if atoms(c₁) ⊆ atoms(c₂):       -- c₁ subsumes c₂
                clauses ← clauses ∖ {c₂}
                changed ← true
                break                         -- restart scan

        -- Atom merging within each clause (Rule 6)
        for each c ∈ clauses:
            c' ← merge_atoms(c)
            if c' ≠ c:
                clauses ← (clauses ∖ {c}) ∪ {c'}
                changed ← true

    if clauses = ∅:
        flag_error("Policy is entirely unsatisfiable")

    return p with clauses ← clauses
```

### 9.4 Termination

**Property 9.1** (Termination). *The normalization algorithm terminates.*

*Proof*. Define a complexity measure on a policy as the pair
`(|clauses|, Σ_{c∈clauses} |atoms(c)|)` under lexicographic ordering. Each
rewrite rule strictly reduces this measure:

- Contradiction elimination (Rule 3): removes a clause, reducing `|clauses|`.
- Absorption/subsumption elimination (Rules 2, 5): removes a clause.
- Atom merging (Rule 6): reduces `|atoms(c)|` for some clause.
- Idempotence (Rule 1): reduces `|atoms(c)|` for some clause.
- Tautology detection (Rule 4): reduces `|atoms(c)|` for some clause.

Since the measure is a natural number pair in a well-order, the algorithm must
terminate. ∎

### 9.5 Correctness

**Property 9.2** (Correctness). *Each rewrite rule preserves the denotation of
the policy: `⟦p⟧ = ⟦normalize(p)⟧`.*

*Proof sketch*. Each rule is a standard logical equivalence:

- Idempotence: `a ∧ a ≡ a`
- Absorption: `A ∨ (A ∧ B) ≡ A`
- Contradiction elimination: removing `⊥` from a disjunction does not change it
- Tautology detection: `a ∧ ⊤ ≡ a`
- Subsumption elimination: `A ∨ B ≡ A` when `B ⊆ A`
- Atom merging: `(x = v) ∧ (x ∈ S)` where `v ∈ S` ≡ `x = v`

Each preserves the set of satisfying rows. ∎

### 9.6 Worked Example

Starting from the explainer's Step 8 example, consider a policy with 4
components:

```
POLICY example_policy PERMISSIVE FOR SELECT SELECTOR ALL
  CLAUSE c₁: {col('tenant_id') = session('tid')}
  CLAUSE c₂: {col('tenant_id') = session('tid'), col('active') = lit(true)}
  CLAUSE c₃: {col('role') = lit('admin'), col('role') = lit('viewer')}
  CLAUSE c₄: {col('is_deleted') = lit(false)}
```

**Step 1**: Normalize clauses.
- c₁: already normal.
- c₂: already normal.
- c₃: contradiction detected (`role = 'admin'` ∧ `role = 'viewer'`) → `⊥`.
- c₄: already normal.

**Step 2**: Remove unsatisfiable clauses.
- c₃ = ⊥ → removed. Remaining: {c₁, c₂, c₄}.

**Step 3**: Subsumption elimination.
- `atoms(c₁) ⊆ atoms(c₂)` → c₁ subsumes c₂ → remove c₂.
- Remaining: {c₁, c₄}. No further subsumption.

**Result**: 4 atoms → 2 clauses with 1 atom each. The simplest correct
enforcement.

---

## 10. Compilation

Compilation is the deterministic translation of normalized policies to native
PostgreSQL security artifacts. This section defines the compilation function,
proves its correctness, and specifies the naming conventions for generated
artifacts.

### 10.1 PostgreSQL Artifact Set

**Definition 10.1** (Artifact set). The compilation output for a governed
table `T` is a set of SQL statements drawn from:

- `ALTER TABLE T ENABLE ROW LEVEL SECURITY` — enables RLS on the table
- `ALTER TABLE T FORCE ROW LEVEL SECURITY` — enforces RLS even for table owners
- `GRANT <privileges> ON T TO <role>` — object-level access control
- `CREATE POLICY <name> ON T [AS {PERMISSIVE|RESTRICTIVE}] [FOR <cmd>] USING (<expr>) [WITH CHECK (<expr>)]` — row-level access control

### 10.2 Compilation Function

Compilation is defined as structural recursion over the policy algebra's types.

#### Compile Atom

The compile_atom function consumes the table metadata context `M` (§ 6.2)
in addition to the atom, so that `session(k)` references appearing in a
column-comparison can be emitted with the column's PostgreSQL type cast.
Let `type_of(x) = M.column(x).type` for the table under compilation.

```
function compile_atom(a, M) → SQL expression:
    match a:
        (col(x), op, session(k))    → "x op session_expr(k, type_of(x))"
        (col(x), =, lit(v))         → "x = v"                      -- v quoted
        (col(x), !=, lit(v))        → "x <> v"
        (col(x), <, lit(v))         → "x < v"
        (col(x), >, lit(v))         → "x > v"
        (col(x), <=, lit(v))        → "x <= v"
        (col(x), >=, lit(v))        → "x >= v"
        (col(x), IN, lit(vs))       → "x IN (v₁, v₂, ...)"
        (col(x), NOT IN, lit(vs))   → "x NOT IN (v₁, v₂, ...)"
        (col(x), IS NULL, _)        → "x IS NULL"
        (col(x), IS NOT NULL, _)    → "x IS NOT NULL"
        (col(x), LIKE, lit(v))      → "x LIKE 'v'"
        (col(x), =, col(y))         → "x = y"
        (col(x), =, fn(f, args))    → "x = f(args)"
        exists(rel, clause)          → compile_traversal(rel, clause, M)

function session_expr(k, type_T) → SQL expression:
    base ← "(SELECT current_setting('k'))"
    if type_T ∈ TextLikeTypes:        -- text, varchar, character varying, character
        return base
    return base + "::" + type_T
```

The `(SELECT current_setting(...))` wrap forces PostgreSQL to evaluate
the session lookup as an InitPlan once per query rather than per row,
producing a cached scalar the planner can apply against indexed columns.
The wrap is sound on every input regardless of the volatility of the
session source.

The explicit type cast is mandatory for non-text columns:
`current_setting()` returns `text`, and PostgreSQL's operator resolution
will not implicitly cast `text` to `uuid`, `integer`, `boolean`, or
other concrete types — the `CREATE POLICY` statement fails at definition
time without the cast. See the casting table in the Architecture
Decision Record § 9.2 for the canonical mapping from column type to
emitted cast suffix.

For traversal atoms, the inner clause's column references are scoped to
the *target* table of the relationship, so `type_of(·)` is evaluated
against the target table's metadata, not the source table's.

#### Compile Traversal

```
function compile_traversal(rel(S, sc, T, tc), clause) → SQL expression:
    inner ← compile_clause(clause)  -- with column refs scoped to T
    return "EXISTS (SELECT 1 FROM T WHERE T.tc = S.sc AND inner)"
```

Where `S` in `S.sc` refers to the outer table being policy-protected.

#### Compile Clause

```
function compile_clause(c) → SQL expression:
    parts ← [compile_atom(a) | a ∈ c, sorted]
    return join(parts, " AND ")
```

An empty clause (⊤) compiles to `true`.

#### Compile Policy

```
function compile_policy(p, T) → SQL statement:
    type_clause  ← "AS " + upper(p.type)
    cmd_clause   ← "FOR " + join(p.commands, ", ")
    using_expr   ← join([compile_clause(c) | c ∈ p.using_clauses], " OR ")
    check_expr   ← join([compile_clause(c) | c ∈ p.check_clauses], " OR ")

    sql ← "CREATE POLICY " + p.name + "_" + T.name
         + " ON " + T.qualified_name
         + " " + type_clause
         + " " + cmd_clause
         + " USING (" + using_expr + ")"

    if check_expr ≠ using_expr and p.commands ∩ {INSERT, UPDATE} ≠ ∅:
        sql ← sql + " WITH CHECK (" + check_expr + ")"

    return sql
```

#### Compile Policy Set for Table

```
function compile_table(T, CMD, S) → [SQL statement]:
    statements ← []

    -- Enable and force RLS
    statements.append("ALTER TABLE " + T.qualified_name
                     + " ENABLE ROW LEVEL SECURITY")
    statements.append("ALTER TABLE " + T.qualified_name
                     + " FORCE ROW LEVEL SECURITY")

    -- Compile each matching policy
    for each p ∈ Policies(T, CMD):
        statements.append(compile_policy(p, T))

    return statements
```

### 10.3 Compilation Correctness

**Theorem 10.1** (Compilation correctness). *For any table `T`, command `CMD`,
and policy set `S`, the set of rows accessible under the compiled SQL policies
equals the set of rows satisfying `effective(T, CMD)`:*

```
{r | r accessible under compiled SQL} = {r | effective(T, CMD)(r) = true}
```

*Proof sketch* (by structural induction).

**Base case** (atoms). Each atom compiles to a SQL expression that evaluates to
`true` on exactly the rows satisfying the atom's semantics:

- `col(x) = session(k)` compiles to `x = (SELECT current_setting('k'))::T`
  where `T = type_of(x)` (omitted for text-like columns; see § 10.2
  `session_expr`). PostgreSQL evaluates the wrapped `current_setting('k')`
  as an InitPlan, caching the result for the duration of the query. The
  cast resolves the `text`-to-`T` coercion that PostgreSQL's operator
  catalog declares as explicit-only. The comparison produces the same
  boolean result as the atom's denotation.

- `col(x) = lit(v)` compiles to `x = v`. Direct correspondence.

- `exists(rel(S, sc, T, tc), clause)` compiles to
  `EXISTS (SELECT 1 FROM T WHERE T.tc = S.sc AND ...)`. The EXISTS subquery
  returns true iff there exists a matching row in T satisfying the join
  condition and the compiled clause — matching the traversal atom's semantics.

**Inductive step** (clauses). A clause `{a₁, ..., aₙ}` compiles to
`compile(a₁) AND ... AND compile(aₙ)`. By the base case, each compiled atom
has the correct denotation. SQL AND has standard conjunction semantics. ∎

**Inductive step** (policies). A policy's clause set `{c₁, ..., cₖ}` compiles
to `compile(c₁) OR ... OR compile(cₖ)` in the USING expression. SQL OR has
standard disjunction semantics. ∎

**Inductive step** (composition). PostgreSQL composes permissive policies by
OR and restrictive policies by AND, then takes their conjunction. This exactly
mirrors Definition 5.2. ∎

### 10.4 Connection to Galois Connections

The compilation function and the denotational semantics form an adjunction.
Define:

- `L` = the lattice of DSL policy expressions, ordered by subsumption
- `R` = the lattice of SQL predicate expressions, ordered by logical implication
- `α : L → R` = the compilation function (`compile`)
- `γ : R → L` = the abstraction function (parsing compiled SQL back to DSL, where possible)

The pair `(α, γ)` forms a Galois connection when:

```
∀ l ∈ L, r ∈ R:  α(l) ⊑_R r  ⟺  l ⊑_L γ(r)
```

In practice, `γ` is partial (not all SQL can be parsed back). The important
direction is `α`: compilation preserves the ordering.

**Property 10.1** (Monotonicity of compilation). *If policy `p₁` subsumes
policy `p₂` in the DSL (`p₁ ⊒ p₂`), then the compiled SQL of `p₁` is at least
as permissive as the compiled SQL of `p₂`.*

### 10.5 Determinism

**Property 10.2** (Determinism). *Two policies with identical normal forms
produce identical SQL output.*

*Proof*. The compilation function is purely structural with no randomness or
ambient state dependency. Normal form is unique (by confluence of rewrite
rules). Therefore the output is determined entirely by the normal form. ∎

### 10.6 Naming Convention

Generated artifacts follow a deterministic naming scheme:

```
<policy_name>_<table_name>
```

Examples:
- Policy `tenant_isolation` on table `projects` →
  `CREATE POLICY tenant_isolation_projects ON projects ...`
- Policy `soft_delete` on table `projects` →
  `CREATE POLICY soft_delete_projects ON projects ...`

### 10.7 Full Compilation Example

Given the running example policies from Sections 4.4 and 5.7 applied to
`projects`:

**Input** (normalized policies):

```
POLICY tenant_isolation PERMISSIVE FOR SELECT
  CLAUSE {col('tenant_id') = session('app.tenant_id')}

POLICY soft_delete RESTRICTIVE FOR SELECT
  CLAUSE {col('is_deleted') = lit(false)}
```

**Compiled output**:

```sql
-- Enable RLS
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects FORCE ROW LEVEL SECURITY;

-- Permissive: tenant isolation
CREATE POLICY tenant_isolation_projects
  ON public.projects
  AS PERMISSIVE
  FOR SELECT
  USING (tenant_id = (SELECT current_setting('app.tenant_id'))::uuid);

-- Restrictive: soft delete filter
CREATE POLICY soft_delete_projects
  ON public.projects
  AS RESTRICTIVE
  FOR SELECT
  USING (is_deleted = false);
```

The `::uuid` suffix is emitted because `projects.tenant_id` is declared
as `uuid` in the running example schema. For a text-typed column the
cast would be omitted. See § 10.2 (`session_expr`).

**Effective SQL predicate** (what PostgreSQL enforces):

```sql
-- (OR of permissive) AND (AND of restrictive)
(tenant_id = (SELECT current_setting('app.tenant_id'))::uuid)
AND
(is_deleted = false)
```

---

## 11. Drift Detection & Reconciliation

After compilation and application, the database state must be continuously
monitored to ensure it matches the intended policy state. *Drift* is any
discrepancy between the observed database state and the expected state derived
from the policy algebra.

### 11.1 Observed and Expected State

**Definition 11.1** (Observed state). The observed state `O` is the set of
security-relevant facts extracted from the live database via introspection:

```
O = {
    rls_enabled    : Table → bool,           -- from pg_class.relrowsecurity
    rls_forced     : Table → bool,           -- from pg_class.relforcerowsecurity
    policies       : Table → Set(PolicyFact),-- from pg_policies
    grants         : Table → Set(GrantFact)  -- from information_schema.table_privileges
}
```

Where `PolicyFact` captures the name, type (permissive/restrictive), command,
roles, USING expression, and WITH CHECK expression of each live policy.

**Definition 11.2** (Expected state). The expected state `E` is the output of
the compilation function (Section 10) applied to the current policy set:

```
E = compile(PolicySet, governed_tables)
```

### 11.2 Drift

**Definition 11.3** (Drift). Drift is the symmetric difference between observed
and expected states:

```
Drift = O △ E = (O ∖ E) ∪ (E ∖ O)
```

### 11.3 Drift Classification

Drift is classified into the following types:

| Drift type      | Description                                      | Severity |
|-----------------|--------------------------------------------------|----------|
| Missing policy  | Expected policy not found in database            | Critical |
| Extra policy    | Unmanaged policy found on governed table         | Warning  |
| Modified policy | Policy exists but USING/CHECK expression differs | Critical |
| Missing GRANT   | Expected GRANT not present                       | Critical |
| Extra GRANT     | Unmanaged GRANT on governed table                | Warning  |
| RLS disabled    | `relrowsecurity = false` on governed table       | Critical |
| RLS not forced  | `relforcerowsecurity = false` on governed table  | High     |

### 11.4 Drift Detection Algorithm

```
function detect_drift(S, governed_tables) → Set(DriftItem):
    drift ← ∅

    E ← compile(S, governed_tables)    -- Expected state
    O ← introspect(governed_tables)     -- Observed state

    for each T ∈ governed_tables:
        -- Check RLS enablement
        if not O.rls_enabled(T):
            drift.add(DriftItem(T, "rls_disabled"))
        if not O.rls_forced(T):
            drift.add(DriftItem(T, "rls_not_forced"))

        -- Compare policies
        expected_policies ← E.policies(T)
        observed_policies ← O.policies(T)

        for each ep ∈ expected_policies:
            op ← find_by_name(observed_policies, ep.name)
            if op = null:
                drift.add(DriftItem(T, "missing_policy", ep))
            else if op.using_expr ≠ ep.using_expr
                    or op.check_expr ≠ ep.check_expr
                    or op.type ≠ ep.type:
                drift.add(DriftItem(T, "modified_policy", ep, op))

        for each op ∈ observed_policies:
            if not find_by_name(expected_policies, op.name):
                drift.add(DriftItem(T, "extra_policy", op))

        -- Compare grants (analogous)
        -- ... (similar logic for grants)

    return drift
```

The `introspect` function queries PostgreSQL system catalogs:

```sql
-- Policy introspection
SELECT schemaname, tablename, policyname, permissive,
       roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public';

-- RLS status
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE relnamespace = 'public'::regnamespace;
```

### 11.5 Reconciliation Strategies

When drift is detected, three strategies are available:

**Auto-remediate**: Automatically re-apply the expected state. Suitable for
`missing_policy`, `modified_policy`, `rls_disabled`, and `rls_not_forced` drift
types. The engine drops the drifted artifact and re-creates it from the
compiled output.

**Alert**: Notify operators without taking action. Suitable for `extra_policy`
and `extra_grant` drift types, which may represent intentional manual overrides
that require human review.

**Quarantine**: For unmanaged tables (tables not in the governed set that have
RLS policies), log the finding and optionally restrict access until reviewed.

```
function reconcile(drift_items, strategy) → Set(SQL statement):
    actions ← ∅
    for each item ∈ drift_items:
        match (strategy, item.type):
            (auto, "missing_policy")   → actions.add(item.expected_sql)
            (auto, "modified_policy")  → actions.add(drop(item.observed))
                                         actions.add(item.expected_sql)
            (auto, "rls_disabled")     → actions.add(enable_rls(item.table))
            (auto, "rls_not_forced")   → actions.add(force_rls(item.table))
            (alert, "extra_policy")    → notify(item)
            (alert, "extra_grant")     → notify(item)
            (quarantine, _)            → quarantine(item.table)
    return actions
```

---

## 12. The Governance Loop

The governance loop is the top-level operational cycle that ties together all
components of the policy algebra: definition, analysis, compilation,
application, monitoring, and reconciliation.

### 12.1 Six Phases

```
    ┌──────────┐
    │  Define  │ ◄─────────────────────────────────┐
    └────┬─────┘                                    │
         │                                          │
         ▼                                          │
    ┌──────────┐                                    │
    │ Analyze  │──── errors? ──► reject + notify    │
    └────┬─────┘                                    │
         │ pass                                     │
         ▼                                          │
    ┌──────────┐                                    │
    │ Compile  │                                    │
    └────┬─────┘                                    │
         │                                          │
         ▼                                          │
    ┌──────────┐                                    │
    │  Apply   │                                    │
    └────┬─────┘                                    │
         │                                          │
         ▼                                          │
    ┌──────────┐                                    │
    │ Monitor  │──── drift? ────────┐               │
    └────┬─────┘                    │               │
         │ no drift                 ▼               │
         │                    ┌───────────┐         │
         └────────────────────│ Reconcile │─────────┘
                              └───────────┘
```

1. **Define**: Data stewards author policies using the DSL (atoms, clauses,
   selectors, traversals). Policies are version-controlled.

2. **Analyze**: The analysis engine (Section 8) validates all policies:
   satisfiability, contradiction detection, redundancy identification, and
   tenant isolation proofs. If errors are found, the policy set is rejected
   and authors are notified.

3. **Compile**: Validated policies are compiled (Section 10) to PostgreSQL
   artifacts. The output is deterministic and reproducible.

4. **Apply**: Compiled SQL statements are executed against the target database
   in a transaction. This includes enabling RLS, creating policies, and
   granting privileges.

5. **Monitor**: The drift detection engine (Section 11) periodically introspects
   the database and compares observed state to expected state.

6. **Reconcile**: When drift is detected, the reconciliation engine applies the
   appropriate strategy (auto-remediate, alert, or quarantine) and feeds
   findings back into the Define phase.

### 12.2 Governance State Machine

**Definition 12.1** (Governance state). A governance state is a pair:

```
G = (S, D)
```

Where `S` is the current policy set and `D` is the current database state
(the observed state from Section 11.1).

**Definition 12.2** (Governance transitions). The governance loop defines
transitions:

```
define    : (S, D) → (S', D)         -- modify policy set
analyze   : (S, D) → (S, D) | error  -- validate (no state change if pass)
compile   : (S, D) → (S, D, E)       -- produce expected state E
apply     : (S, D, E) → (S, D')      -- D' reflects applied E
monitor   : (S, D) → (S, D, Δ)       -- Δ = detected drift
reconcile : (S, D, Δ) → (S, D')      -- D' = D with drift resolved
```

### 12.3 Convergence

**Property 12.1** (Convergence). *Absent external changes to the database,
one complete cycle of the governance loop brings drift to zero:*

```
drift(apply(compile(analyze(S))), S) = ∅
```

*Proof sketch*. The `compile` function produces expected state `E` from policy
set `S`. The `apply` function executes `E` against the database, making
observed state `O` equal to `E`. The `monitor` function computes `O △ E`,
which is `E △ E = ∅`. ∎

The "absent external changes" caveat is essential: another actor (DBA, migration
script, another tool) may modify the database between `apply` and `monitor`,
introducing drift that requires another cycle.

### 12.4 Idempotence

**Property 12.2** (Idempotence). *Applying the same compiled artifacts twice
produces the same database state:*

```
apply(E, apply(E, D)) = apply(E, D)
```

*Proof sketch*. Each compiled artifact is a `CREATE POLICY ... IF NOT EXISTS`
or an idempotent `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`. Re-executing
these statements on a database already in the target state is a no-op. For
`CREATE POLICY` without `IF NOT EXISTS`, the engine uses `DROP POLICY IF EXISTS`
followed by `CREATE POLICY`, which is idempotent by construction. ∎

### 12.5 Key Invariants

The governance loop maintains the following invariants at steady state (zero
drift):

1. **RLS enabled**: Every governed table has `relrowsecurity = true`.
2. **RLS forced**: Every governed table has `relforcerowsecurity = true`.
3. **Policy match**: For every governed table `T`, the set of policies on `T`
   matches the compiled output of the policy set.
4. **Grant match**: For every governed table `T`, the grants on `T` match the
   compiled output.
5. **Tenant isolation**: For every governed table `T` that is subject to a
   tenant isolation policy, the isolation proof (Section 8.5) holds.

---

## 13. Complete BNF Grammar

This section assembles all grammar fragments from Sections 2–7 into a
standalone grammar for the policy algebra DSL.

```
(* ============================================================ *)
(* Policy Algebra DSL — Complete BNF Grammar                     *)
(* ============================================================ *)

(* --- Top Level --- *)

<policy_set>      ::= <policy>*

<policy>          ::= "POLICY" <identifier>
                      <policy_type>
                      <command_list>
                      <selector_clause>
                      <clause_block>

<policy_type>     ::= "PERMISSIVE" | "RESTRICTIVE"

<command_list>    ::= "FOR" <command> ("," <command>)*

<command>         ::= "SELECT" | "INSERT" | "UPDATE" | "DELETE"

<selector_clause> ::= "SELECTOR" <selector>

(* --- Selectors --- *)

<selector>        ::= <base_selector>
                     | <selector> "AND" <selector>
                     | <selector> "OR" <selector>
                     | "NOT" <selector>
                     | "(" <selector> ")"
                     | "ALL"

<base_selector>   ::= "has_column(" <identifier> ("," <type>)? ")"
                     | "in_schema(" <identifier> ")"
                     | "named(" <pattern> ")"
                     | "tagged(" <tag> ")"

(* --- Clauses --- *)

<clause_block>    ::= "CLAUSE" <clause> ("OR" "CLAUSE" <clause>)*

<clause>          ::= <atom> ("AND" <atom>)*

(* --- Atoms --- *)

<atom>            ::= <value_source> <binary_op> <value_source>
                    | <value_source> <unary_op>
                    | <traversal_atom>

<traversal_atom>  ::= "exists(" <relationship> "," <clause> ")"

<relationship>    ::= "rel(" <identifier> "," <identifier> ","
                            <identifier> "," <identifier> ")"

(* --- Value Sources --- *)

<value_source>    ::= "col(" <identifier> ")"
                    | "session(" <string_literal> ")"
                    | "lit(" <literal_value> ")"
                    | "fn(" <identifier> "," "[" <arg_list>? "]" ")"

<arg_list>        ::= <value_source> ("," <value_source>)*

(* --- Operators --- *)

<binary_op>       ::= "=" | "!=" | "<" | ">" | "<=" | ">="
                     | "IN" | "NOT IN" | "LIKE" | "NOT LIKE"

<unary_op>        ::= "IS NULL" | "IS NOT NULL"

(* --- Literals and Identifiers --- *)

<literal_value>   ::= <string_literal>
                    | <integer_literal>
                    | <boolean_literal>
                    | <null_literal>
                    | <list_literal>

<list_literal>    ::= "[" <literal_value> ("," <literal_value>)* "]"

<string_literal>  ::= "'" <character>* "'"

<integer_literal> ::= ["-"] <digit>+

<boolean_literal> ::= "true" | "false"

<null_literal>    ::= "null"

<identifier>      ::= <letter> (<letter> | <digit> | "_")*

<pattern>         ::= <string_literal>     (* SQL LIKE pattern *)

<tag>             ::= <string_literal>

<type>            ::= "text" | "integer" | "bigint" | "uuid"
                    | "boolean" | "timestamp" | "jsonb"
```

---

## 14. Summary of Properties & Lemmas

| #     | Name                                       | Statement                                                                                | Section |
|-------|--------------------------------------------|------------------------------------------------------------------------------------------|---------|
| T1.1  | Undecidability of arbitrary RLS            | Determining row accessibility under arbitrary SQL RLS predicates is undecidable          | 1.1     |
| P2.1  | Decidability of atom satisfiability        | Satisfiability of any finite conjunction of atoms is decidable (reduces to QF-LIA/EUF)   | 2.5     |
| P3.1  | Clause satisfiability                      | A normalized clause is satisfiable iff c ≠ ⊥; SMT provides a complete decision procedure | 3.3     |
| P3.2  | Clause subsumption                         | c₁ ⊆ c₂ (atom sets) implies ⟦c₂⟧ ⊆ ⟦c₁⟧                                                  | 3.3     |
| P3.3  | Idempotence                                | c ∧ c = c for any clause c                                                               | 3.3     |
| P5.1  | Monotonicity of permissive extension       | Adding a permissive policy can only increase accessible rows                             | 5.5     |
| P5.2  | Anti-monotonicity of restrictive extension | Adding a restrictive policy can only decrease accessible rows                            | 5.5     |
| L5.1  | Subsumed permissive redundancy             | A permissive policy subsumed by another is redundant                                     | 5.6     |
| P6.1  | Selector monotonicity                      | Adding tables preserves existing selector matches                                        | 6.5     |
| P7.1  | Bounded compilation                        | Traversal of depth d compiles to at most d nested EXISTS                                 | 7.4     |
| P7.2  | No recursive traversal                     | Hierarchies require closure tables, not recursive policy expressions                     | 7.4     |
| T8.1  | Tenant isolation sufficient condition      | If every permissive clause contains the tenant atom, isolation holds                     | 8.5     |
| P9.1  | Termination of normalization               | Normalization algorithm terminates (strict reduction under lex ordering)                 | 9.4     |
| P9.2  | Correctness of normalization               | Each rewrite rule preserves denotation                                                   | 9.5     |
| T10.1 | Compilation correctness                    | Accessible rows under compiled SQL = rows satisfying effective(T, CMD)                   | 10.3    |
| P10.1 | Monotonicity of compilation                | Subsumption in DSL preserved in compiled SQL                                             | 10.4    |
| P10.2 | Determinism of compilation                 | Same normal form → identical SQL output                                                  | 10.5    |
| P12.1 | Convergence                                | One governance cycle brings drift to zero (absent external changes)                      | 12.3    |
| P12.2 | Idempotence of application                 | Applying same artifacts twice = same state                                               | 12.4    |

---

## Appendix A: Full Lifecycle Worked Example

This appendix traces the complete governance lifecycle for our running example
schema, exercising every definition in the specification.

### A.1 Define

We define three policies:

```
POLICY tenant_isolation
  PERMISSIVE
  FOR SELECT, INSERT, UPDATE, DELETE
  SELECTOR has_column('tenant_id')
  CLAUSE col('tenant_id') = session('app.tenant_id')

POLICY tenant_isolation_via_project
  PERMISSIVE
  FOR SELECT, INSERT, UPDATE, DELETE
  SELECTOR named('tasks') OR named('files')
  CLAUSE
    exists(
      rel(_, project_id, projects, id),
      {col('tenant_id') = session('app.tenant_id')}
    )

POLICY soft_delete
  RESTRICTIVE
  FOR SELECT
  SELECTOR has_column('is_deleted')
  CLAUSE col('is_deleted') = lit(false)
```

### A.2 Selector Evaluation

Evaluate selectors against the running example metadata:

| Selector                           | Matching tables           |
|------------------------------------|---------------------------|
| `has_column('tenant_id')`          | users, projects, comments |
| `named('tasks') OR named('files')` | tasks, files              |
| `has_column('is_deleted')`         | projects                  |

Policy-to-table mapping:

| Table    | Policies applied              |
|----------|-------------------------------|
| users    | tenant_isolation              |
| projects | tenant_isolation, soft_delete |
| tasks    | tenant_isolation_via_project  |
| comments | tenant_isolation              |
| files    | tenant_isolation_via_project  |
| config   | *(none — default deny)*       |

### A.3 Normalize

All three policies are already in normal form:
- Each clause has one atom, in atom normal form.
- No unsatisfiable clauses.
- No subsumption between clauses within the same policy.

### A.4 Analyze

#### Satisfiability

- `tenant_isolation` clause: `col('tenant_id') = session('app.tenant_id')` —
  satisfiable (session variable can equal any tenant_id value).
- `tenant_isolation_via_project` clause: `exists(rel(...), ...)` — satisfiable
  (there can exist a matching project row).
- `soft_delete` clause: `col('is_deleted') = lit(false)` — satisfiable.

All clauses pass satisfiability.

#### Contradiction Check

For `projects` (SELECT):
```
effective(projects, SELECT) =
    (col('tenant_id') = session('app.tenant_id'))
    ∧ (col('is_deleted') = lit(false))
```

SMT encoding: `tid_var = session_tid ∧ is_deleted_var = false`. Satisfiable.
No contradiction.

#### Tenant Isolation Proof

For `users`: The sole permissive clause contains
`col('tenant_id') = session('app.tenant_id')`. By Theorem 8.1, isolation holds.

For `projects`: Same as `users`.

For `tasks`: The permissive clause is
`exists(rel(tasks, project_id, projects, id), {col('tenant_id') = session('app.tenant_id')})`.
The traversal checks `tenant_id` on `projects`. By the extended form of
Theorem 8.1 (depth-1 traversal), isolation holds.

For `comments`: Same as `users`.

For `files`: Same reasoning as `tasks`.

For `config`: No permissive policies → default deny → no access at all →
isolation trivially holds.

**Result**: Tenant isolation proven for all tables.

### A.5 Compile

Generated SQL for each governed table:

```sql
-- ============================================================
-- users
-- ============================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_users
  ON public.users
  AS PERMISSIVE
  FOR SELECT, INSERT, UPDATE, DELETE
  USING (tenant_id = (SELECT current_setting('app.tenant_id'))::uuid);

-- ============================================================
-- projects
-- ============================================================
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_projects
  ON public.projects
  AS PERMISSIVE
  FOR SELECT, INSERT, UPDATE, DELETE
  USING (tenant_id = (SELECT current_setting('app.tenant_id'))::uuid);

CREATE POLICY soft_delete_projects
  ON public.projects
  AS RESTRICTIVE
  FOR SELECT
  USING (is_deleted = false);

-- ============================================================
-- tasks
-- ============================================================
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_via_project_tasks
  ON public.tasks
  AS PERMISSIVE
  FOR SELECT, INSERT, UPDATE, DELETE
  USING (EXISTS (
    SELECT 1 FROM public.projects
    WHERE public.projects.id = public.tasks.project_id
      AND public.projects.tenant_id = (SELECT current_setting('app.tenant_id'))::uuid
  ));

-- ============================================================
-- comments
-- ============================================================
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_comments
  ON public.comments
  AS PERMISSIVE
  FOR SELECT, INSERT, UPDATE, DELETE
  USING (tenant_id = (SELECT current_setting('app.tenant_id'))::uuid);

-- ============================================================
-- files
-- ============================================================
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_via_project_files
  ON public.files
  AS PERMISSIVE
  FOR SELECT, INSERT, UPDATE, DELETE
  USING (EXISTS (
    SELECT 1 FROM public.projects
    WHERE public.projects.id = public.files.project_id
      AND public.projects.tenant_id = (SELECT current_setting('app.tenant_id'))::uuid
  ));
```

### A.6 Apply

Execute the compiled SQL in a transaction against the target PostgreSQL
database. All statements succeed.

### A.7 Simulate Drift

A DBA manually runs:

```sql
ALTER TABLE public.projects DISABLE ROW LEVEL SECURITY;

CREATE POLICY manual_override ON public.users
  AS PERMISSIVE FOR SELECT
  USING (true);
```

This introduces two drift items:
1. RLS disabled on `projects`
2. Extra (unmanaged) policy on `users`

### A.8 Detect

The drift detection algorithm (Section 11.4) runs:

```
detect_drift(S, {users, projects, tasks, comments, files}) →
{
    DriftItem(projects, "rls_disabled"),
    DriftItem(users, "extra_policy", "manual_override")
}
```

### A.9 Reconcile

- `projects` / `rls_disabled` → **auto-remediate**: re-enable RLS.
- `users` / `extra_policy` → **alert**: notify operators about unmanaged policy
  `manual_override`.

Remediation SQL:

```sql
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
```

After remediation, the next monitoring cycle detects zero drift (assuming the
`extra_policy` alert has been acknowledged or the manual policy has been
reviewed and either adopted into the policy set or dropped).

---

## Appendix B: Glossary

| Term                           | Definition                                                                                                                 |
|--------------------------------|----------------------------------------------------------------------------------------------------------------------------|
| **Atom**                       | An irreducible boolean comparison: `(left_source, operator, right_source)`. The smallest unit of the policy algebra.       |
| **Clause**                     | A conjunction (AND) of atoms. Represents a single access condition that must be fully satisfied.                           |
| **Compilation**                | The deterministic translation of a policy set to PostgreSQL SQL artifacts.                                                 |
| **Default deny**               | The principle that if no permissive policy grants access, no rows are accessible.                                          |
| **Denotation**                 | The semantic interpretation `⟦·⟧` of a policy expression: the set of rows it matches.                                      |
| **Drift**                      | Any discrepancy between the observed database state and the expected state derived from the policy algebra.                |
| **Effective access predicate** | The combined predicate `(∨ permissive) ∧ (∧ restrictive)` that determines row accessibility.                               |
| **FCA**                        | Formal Concept Analysis. A mathematical framework for deriving concept hierarchies from object-attribute relations.        |
| **Galois connection**          | A pair of monotone functions between ordered sets satisfying an adjunction property. Used to relate DSL and SQL semantics. |
| **Governance loop**            | The six-phase cycle: Define → Analyze → Compile → Apply → Monitor → Reconcile.                                             |
| **Normalization**              | The process of applying rewrite rules to reduce a policy to its canonical form.                                            |
| **Permissive policy**          | A policy whose clauses are OR'd together with other permissive policies. Grants access.                                    |
| **Policy**                     | A named, typed collection of clauses with a selector and command set.                                                      |
| **Policy set**                 | The complete collection of policies governing a database.                                                                  |
| **Reconciliation**             | The process of resolving drift between observed and expected database state.                                               |
| **Relationship**               | A declared foreign-key link between tables, used for traversal atoms.                                                      |
| **Restrictive policy**         | A policy whose clauses are AND'd with the permissive disjunction. Narrows access.                                          |
| **RLS**                        | Row-Level Security. PostgreSQL's mechanism for attaching row-filtering predicates to tables.                               |
| **Selector**                   | A predicate over table metadata that determines which tables a policy applies to.                                          |
| **SMT**                        | Satisfiability Modulo Theories. A decision procedure for logical formulas over combined theories.                          |
| **Subsumption**                | Relation where one policy/clause is at least as permissive as another.                                                     |
| **Traversal atom**             | An atom that uses `exists(relationship, clause)` to follow a foreign-key relationship.                                     |
| **Value source**               | A typed scalar producer: column reference, session variable, literal, or function call.                                    |

---

## Appendix C: References

1. **Bonatti, P.A., De Capitani di Vimercati, S., Samarati, P.** (2002).
   "An Algebra for Composing Access Control Policies."
   *ACM Transactions on Information and System Security*, 5(1), 1–35.

2. **PostgreSQL Documentation**. "Row Security Policies."
   https://www.postgresql.org/docs/current/ddl-rowsecurity.html

3. **Barrett, C., Tinelli, C.** "SMT-LIB: The Satisfiability Modulo Theories
   Library." https://smtlib.cs.uiowa.edu/

4. **de Moura, L., Bjørner, N.** (2008). "Z3: An Efficient SMT Solver."
   *Proceedings of TACAS 2008*, LNCS 4963, 337–340.

5. **Ganter, B., Wille, R.** (1999). *Formal Concept Analysis: Mathematical
   Foundations.* Springer.

6. **Zanzibar: Google's Consistent, Global Authorization System.** (2019).
   *Proceedings of USENIX ATC 2019*.

7. **Cousot, P., Cousot, R.** (1977). "Abstract Interpretation: A Unified
   Lattice Model for Static Analysis of Programs by Construction or
   Approximation of Fixpoints." *POPL '77*.

8. **PostgreSQL Documentation**. "System Catalogs — pg_policies."
   https://www.postgresql.org/docs/current/view-pg-policies.html

---

*End of specification.*
