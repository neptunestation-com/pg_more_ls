-- pgTAP coverage for the Phase 1.1 schema:
--   target_databases / schema_tables / schema_columns / schema_relationships
--   plus the two helper functions and their RLS policies.

set search_path = public, extensions;
set role postgres;

begin;

select plan(36);

-- =====================================================================
-- Schema sanity
-- =====================================================================

select has_table('public', 'target_databases',     'target_databases table exists');
select has_table('public', 'schema_tables',        'schema_tables table exists');
select has_table('public', 'schema_columns',       'schema_columns table exists');
select has_table('public', 'schema_relationships', 'schema_relationships table exists');

select has_column('public', 'target_databases', 'org_id',        'target_databases.org_id exists');
select has_column('public', 'target_databases', 'vault_secret_id', 'target_databases.vault_secret_id exists');
select has_column('public', 'target_databases', 'is_production', 'target_databases.is_production exists');
select has_column('public', 'target_databases', 'ssl_mode',      'target_databases.ssl_mode exists');

select has_column('public', 'schema_tables', 'has_rls',           'schema_tables.has_rls exists');
select has_column('public', 'schema_tables', 'governance_status', 'schema_tables.governance_status exists');

-- (governance_status is a generated column from a CASE expression that can't
--  return NULL — semantic guarantee is in the expression itself; we don't
--  rely on a SET NOT NULL constraint at the catalog level.)

-- =====================================================================
-- RLS enabled
-- =====================================================================

select is(
    (select relrowsecurity from pg_class where oid = 'public.target_databases'::regclass),
    true, 'RLS on target_databases');
select is(
    (select relrowsecurity from pg_class where oid = 'public.schema_tables'::regclass),
    true, 'RLS on schema_tables');
select is(
    (select relrowsecurity from pg_class where oid = 'public.schema_columns'::regclass),
    true, 'RLS on schema_columns');
select is(
    (select relrowsecurity from pg_class where oid = 'public.schema_relationships'::regclass),
    true, 'RLS on schema_relationships');

-- =====================================================================
-- Helper functions
-- =====================================================================

select has_function('public', 'target_belongs_to_my_org', array['uuid'],
    'target_belongs_to_my_org(uuid) exists');
select is(
    (select prosecdef from pg_proc where oid = 'public.target_belongs_to_my_org(uuid)'::regprocedure),
    true, 'target_belongs_to_my_org is SECURITY DEFINER');

select has_function('public', 'target_belongs_to_my_owned_org', array['uuid'],
    'target_belongs_to_my_owned_org(uuid) exists');
select is(
    (select prosecdef from pg_proc where oid = 'public.target_belongs_to_my_owned_org(uuid)'::regprocedure),
    true, 'target_belongs_to_my_owned_org is SECURITY DEFINER');

-- =====================================================================
-- Generated column behavior
-- =====================================================================

-- Set up two synthetic users with their own orgs (trigger auto-adds them as owners)
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
    ('00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'alice-p1@example.invalid', '', now(), now(), now()),
    ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'bob-p1@example.invalid',   '', now(), now(), now());

insert into public.orgs (id, name, created_by) values
    ('00000000-0000-0000-0000-000000000200', 'Alice Phase1 Org', '00000000-0000-0000-0000-000000000100'),
    ('00000000-0000-0000-0000-000000000201', 'Bob Phase1 Org',   '00000000-0000-0000-0000-000000000101');

insert into public.target_databases (id, org_id, name, host, database, username, created_by) values
    ('00000000-0000-0000-0000-000000000300',
     '00000000-0000-0000-0000-000000000200',
     'Alice DB', 'db.alice.invalid', 'postgres', 'postgres',
     '00000000-0000-0000-0000-000000000100');

insert into public.schema_tables (id, target_id, schema_name, table_name, has_rls) values
    ('00000000-0000-0000-0000-000000000400',
     '00000000-0000-0000-0000-000000000300', 'public', 'orders', false),
    ('00000000-0000-0000-0000-000000000401',
     '00000000-0000-0000-0000-000000000300', 'public', 'invoices', true);

select is(
    (select governance_status from public.schema_tables where id = '00000000-0000-0000-0000-000000000400'),
    'red',
    'governance_status is red when has_rls = false');
select is(
    (select governance_status from public.schema_tables where id = '00000000-0000-0000-0000-000000000401'),
    'yellow',
    'governance_status is yellow when has_rls = true');

-- =====================================================================
-- RLS behavior — alice can see her stuff, bob cannot
-- =====================================================================

-- Switch to alice as authenticated
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-000000000100","role":"authenticated"}';

select is(
    (select count(*)::int from public.target_databases
     where id = '00000000-0000-0000-0000-000000000300'),
    1, 'alice can SELECT her own target');

select is(
    (select count(*)::int from public.schema_tables where target_id = '00000000-0000-0000-0000-000000000300'),
    2, 'alice can SELECT schema_tables on her target (2 rows)');

