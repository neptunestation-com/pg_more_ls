-- pgTAP coverage for the org-delete RPC introduced in the
-- post-Phase-1 hardening pass.
--
-- delete_org cascades to org_members, target_databases, and
-- (transitively) schema_tables / schema_columns / schema_relationships.
-- It also removes any vault.secrets referenced by deleted targets so
-- those don't orphan.

set search_path = public, extensions;
set role postgres;

begin;

select plan(13);

-- =====================================================================
-- Function shape + grants
-- =====================================================================

select has_function('public', 'delete_org', array['uuid'],
    'delete_org function exists');

select is(
    (select prosecdef from pg_proc
     where oid = 'public.delete_org(uuid)'::regprocedure),
    true, 'delete_org is SECURITY DEFINER');

select is(
    has_function_privilege('authenticated', 'public.delete_org(uuid)', 'execute'),
    true, 'authenticated has EXECUTE on delete_org');

select is(
    has_function_privilege('anon', 'public.delete_org(uuid)', 'execute'),
    false, 'anon does NOT have EXECUTE on delete_org');

-- =====================================================================
-- Setup: alice owns org A (with a target), bob owns org B,
-- carol is a non-owner *member* of org A
-- =====================================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
    ('00000000-0000-0000-0000-000000000a00', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'alice-delorg@example.invalid', '', now(), now(), now()),
    ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'bob-delorg@example.invalid',   '', now(), now(), now()),
    ('00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'carol-delorg@example.invalid', '', now(), now(), now());

insert into public.orgs (id, name, created_by) values
    ('00000000-0000-0000-0000-000000000b00', 'Alice DelOrg', '00000000-0000-0000-0000-000000000a00'),
    ('00000000-0000-0000-0000-000000000b01', 'Bob DelOrg',   '00000000-0000-0000-0000-000000000a01');

-- Carol joins alice's org as a regular member (not owner)
insert into public.org_members (org_id, user_id, role) values
    ('00000000-0000-0000-0000-000000000b00', '00000000-0000-0000-0000-000000000a02', 'member');

-- Alice adds a target with a vault secret so we can verify cleanup
set local "request.jwt.claims" to
    '{"sub":"00000000-0000-0000-0000-000000000a00","role":"authenticated"}';

do $$
declare
    v_id uuid;
begin
    v_id := public.create_target(
        '00000000-0000-0000-0000-000000000b00'::uuid,
        'alice-target',
        'db.alice.invalid', 5432, 'postgres', 'postgres', 'alicepw'
    );
end;
$$;

-- Stash the vault_secret_id so we can later assert it was deleted
do $$
declare
    v_sec uuid;
begin
    select vault_secret_id into v_sec
    from public.target_databases
    where org_id = '00000000-0000-0000-0000-000000000b00';
    create temp table __alice_vault_sec (id uuid) on commit drop;
    insert into __alice_vault_sec values (v_sec);
end;
$$;

-- =====================================================================
-- Authorization: non-member, non-owner member, unauthenticated
-- =====================================================================

-- Bob (non-member) can't delete alice's org
set local "request.jwt.claims" to
    '{"sub":"00000000-0000-0000-0000-000000000a01","role":"authenticated"}';

select throws_ok(
    $$select public.delete_org('00000000-0000-0000-0000-000000000b00'::uuid)$$,
    NULL, NULL,
    'bob (non-member) cannot delete alice''s org');

-- Carol (member but not owner) can't delete
set local "request.jwt.claims" to
    '{"sub":"00000000-0000-0000-0000-000000000a02","role":"authenticated"}';

select throws_ok(
    $$select public.delete_org('00000000-0000-0000-0000-000000000b00'::uuid)$$,
    NULL, NULL,
    'carol (member, not owner) cannot delete alice''s org');

-- Unauthenticated (no JWT claim → auth.uid() is null)
set local "request.jwt.claims" to '{}';

select throws_ok(
    $$select public.delete_org('00000000-0000-0000-0000-000000000b00'::uuid)$$,
    NULL, NULL,
    'unauthenticated call to delete_org fails');

-- Nonexistent org id (alice, but bad uuid)
set local "request.jwt.claims" to
    '{"sub":"00000000-0000-0000-0000-000000000a00","role":"authenticated"}';

select throws_ok(
    $$select public.delete_org('00000000-0000-0000-0000-0000deadbeef'::uuid)$$,
    NULL, NULL,
    'delete_org on nonexistent org id fails');

-- =====================================================================
-- Happy path: alice (owner) deletes her org
-- =====================================================================

select lives_ok(
    $$select public.delete_org('00000000-0000-0000-0000-000000000b00'::uuid)$$,
    'alice (owner) can delete her own org');

select is(
    (select count(*)::int from public.orgs
     where id = '00000000-0000-0000-0000-000000000b00'),
    0,
    'org row is gone');

select is(
    (select count(*)::int from public.org_members
     where org_id = '00000000-0000-0000-0000-000000000b00'),
    0,
    'org_members rows cascaded away');

select is(
    (select count(*)::int from public.target_databases
     where org_id = '00000000-0000-0000-0000-000000000b00'),
    0,
    'target_databases rows cascaded away');

select is(
    (select count(*)::int from vault.secrets
     where id = (select id from __alice_vault_sec)),
    0,
    'vault secret for the deleted target was cleaned up');

select * from finish();

rollback;
