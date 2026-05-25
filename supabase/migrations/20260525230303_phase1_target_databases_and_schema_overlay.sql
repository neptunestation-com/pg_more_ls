-- Phase 1.1: schema for the Schema Overlay feature.
--
-- Adds four tables that capture per-target metadata:
--   target_databases       — one row per connected target PG (host, port, db,
--                            user, vault-stored password, is_production toggle)
--   schema_tables          — introspected tables on a target (one row per table)
--   schema_columns         — columns of those tables
--   schema_relationships   — FK relationships between tables on the same target
--
-- All four are RLS-protected so a user can only see rows belonging to a target
-- in one of their orgs. Writes to schema_* are reserved for service-role (the
-- worker populates them after introspection). Writes to target_databases are
-- limited to org members (insert) and org owners (update/delete).
--
-- References:
--   spec/web-app-vision.md  Feature 1 (Schema Overlay)
--   spec/web-app-phasing.md §5 (Phase 1)
--   spec/web-app-architecture-decision.md  D9 (multi-database), D10 (is_production)

-- =====================================================================
-- Tables
-- =====================================================================

create table public.target_databases (
    id                    uuid primary key default gen_random_uuid(),
    org_id                uuid not null references public.orgs(id) on delete cascade,
    name                  text not null,
    host                  text not null,
    port                  integer not null default 5432,
    database              text not null,
    username              text not null,
    -- Connection password lives in Vault; this column references the secret id.
    -- Vault wiring lands in Phase 1.2 — for now this column is nullable so a row
    -- can be created before the secret is stored, then updated.
    vault_secret_id       uuid,
    is_production         boolean not null default false,
    ssl_mode              text not null default 'require'
        check (ssl_mode in ('disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full')),
    created_at            timestamptz not null default now(),
    created_by            uuid not null references auth.users(id),
    last_introspected_at  timestamptz
);

create index target_databases_org_id_idx on public.target_databases(org_id);

create table public.schema_tables (
    id                    uuid primary key default gen_random_uuid(),
    target_id             uuid not null references public.target_databases(id) on delete cascade,
    schema_name           text not null,
    table_name            text not null,
    has_rls               boolean not null default false,
    rls_forced            boolean not null default false,
    -- Phase 1 governance is a coarse signal: red (no RLS), yellow (RLS on but
    -- no proofs run yet). Phase 4 wires proof_runs in and refines this to
    -- green when proofs return UNSAT, etc. Kept as a stored generated column
    -- so Realtime sees changes when has_rls flips.
    governance_status     text generated always as (
        case when has_rls then 'yellow' else 'red' end
    ) stored,
    last_seen_at          timestamptz not null default now(),
    unique (target_id, schema_name, table_name)
);

create index schema_tables_target_id_idx on public.schema_tables(target_id);

create table public.schema_columns (
    id            uuid primary key default gen_random_uuid(),
    table_id      uuid not null references public.schema_tables(id) on delete cascade,
    name          text not null,
    data_type     text not null,
    is_nullable   boolean not null default true,
    ordinal       integer not null,
    unique (table_id, name)
);

create index schema_columns_table_id_idx on public.schema_columns(table_id);

create table public.schema_relationships (
    id                uuid primary key default gen_random_uuid(),
    target_id         uuid not null references public.target_databases(id) on delete cascade,
    source_table_id   uuid not null references public.schema_tables(id) on delete cascade,
    source_column     text not null,
    target_table_id   uuid not null references public.schema_tables(id) on delete cascade,
    target_column     text not null,
    constraint_name   text not null,
    unique (target_id, constraint_name)
);

create index schema_relationships_target_id_idx on public.schema_relationships(target_id);
create index schema_relationships_source_table_idx on public.schema_relationships(source_table_id);
create index schema_relationships_target_table_idx on public.schema_relationships(target_table_id);

-- =====================================================================
-- Helpers
-- =====================================================================

-- True if the current user is a member of the org that owns this target.
-- SECURITY DEFINER + `search_path = ''` for the same reasons as is_org_member
-- (avoid recursive policy evaluation on target_databases, block hijacking).
create or replace function public.target_belongs_to_my_org(check_target_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.target_databases td
        join public.org_members om on om.org_id = td.org_id
        where td.id = check_target_id
          and om.user_id = (select auth.uid())
    )
$$;

-- True if the current user is an *owner* of the org owning this target.
-- Used by update/delete policies on target_databases.
create or replace function public.target_belongs_to_my_owned_org(check_target_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.target_databases td
        join public.org_members om on om.org_id = td.org_id
        where td.id = check_target_id
          and om.user_id = (select auth.uid())
          and om.role = 'owner'
    )
$$;

-- =====================================================================
-- Row-Level Security
-- =====================================================================

alter table public.target_databases     enable row level security;
alter table public.schema_tables        enable row level security;
alter table public.schema_columns       enable row level security;
alter table public.schema_relationships enable row level security;

-- target_databases
-- Members see targets in their orgs; members can create new targets bound to
-- an org they belong to; owners can update or delete.
create policy "Members can view targets in their orgs"
    on public.target_databases for select
    to authenticated
    using (public.is_org_member(org_id));

create policy "Members can create targets in their orgs"
    on public.target_databases for insert
    to authenticated
    with check (
        public.is_org_member(org_id)
        and created_by = (select auth.uid())
    );

create policy "Owners can update targets"
    on public.target_databases for update
    to authenticated
    using (public.target_belongs_to_my_owned_org(id))
    with check (public.target_belongs_to_my_owned_org(id));

create policy "Owners can delete targets"
    on public.target_databases for delete
    to authenticated
    using (public.target_belongs_to_my_owned_org(id));

-- schema_tables, schema_columns, schema_relationships
-- Users only read. Writes happen via service-role from the worker after an
-- introspect job runs; service-role bypasses RLS so no insert/update/delete
-- policies are needed for those code paths.
create policy "Members can view schema_tables in their orgs"
    on public.schema_tables for select
    to authenticated
    using (public.target_belongs_to_my_org(target_id));

create policy "Members can view schema_columns in their orgs"
    on public.schema_columns for select
    to authenticated
    using (
        exists (
            select 1 from public.schema_tables st
            where st.id = schema_columns.table_id
              and public.target_belongs_to_my_org(st.target_id)
        )
    );

create policy "Members can view schema_relationships in their orgs"
    on public.schema_relationships for select
    to authenticated
    using (public.target_belongs_to_my_org(target_id));
