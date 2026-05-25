-- pgTAP coverage for the orgs / org_members RLS policies.
--
-- Verifies that:
--   - A member can SELECT their own org
--   - A non-member cannot SELECT another user's org
--   - A member can SELECT co-members (themselves and any others)
--   - A non-member cannot SELECT org_members rows for an org they
--     don't belong to

begin;

select plan(4);

-- Two synthetic users
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
    ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'alice@example.invalid', '', now(), now(), now()),
    ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'bob@example.invalid', '', now(), now(), now());

-- Two orgs, one per user (each becomes their own owner via the trigger)
insert into public.orgs (id, name, created_by) values
    ('00000000-0000-0000-0000-000000000020', 'Alice Org', '00000000-0000-0000-0000-000000000010'),
    ('00000000-0000-0000-0000-000000000021', 'Bob Org',   '00000000-0000-0000-0000-000000000011');

-- Switch to "alice" as the authenticated role
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-000000000010","role":"authenticated"}';

-- Alice can see her own org
select is(
    (select count(*)::int from public.orgs where id = '00000000-0000-0000-0000-000000000020'),
    1,
    'alice can SELECT her own org'
);

-- Alice cannot see bob's org
select is(
    (select count(*)::int from public.orgs where id = '00000000-0000-0000-0000-000000000021'),
    0,
    'alice cannot SELECT bob''s org'
);

-- Alice can see herself in org_members for her org
select is(
    (select count(*)::int from public.org_members
     where org_id = '00000000-0000-0000-0000-000000000020'),
    1,
    'alice can SELECT org_members rows for her own org'
);

-- Alice cannot see bob's org_members rows
select is(
    (select count(*)::int from public.org_members
     where org_id = '00000000-0000-0000-0000-000000000021'),
    0,
    'alice cannot SELECT org_members rows for an org she does not belong to'
);

-- Reset role for clean rollback
reset role;

select * from finish();

rollback;
