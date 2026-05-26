-- Phase 1.4: RPC wrappers for target management + the q_introspect queue
-- that the Phase 1.5 worker will consume.
--
-- The Ktor api stays thin: each endpoint POSTs to PostgREST's /rpc/
-- with the user's Bearer JWT, and PostgREST sets `request.jwt.claims`
-- so `auth.uid()` inside these SECURITY DEFINER functions resolves to
-- the calling user.
--
-- The functions do their own access checks (member-of-org / owner)
-- rather than relying on the caller's role — they're SECURITY DEFINER
-- so they can write to vault.secrets and pgmq queues that end-user
-- roles can't reach directly.

-- =====================================================================
-- q_introspect queue
-- =====================================================================

select pgmq.create('q_introspect');

-- =====================================================================
-- create_target
-- Atomically: store password in Vault + insert target_databases row.
-- Caller must be a member of the org_id passed in.
-- =====================================================================

create or replace function public.create_target(
    p_org_id        uuid,
    p_name          text,
    p_host          text,
    p_port          integer,
    p_database      text,
    p_username      text,
    p_password      text,
    p_is_production boolean default false,
    p_ssl_mode      text    default 'require'
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id   uuid := (select auth.uid());
    v_is_member boolean;
    v_secret_id uuid;
    v_target_id uuid;
begin
    if v_user_id is null then
        raise exception 'create_target requires authentication';
    end if;

    select exists (
        select 1
        from public.org_members
        where org_id  = p_org_id
          and user_id = v_user_id
    ) into v_is_member;

    if not v_is_member then
        raise exception 'user is not a member of org %', p_org_id;
    end if;

    v_secret_id := vault.create_secret(
        p_password,
        format('target_db_%s', gen_random_uuid())
    );

    insert into public.target_databases (
        org_id, name, host, port, database, username,
        vault_secret_id, is_production, ssl_mode, created_by
    ) values (
        p_org_id, p_name, p_host, p_port, p_database, p_username,
        v_secret_id, p_is_production, p_ssl_mode, v_user_id
    ) returning id into v_target_id;

    return v_target_id;
end;
$$;

revoke execute on function public.create_target(uuid, text, text, integer, text, text, text, boolean, text)
    from public, anon;
grant execute on function public.create_target(uuid, text, text, integer, text, text, text, boolean, text)
    to authenticated, service_role;

-- =====================================================================
-- delete_target
-- Atomically: delete the vault secret + delete the target row (CASCADE
-- removes schema_tables / schema_columns / schema_relationships).
-- Caller must be an *owner* of the org owning the target.
-- =====================================================================

create or replace function public.delete_target(p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id   uuid := (select auth.uid());
    v_secret_id uuid;
    v_is_owner  boolean;
begin
    if v_user_id is null then
        raise exception 'delete_target requires authentication';
    end if;

    select td.vault_secret_id,
           exists (
               select 1 from public.org_members om
               where om.org_id  = td.org_id
                 and om.user_id = v_user_id
                 and om.role    = 'owner'
           )
    into v_secret_id, v_is_owner
    from public.target_databases td
    where td.id = p_target_id;

    if not found then
        raise exception 'target not found: %', p_target_id;
    end if;

    if not v_is_owner then
        raise exception 'user is not an owner of the org owning target %', p_target_id;
    end if;

    if v_secret_id is not null then
        delete from vault.secrets where id = v_secret_id;
    end if;

    delete from public.target_databases where id = p_target_id;
end;
$$;

revoke execute on function public.delete_target(uuid) from public, anon;
grant  execute on function public.delete_target(uuid) to authenticated, service_role;

-- =====================================================================
-- enqueue_introspect
-- Enqueues an introspect job for a target. Caller must be a member of
-- the org owning the target. Returns the pgmq msg_id.
-- =====================================================================

create or replace function public.enqueue_introspect(p_target_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id   uuid := (select auth.uid());
    v_is_member boolean;
    v_msg_id    bigint;
begin
    if v_user_id is null then
        raise exception 'enqueue_introspect requires authentication';
    end if;

    select exists (
        select 1
        from public.target_databases td
        join public.org_members om on om.org_id = td.org_id
        where td.id      = p_target_id
          and om.user_id = v_user_id
    ) into v_is_member;

    if not v_is_member then
        raise exception 'access denied to target %', p_target_id;
    end if;

    v_msg_id := pgmq.send(
        'q_introspect',
        jsonb_build_object('target_id', p_target_id)
    );
    return v_msg_id;
end;
$$;

revoke execute on function public.enqueue_introspect(uuid) from public, anon;
grant  execute on function public.enqueue_introspect(uuid) to authenticated, service_role;
