-- Phase 0.2 initial migration.
--
-- Enables the extensions the web app's backend needs and lays down the
-- minimum identity schema (orgs + org_members) with RLS. Feature-specific
-- tables come in later phases — this is the skeleton everything else
-- depends on.
--
-- References:
--   spec/web-app-architecture-decision.md §D3 (backend persistence),
--   §D7 (pgmq), §D11 (repo layout)
--   spec/web-app-phasing.md §4 (Phase 0)

-- =====================================================================
-- Extensions
-- =====================================================================

create extension if not exists pgmq;
create extension if not exists pgsodium;

-- =====================================================================
-- Schema: orgs + org_members
-- =====================================================================

create table public.orgs (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    created_at timestamptz not null default now(),
    created_by uuid not null references auth.users(id)
);

create table public.org_members (
    org_id uuid not null references public.orgs(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    role text not null check (role in ('owner', 'admin', 'member')),
    created_at timestamptz not null default now(),
    primary key (org_id, user_id)
);

create index org_members_user_id_idx on public.org_members(user_id);

-- =====================================================================
-- Helpers
-- =====================================================================

-- Used in RLS policies to test membership without triggering recursive
-- policy evaluation on org_members. SECURITY DEFINER bypasses RLS;
-- `search_path = ''` blocks search-path hijacking.
create or replace function public.is_org_member(check_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.org_members om
        where om.org_id = check_org_id
          and om.user_id = (select auth.uid())
    )
$$;

-- When an org is created, automatically add the creator as the owner.
create or replace function public.handle_new_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.org_members (org_id, user_id, role)
    values (new.id, new.created_by, 'owner');
    return new;
end;
$$;

create trigger orgs_add_creator_as_owner
    after insert on public.orgs
    for each row
    execute function public.handle_new_org();

-- =====================================================================
-- Row-Level Security
-- =====================================================================

alter table public.orgs enable row level security;
alter table public.org_members enable row level security;

-- orgs: a user can see orgs they're a member of, and can create new orgs
-- as long as they set themselves as the creator (the trigger above then
-- adds them to org_members as owner).
create policy "Members can view their orgs"
    on public.orgs for select
    to authenticated
    using (public.is_org_member(id));

create policy "Authenticated users can create orgs"
    on public.orgs for insert
    to authenticated
    with check (created_by = (select auth.uid()));

-- org_members: a user can see co-members of orgs they belong to. Insert
-- happens through the orgs trigger for the initial owner; later phases
-- add policies for invite/remove flows.
create policy "Members can view co-members"
    on public.org_members for select
    to authenticated
    using (public.is_org_member(org_id));
