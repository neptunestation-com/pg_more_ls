-- pgTAP coverage for the Phase 1.4 RPC wrappers + q_introspect queue.

set search_path = public, extensions;
set role postgres;

begin;

select plan(21);

-- =====================================================================
-- Queue + function shape
-- =====================================================================

-- pgmq.create() inserts into pgmq.meta; verify the row landed
select is(
    (select count(*)::int from pgmq.meta where queue_name = 'q_introspect'),
    1,
    'q_introspect queue is registered in pgmq.meta');

select has_function('public', 'create_target',
    array['uuid','text','text','integer','text','text','text','boolean','text'],
    'create_target function exists');

select has_function('public', 'delete_target', array['uuid'],
    'delete_target function exists');

select has_function('public', 'enqueue_introspect', array['uuid'],
    'enqueue_introspect function exists');

select is(
    (select prosecdef from pg_proc
     where oid = 'public.create_target(uuid, text, text, integer, text, text, text, boolean, text)'::regprocedure),
    true, 'create_target is SECURITY DEFINER');

select is(
    (select prosecdef from pg_proc
     where oid = 'public.delete_target(uuid)'::regprocedure),
    true, 'delete_target is SECURITY DEFINER');

select is(
    (select prosecdef from pg_proc
     where oid = 'public.enqueue_introspect(uuid)'::regprocedure),
    true, 'enqueue_introspect is SECURITY DEFINER');

-- Grants: authenticated has EXECUTE; anon does not
select is(
    has_function_privilege('authenticated',
        'public.create_target(uuid, text, text, integer, text, text, text, boolean, text)',
        'execute'),
    true, 'authenticated has EXECUTE on create_target');

select is(
    has_function_privilege('anon',
        'public.create_target(uuid, text, text, integer, text, text, text, boolean, text)',
        'execute'),
    false, 'anon does NOT have EXECUTE on create_target');

select is(
    has_function_privilege('authenticated', 'public.delete_target(uuid)', 'execute'),
    true, 'authenticated has EXECUTE on delete_target');

select is(
    has_function_privilege('authenticated', 'public.enqueue_introspect(uuid)', 'execute'),
    true, 'authenticated has EXECUTE on enqueue_introspect');

-- =====================================================================
-- Setup: alice (owner of org A) and bob (owner of org B; not a member of A)
-- =====================================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
    ('00000000-0000-0000-0000-000000000800', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'alice-p14@example.invalid', '', now(), now(), now()),
    ('00000000-0000-0000-0000-000000000801', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'bob-p14@example.invalid', '', now(), now(), now());

insert into public.orgs (id, name, created_by) values
    ('00000000-0000-0000-0000-000000000900', 'Alice P1.4 Org', '00000000-0000-0000-0000-000000000800'),
    ('00000000-0000-0000-0000-000000000901', 'Bob P1.4 Org',   '00000000-0000-0000-0000-000000000801');

-- =====================================================================
-- create_target: allowed for member, denied for non-member
-- =====================================================================

-- Become alice via JWT claim (no role switch needed; auth.uid() reads claims)
set local "request.jwt.claims" to
    '{"sub":"00000000-0000-0000-0000-000000000800","role":"authenticated"}';

select lives_ok(
    $$select public.create_target(
        '00000000-0000-0000-0000-000000000900'::uuid,
        'alice-target',
        'db.alice.invalid', 5432, 'postgres', 'postgres', 'alicepw'
    )$$,
    'alice (org member) can call create_target');

select is(
    (select count(*)::int from public.target_databases
     where org_id = '00000000-0000-0000-0000-000000000900' and name = 'alice-target'),
    1,
    'create_target inserted the row');

select isnt(
    (select vault_secret_id from public.target_databases
     where org_id = '00000000-0000-0000-0000-000000000900' and name = 'alice-target'),
    null,
    'create_target stored a vault secret');

-- Now become bob (not a member of alice's org)
set local "request.jwt.claims" to
    '{"sub":"00000000-0000-0000-0000-000000000801","role":"authenticated"}';

select throws_ok(
    $$select public.create_target(
        '00000000-0000-0000-0000-000000000900'::uuid,
        'bob-sneaky',
        'db.bob.invalid', 5432, 'postgres', 'postgres', 'bobpw'
    )$$,
    NULL, NULL,
    'bob (non-member) cannot call create_target on alice''s org');

-- =====================================================================
-- enqueue_introspect: allowed for member, denied for non-member,
-- and the message actually lands on q_introspect
-- =====================================================================

-- Switch back to alice
set local "request.jwt.claims" to
    '{"sub":"00000000-0000-0000-0000-000000000800","role":"authenticated"}';

-- Capture the alice target id and msg_id we'll dequeue to verify
do $$
declare
    v_target_id uuid;
    v_msg_id    bigint;
begin
    select id into v_target_id
    from public.target_databases
    where name = 'alice-target' limit 1;

    v_msg_id := public.enqueue_introspect(v_target_id);

    -- Stash msg_id in a temp table for the next pgTAP assertion
    create temp table __test_msg_id (id bigint) on commit drop;
    insert into __test_msg_id values (v_msg_id);
end;
$$;

select isnt(
    (select id from __test_msg_id limit 1),
    null,
    'enqueue_introspect returned a non-null msg_id');

-- Read from the queue with a long-ish visibility timeout so we don't
-- accidentally redeliver during the test transaction
select is(
    (select count(*)::int
     from pgmq.read('q_introspect', 30, 10)
     where msg_id = (select id from __test_msg_id)),
    1,
    'message visible on q_introspect with the expected msg_id');

-- bob can't enqueue on alice's target
set local "request.jwt.claims" to
    '{"sub":"00000000-0000-0000-0000-000000000801","role":"authenticated"}';

select throws_ok(
    $$select public.enqueue_introspect((
        select id from public.target_databases where name = 'alice-target' limit 1
    ))$$,
    NULL, NULL,
    'bob cannot enqueue_introspect on alice''s target');

-- =====================================================================
-- delete_target: allowed for owner, denied for non-owner
-- =====================================================================

-- Alice is the owner of her own org (trigger auto-added her on org create)
set local "request.jwt.claims" to
    '{"sub":"00000000-0000-0000-0000-000000000800","role":"authenticated"}';

-- Add a second target alice can delete
do $$
declare
    v_id uuid;
begin
    v_id := public.create_target(
        '00000000-0000-0000-0000-000000000900'::uuid,
        'alice-deletable',
        'db.alice.invalid', 5432, 'postgres', 'postgres', 'alicepw2'
    );
end;
$$;

-- Bob tries first (should fail; he's not owner of alice's org)
set local "request.jwt.claims" to
    '{"sub":"00000000-0000-0000-0000-000000000801","role":"authenticated"}';

select throws_ok(
    $$select public.delete_target((
        select id from public.target_databases where name = 'alice-deletable' limit 1
    ))$$,
    NULL, NULL,
    'bob (non-owner) cannot delete_target on alice''s target');

-- Alice succeeds
set local "request.jwt.claims" to
    '{"sub":"00000000-0000-0000-0000-000000000800","role":"authenticated"}';

select lives_ok(
    $$select public.delete_target((
        select id from public.target_databases where name = 'alice-deletable' limit 1
    ))$$,
    'alice (owner) can delete_target');

select is(
    (select count(*)::int from public.target_databases where name = 'alice-deletable'),
    0,
    'delete_target removed the row');

select * from finish();

rollback;
