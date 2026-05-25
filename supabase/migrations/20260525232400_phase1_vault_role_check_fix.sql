-- Phase 1.2 fixup: correct the role gate inside the Vault wrappers.
--
-- The original migration (20260525232012) used
-- `pg_has_role(current_user, ...)`, but inside a SECURITY DEFINER function
-- `current_user` is the function *owner* (postgres) — not the caller — so
-- that check was tautologically true and the gate never rejected anyone.
--
-- Replaces both function bodies with an identity check that actually
-- reflects the caller. The model: trust the JWT `role` claim that
-- PostgREST sets per-request. If a JWT is present, only `service_role`
-- callers proceed; everything else (`authenticated`, `anon`, ...) is
-- rejected. If no JWT is present at all, the caller is a direct PG
-- connection (the worker connects this way) and is allowed by virtue of
-- already being inside the database trust boundary.
--
-- The GRANT EXECUTE to service_role + REVOKE FROM PUBLIC from the
-- original migration still apply.

create or replace function public.set_target_db_password(
    p_secret text,
    p_name   text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_jwt_role  text := nullif(current_setting('request.jwt.claims', true), '')::json->>'role';
    v_secret_id uuid;
begin
    if v_jwt_role is not null and v_jwt_role <> 'service_role' then
        raise exception 'set_target_db_password requires service_role (got %)', v_jwt_role;
    end if;

    v_secret_id := vault.create_secret(p_secret, p_name);
    return v_secret_id;
end;
$$;

create or replace function public.get_target_db_password(
    p_target_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_jwt_role text := nullif(current_setting('request.jwt.claims', true), '')::json->>'role';
    v_password text;
begin
    if v_jwt_role is not null and v_jwt_role <> 'service_role' then
        raise exception 'get_target_db_password requires service_role (got %)', v_jwt_role;
    end if;

    select ds.decrypted_secret into v_password
    from public.target_databases td
    join vault.decrypted_secrets ds on ds.id = td.vault_secret_id
    where td.id = p_target_id;

    return v_password;
end;
$$;

-- Explicitly revoke EXECUTE from end-user roles. Supabase's project-level
-- default privileges grant EXECUTE on public-schema functions to
-- authenticated and anon, so REVOKE FROM PUBLIC alone (from 20260525232012)
-- isn't enough.
revoke execute on function public.set_target_db_password(text, text) from authenticated, anon;
revoke execute on function public.get_target_db_password(uuid)        from authenticated, anon;
grant  execute on function public.set_target_db_password(text, text) to service_role;
grant  execute on function public.get_target_db_password(uuid)        to service_role;
