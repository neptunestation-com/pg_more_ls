-- pgTAP coverage for the Phase 0.2 identity schema.
--
-- Verifies that orgs + org_members exist with the expected shape,
-- that RLS is enabled, that the helper function and trigger are
-- registered. These are sanity checks; behavioral tests live in
-- adjacent files.

begin;

select plan(15);

-- Tables exist
select has_table('public', 'orgs', 'orgs table exists');
select has_table('public', 'org_members', 'org_members table exists');

-- orgs columns
select has_column('public', 'orgs', 'id', 'orgs.id exists');
select has_column('public', 'orgs', 'name', 'orgs.name exists');
select has_column('public', 'orgs', 'created_at', 'orgs.created_at exists');
select has_column('public', 'orgs', 'created_by', 'orgs.created_by exists');

-- org_members columns
select has_column('public', 'org_members', 'org_id', 'org_members.org_id exists');
select has_column('public', 'org_members', 'user_id', 'org_members.user_id exists');
select has_column('public', 'org_members', 'role', 'org_members.role exists');

-- RLS enabled
select is(
    (select relrowsecurity from pg_class where oid = 'public.orgs'::regclass),
    true,
    'RLS enabled on orgs'
);
select is(
    (select relrowsecurity from pg_class where oid = 'public.org_members'::regclass),
    true,
    'RLS enabled on org_members'
);

-- Helper function exists and is SECURITY DEFINER
select has_function('public', 'is_org_member', array['uuid'], 'is_org_member(uuid) exists');
select is(
    (select prosecdef from pg_proc where oid = 'public.is_org_member(uuid)'::regprocedure),
    true,
    'is_org_member is SECURITY DEFINER'
);

-- Trigger function exists
select has_function('public', 'handle_new_org', array[]::text[], 'handle_new_org() exists');

-- Trigger registered
select has_trigger('public', 'orgs', 'orgs_add_creator_as_owner', 'orgs_add_creator_as_owner trigger exists');

select * from finish();

rollback;