-- Insert a column row as service-role for visibility check
set local role postgres;
insert into public.schema_columns (table_id, name, data_type, ordinal) values
    ('00000000-0000-0000-0000-000000000400', 'id',         'bigint', 0),
    ('00000000-0000-0000-0000-000000000400', 'tenant_id',  'uuid',   1);

insert into public.schema_relationships
    (target_id, source_table_id, source_column, target_table_id, target_column, constraint_name) values
    ('00000000-0000-0000-0000-000000000300',
     '00000000-0000-0000-0000-000000000400', 'tenant_id',
     '00000000-0000-0000-0000-000000000401', 'id',
     'orders_tenant_id_fkey');

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-000000000100","role":"authenticated"}';

select is(
    (select count(*)::int from public.schema_columns
     where table_id = '00000000-0000-0000-0000-000000000400'),
    2, 'alice can SELECT schema_columns through her target');

select is(
    (select count(*)::int from public.schema_relationships
     where target_id = '00000000-0000-0000-0000-000000000300'),
    1, 'alice can SELECT schema_relationships on her target');

-- Switch to bob — should see nothing of alice's
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-000000000101","role":"authenticated"}';

select is(
    (select count(*)::int from public.target_databases
     where id = '00000000-0000-0000-0000-000000000300'),
    0, 'bob cannot SELECT alice''s target');

select is(
    (select count(*)::int from public.schema_tables where target_id = '00000000-0000-0000-0000-000000000300'),
    0, 'bob cannot SELECT alice''s schema_tables');

select is(
    (select count(*)::int from public.schema_columns where table_id = '00000000-0000-0000-0000-000000000400'),
    0, 'bob cannot SELECT alice''s schema_columns');

select is(
    (select count(*)::int from public.schema_relationships where target_id = '00000000-0000-0000-0000-000000000300'),
    0, 'bob cannot SELECT alice''s schema_relationships');

-- =====================================================================
-- Insert / Update / Delete policies
-- =====================================================================

-- Alice can INSERT a target in her own org (must set created_by = self)
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-000000000100","role":"authenticated"}';

select lives_ok(
    $$insert into public.target_databases (org_id, name, host, database, username, created_by)
      values ('00000000-0000-0000-0000-000000000200',
              'Alice DB 2', 'db2.alice.invalid', 'postgres', 'postgres',
              '00000000-0000-0000-0000-000000000100')$$,
    'alice can INSERT a target into her own org');

-- Alice cannot INSERT a target into bob's org (RLS rejects)
select throws_ok(
    $$insert into public.target_databases (org_id, name, host, database, username, created_by)
      values ('00000000-0000-0000-0000-000000000201',
              'Sneaky DB', 'db.alice.invalid', 'postgres', 'postgres',
              '00000000-0000-0000-0000-000000000100')$$,
    NULL,
    NULL,
    'alice cannot INSERT a target into another org (RLS blocks)');

-- Alice (owner of her org) can UPDATE her target
select lives_ok(
    $$update public.target_databases
      set name = 'Alice DB renamed'
      where id = '00000000-0000-0000-0000-000000000300'$$,
    'alice (owner) can UPDATE her own target');

-- Alice (owner) can DELETE her target
select lives_ok(
    $$delete from public.target_databases
      where id = '00000000-0000-0000-0000-000000000300'$$,
    'alice (owner) can DELETE her own target');

-- Reset for the next batch — make a new target for the bob-can't-update test
set local role postgres;
insert into public.target_databases (id, org_id, name, host, database, username, created_by)
values ('00000000-0000-0000-0000-000000000301',
        '00000000-0000-0000-0000-000000000200',
        'Alice DB 3', 'db3.alice.invalid', 'postgres', 'postgres',
        '00000000-0000-0000-0000-000000000100');

-- Bob (non-member of alice's org) cannot UPDATE alice's target. The UPDATE
-- silently affects 0 rows under RLS rather than throwing — verify via row count.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-000000000101","role":"authenticated"}';

with attempted as (
    update public.target_databases set name = 'pwned'
    where id = '00000000-0000-0000-0000-000000000301'
    returning 1
)
select is(
    (select count(*)::int from attempted),
    0,
    'bob cannot UPDATE alice''s target (0 rows affected)');

-- Same for delete
with attempted as (
    delete from public.target_databases
    where id = '00000000-0000-0000-0000-000000000301'
    returning 1
)
select is(
    (select count(*)::int from attempted),
    0,
    'bob cannot DELETE alice''s target (0 rows affected)');

-- Confirm the target is still intact from service-role's perspective
set local role postgres;
select is(
    (select name from public.target_databases where id = '00000000-0000-0000-0000-000000000301'),
    'Alice DB 3',
    'alice''s target unchanged after bob''s attempts');

-- =====================================================================
-- Policy registration (sanity that all 7 policies got created)
-- =====================================================================

select is(
    (select count(*)::int from pg_policies
     where schemaname = 'public'
       and tablename in ('target_databases', 'schema_tables', 'schema_columns', 'schema_relationships')),
    7,
    'all 7 Phase 1.1 policies registered');

select * from finish();

rollback;
