-- Phase 1.2: Vault wrappers for target-database connection passwords.
--
-- Connection passwords for target databases (the thing Phase 1.1's
-- `target_databases.vault_secret_id` references) live in Supabase Vault,
-- not as plaintext columns. This migration adds two small SECURITY DEFINER
-- wrappers in the `public` schema:
--
--   public.set_target_db_password(secret text, name text) -> uuid
--     Stores a password in Vault, returns the secret id. The api updates
--     target_databases.vault_secret_id with this value.
--
--   public.get_target_db_password(target_id uuid) -> text
--     Joins target_databases to vault.decrypted_secrets via vault_secret_id
--     and returns the decrypted password. Used by the worker when it
--     connects to the target for introspection.
--
-- Both wrappers gate access via an internal pg_has_role check rather than
-- relying on schema grants alone (belt-and-suspenders: even if PUBLIC has
-- EXECUTE somehow, the function still rejects non-service-role callers).
-- EXECUTE is also explicitly revoked from PUBLIC and granted to service_role.

-- =====================================================================
-- set_target_db_password
-- =====================================================================

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
    v_secret_id uuid;
begin
    if not (
        pg_has_role(current_user, 'service_role', 'usage')
        or pg_has_role(current_user, 'postgres',  'usage')
    ) then
        raise exception 'set_target_db_password requires service_role';
    end if;

    v_secret_id := vault.create_secret(p_secret, p_name);
    return v_secret_id;
end;
$$;

revoke execute on function public.set_target_db_password(text, text) from public;
grant  execute on function public.set_target_db_password(text, text) to service_role;

-- =====================================================================
-- get_target_db_password
-- =====================================================================

create or replace function public.get_target_db_password(
    p_target_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_password text;
begin
    if not (
        pg_has_role(current_user, 'service_role', 'usage')
        or pg_has_role(current_user, 'postgres',  'usage')
    ) then
        raise exception 'get_target_db_password requires service_role';
    end if;

    select ds.decrypted_secret into v_password
    from public.target_databases td
    join vault.decrypted_secrets ds on ds.id = td.vault_secret_id
    where td.id = p_target_id;

    return v_password;
end;
$$;

revoke execute on function public.get_target_db_password(uuid) from public;
grant  execute on function public.get_target_db_password(uuid) to service_role;
