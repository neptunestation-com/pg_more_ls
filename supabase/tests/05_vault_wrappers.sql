-- pgTAP coverage for the Phase 1.2 Vault wrappers:
--   public.set_target_db_password(text, text) -> uuid
--   public.get_target_db_password(uuid) -> text
--
-- Verifies the functions exist with SECURITY DEFINER, the role gate works,
-- and a roundtrip (set then get) returns the original password.

set search_path = public, extensions;
set role postgres;

begin;

select plan(14);

-- =====================================================================
-- Function shape
-- =====================================================================

select has_function('public', 'set_target_db_password', array['text', 'text'],
    'set_target_db_password(text, text) exists');
select has_function('public', 'get_target_db_password', array['uuid'],
    'get_target_db_password(uuid) exists');

select is(
    (select prosecdef from pg_proc
     where oid = 'public.set_target_db_password(text, text)'::regprocedure),
    true,
    'set_target_db_password is SECURITY DEFINER');

select is(
    (select prosecdef from pg_proc
     where oid = 'public.get_target_db_password(uuid)'::regprocedure),
    true,
    'get_target_db_password is SECURITY DEFINER');

-- PUBLIC must not have EXECUTE on either function.
-- has_function_privilege returns true if the role has the privilege.
select is(
    has_function_privilege('public', 'public.set_target_db_password(text, text)', 'execute'),
    false,
    'PUBLIC does not have EXECUTE on set_target_db_password');

select is(
    has_function_privilege('public', 'public.get_target_db_password(uuid)', 'execute'),
    false,
    'PUBLIC does not have EXECUTE on get_target_db_password');

-- service_role must have EXECUTE.
select is(
    has_function_privilege('service_role', 'public.set_target_db_password(text, text)', 'execute'),
    true,
    'service_role has EXECUTE on set_target_db_password');

select is(
    has_function_privilege('service_role', 'public.get_target_db_password(uuid)', 'execute'),
    true,
    'service_role has EXECUTE on get_target_db_password');

-- authenticated must NOT have EXECUTE (belt-and-suspenders alongside the
-- in-function JWT role check; catches grant regressions even if the
-- in-function check were ever loosened by accident).
select is(
    has_function_privilege('authenticated', 'public.set_target_db_password(text, text)', 'execute'),
    false,
    'authenticated does not have EXECUTE on set_target_db_password');

select is(
    has_function_privilege('authenticated', 'public.get_target_db_password(uuid)', 'execute'),
    false,
    'authenticated does not have EXECUTE on get_target_db_password');

-- =====================================================================
-- Roundtrip — set a secret, attach to a target, get it back
-- =====================================================================

-- Need a target_databases row to attach the vault secret to. Set up
-- minimal scaffolding (user → org → target).
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000500',
        '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated',
        'vault-test@example.invalid', '', now(), now(), now());

insert into public.orgs (id, name, created_by)
values ('00000000-0000-0000-0000-000000000600',
        'Vault Test Org',
        '00000000-0000-0000-0000-000000000500');

insert into public.target_databases (id, org_id, name, host, database, username, created_by)
values ('00000000-0000-0000-0000-000000000700',
        '00000000-0000-0000-0000-000000000600',
        'Vault Test Target', 'db.test.invalid', 'postgres', 'postgres',
        '00000000-0000-0000-0000-000000000500');

-- Store a password in Vault and link it to the target
do $$
declare
    v_secret_id uuid;
begin
    v_secret_id := public.set_target_db_password(
        'super-secret-test-password-do-not-use',
        'pgtap-test-' || gen_random_uuid()::text
    );
    update public.target_databases
       set vault_secret_id = v_secret_id
       where id = '00000000-0000-0000-0000-000000000700';
end;
$$;

select isnt(
    (select vault_secret_id from public.target_databases
     where id = '00000000-0000-0000-0000-000000000700'),
    null,
    'vault_secret_id populated after set_target_db_password + update');

select is(
    public.get_target_db_password('00000000-0000-0000-0000-000000000700'),
    'super-secret-test-password-do-not-use',
    'get_target_db_password returns the original plaintext');

-- =====================================================================
-- Role gate — authenticated role can't call either function
-- =====================================================================

set local role authenticated;
set local "request.jwt.claims" to
    '{"sub":"00000000-0000-0000-0000-000000000500","role":"authenticated"}';

select throws_ok(
    $$select public.set_target_db_password('x', 'y')$$,
    NULL, NULL,
    'authenticated cannot call set_target_db_password');

select throws_ok(
    $$select public.get_target_db_password('00000000-0000-0000-0000-000000000700'::uuid)$$,
    NULL, NULL,
    'authenticated cannot call get_target_db_password');

select * from finish();

rollback;
