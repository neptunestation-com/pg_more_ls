-- Post-Phase-1 hardening: org delete RPC.
--
-- Adds public.delete_org(p_org_id uuid) — SECURITY DEFINER, JWT-claim
-- gated. Mirrors delete_target's shape:
--   1. Require an authenticated caller.
--   2. Require the caller to be an *owner* of the org.
--   3. Collect every vault.secret_id referenced by target_databases in
--      this org and delete them (FK CASCADE doesn't reach into Vault).
--   4. DELETE the org row; CASCADE handles org_members + target_databases
--      + schema_tables/columns/relationships.
--
-- Why an RPC instead of a DELETE RLS policy on orgs:
-- a plain `DELETE` would leave Vault secrets orphaned (vault.secrets has
-- no FK back to target_databases), and we don't want to grant the
-- authenticated role direct access to vault.secrets. SECURITY DEFINER
-- lets us encapsulate the cross-schema cleanup with a single owner check.

create or replace function public.delete_org(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id    uuid := (select auth.uid());
    v_is_owner   boolean;
    v_org_exists boolean;
begin
    if v_user_id is null then
        raise exception 'delete_org requires authentication';
    end if;

    select exists (select 1 from public.orgs where id = p_org_id)
    into v_org_exists;

    if not v_org_exists then
        raise exception 'org not found: %', p_org_id;
    end if;

    select exists (
        select 1 from public.org_members
        where org_id  = p_org_id
          and user_id = v_user_id
          and role    = 'owner'
    ) into v_is_owner;

    if not v_is_owner then
        raise exception 'user is not an owner of org %', p_org_id;
    end if;

    -- Clean up vault secrets for every target in this org before the
    -- cascade nukes the target_databases rows that reference them.
    delete from vault.secrets
    where id in (
        select vault_secret_id
        from public.target_databases
        where org_id = p_org_id
          and vault_secret_id is not null
    );

    delete from public.orgs where id = p_org_id;
end;
$$;

revoke execute on function public.delete_org(uuid) from public, anon;
grant  execute on function public.delete_org(uuid) to authenticated, service_role;
