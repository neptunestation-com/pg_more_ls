-- pgTAP coverage for the orgs_add_creator_as_owner trigger.
--
-- When a row is inserted into orgs, the trigger should auto-create a
-- corresponding org_members row with role='owner' for the creator.

begin;

select plan(3);

-- Create a synthetic auth user to satisfy the FK. We insert directly
-- into auth.users with the postgres role bypassing constraints; this
-- isolates the test from the real Supabase Auth signup flow.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated',
        'pgtap-trigger-test@example.invalid',
        '',
        now(), now(), now());

-- Insert an org as that user
insert into public.orgs (name, created_by)
values ('Trigger Test Org', '00000000-0000-0000-0000-000000000001');

-- A single org_members row should now exist, attributed to the creator,
-- with role 'owner'.
select is(
    (select count(*)::int from public.org_members
     where user_id = '00000000-0000-0000-0000-000000000001'),
    1,
    'exactly one org_members row for the creator'
);

select is(
    (select role from public.org_members
     where user_id = '00000000-0000-0000-0000-000000000001'
     limit 1),
    'owner',
    'creator was added as owner'
);

select is(
    (select org_id from public.org_members
     where user_id = '00000000-0000-0000-0000-000000000001'
     limit 1),
    (select id from public.orgs
     where name = 'Trigger Test Org'
     limit 1),
    'org_id on member row matches the org just created'
);

select * from finish();

rollback;
