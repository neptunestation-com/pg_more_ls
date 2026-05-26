import type { SchemaSnapshot } from '../hooks/useSchemaSnapshot'

/**
 * Synthetic schema snapshots for the /dev/overlay visual-test route.
 *
 * Add scenarios here when you want to exercise a new visual condition
 * (large schemas, edge cases, exotic column types, etc.) without
 * needing a real introspected PostgreSQL database.
 */

const TARGET = '00000000-0000-0000-0000-000000000fff'

function tbl(
  id: number,
  name: string,
  opts: {
    hasRls?: boolean
    rlsForced?: boolean
    governance?: 'red' | 'yellow' | 'green' | 'gray'
  } = {},
) {
  return {
    id: `t-${id.toString().padStart(8, '0')}`,
    target_id: TARGET,
    schema_name: 'public',
    table_name: name,
    has_rls: opts.hasRls ?? false,
    rls_forced: opts.rlsForced ?? false,
    governance_status: opts.governance ?? (opts.hasRls ? 'yellow' : 'red'),
    last_seen_at: '2026-05-26T00:00:00Z',
  }
}

function col(tableId: number, ord: number, name: string, dataType: string) {
  return {
    id: `c-${tableId}-${ord}`,
    table_id: `t-${tableId.toString().padStart(8, '0')}`,
    name,
    data_type: dataType,
    is_nullable: false,
    ordinal: ord,
  }
}

function rel(
  id: number,
  src: number,
  srcCol: string,
  dst: number,
  dstCol: string,
) {
  return {
    id: `r-${id.toString().padStart(8, '0')}`,
    target_id: TARGET,
    source_table_id: `t-${src.toString().padStart(8, '0')}`,
    source_column: srcCol,
    target_table_id: `t-${dst.toString().padStart(8, '0')}`,
    target_column: dstCol,
    constraint_name: `fk_${id}`,
  }
}

export interface Scenario {
  key: string
  title: string
  description: string
  snapshot: SchemaSnapshot
}

const EMPTY: Scenario = {
  key: 'empty',
  title: 'Empty schema',
  description: 'No tables. Should show the empty-state placeholder.',
  snapshot: { tables: [], columns: [], relationships: [] },
}

const SINGLE: Scenario = {
  key: 'single',
  title: 'Single table',
  description: 'One table, no FKs. Smoke test for the TableNode renderer.',
  snapshot: {
    tables: [tbl(1, 'profiles', { hasRls: true })],
    columns: [
      col(1, 1, 'id', 'uuid'),
      col(1, 2, 'username', 'text'),
      col(1, 3, 'created_at', 'timestamptz'),
    ],
    relationships: [],
  },
}

const WIDE_LONG_NAMES: Scenario = {
  key: 'wide',
  title: 'Wide table — long column names',
  description:
    '30 columns with long names. Exercises column-name truncation (#20) and the "…N more" footer.',
  snapshot: {
    tables: [tbl(1, 'audit_events', { hasRls: true })],
    columns: [
      col(1, 1, 'id', 'uuid'),
      col(1, 2, 'organization_owner_user_id', 'uuid'),
      col(1, 3, 'created_at_with_long_suffix', 'timestamptz'),
      col(1, 4, 'updated_at', 'timestamptz'),
      col(1, 5, 'archived_at_or_null_if_active', 'timestamptz'),
      col(1, 6, 'event_kind_discriminator_enum', 'text'),
      col(1, 7, 'request_payload_jsonb', 'jsonb'),
      col(1, 8, 'response_payload_jsonb', 'jsonb'),
      col(1, 9, 'remote_ip_address', 'inet'),
      col(1, 10, 'user_agent_string', 'text'),
      ...Array.from({ length: 20 }, (_, i) =>
        col(1, 11 + i, `extra_column_number_${i + 1}`, 'text'),
      ),
    ],
    relationships: [],
  },
}

const PARALLEL: Scenario = {
  key: 'parallel',
  title: 'Parallel FKs',
  description:
    'friendships(user_a_id, user_b_id) → users — two FKs to the same target. With #19 fix, both edges should be visible, fanned apart.',
  snapshot: {
    tables: [
      tbl(1, 'users', { hasRls: true, rlsForced: true }),
      tbl(2, 'friendships', { hasRls: true }),
      tbl(3, 'mentions', { hasRls: false }),
    ],
    columns: [
      col(1, 1, 'id', 'uuid'),
      col(1, 2, 'email', 'text'),
      col(2, 1, 'user_a_id', 'uuid'),
      col(2, 2, 'user_b_id', 'uuid'),
      col(2, 3, 'created_at', 'timestamptz'),
      col(3, 1, 'from_user_id', 'uuid'),
      col(3, 2, 'to_user_id', 'uuid'),
      col(3, 3, 'mentioned_user_id', 'uuid'),
    ],
    relationships: [
      rel(1, 2, 'user_a_id', 1, 'id'),
      rel(2, 2, 'user_b_id', 1, 'id'),
      rel(3, 3, 'from_user_id', 1, 'id'),
      rel(4, 3, 'to_user_id', 1, 'id'),
      rel(5, 3, 'mentioned_user_id', 1, 'id'),
    ],
  },
}

const CHAIN: Scenario = {
  key: 'chain',
  title: 'Linear chain',
  description: 'A → B → C → D → E. Stress-tests dagre LR layout.',
  snapshot: {
    tables: [
      tbl(1, 'orgs', { hasRls: true }),
      tbl(2, 'projects', { hasRls: true }),
      tbl(3, 'tickets', { hasRls: true }),
      tbl(4, 'comments', { hasRls: false }),
      tbl(5, 'attachments', { hasRls: false }),
    ],
    columns: [
      col(1, 1, 'id', 'uuid'),
      col(2, 1, 'id', 'uuid'),
      col(2, 2, 'org_id', 'uuid'),
      col(3, 1, 'id', 'uuid'),
      col(3, 2, 'project_id', 'uuid'),
      col(4, 1, 'id', 'uuid'),
      col(4, 2, 'ticket_id', 'uuid'),
      col(5, 1, 'id', 'uuid'),
      col(5, 2, 'comment_id', 'uuid'),
    ],
    relationships: [
      rel(1, 2, 'org_id', 1, 'id'),
      rel(2, 3, 'project_id', 2, 'id'),
      rel(3, 4, 'ticket_id', 3, 'id'),
      rel(4, 5, 'comment_id', 4, 'id'),
    ],
  },
}

const HUB: Scenario = {
  key: 'hub',
  title: 'Hub-and-spoke',
  description:
    'Central users table with 6 satellites all FK-ing into it. Tests fan-in and ranksep.',
  snapshot: {
    tables: [
      tbl(1, 'users', { hasRls: true, rlsForced: true }),
      tbl(2, 'sessions', { hasRls: true }),
      tbl(3, 'api_keys', { hasRls: true }),
      tbl(4, 'preferences', { hasRls: true }),
      tbl(5, 'audit_log', { hasRls: false }),
      tbl(6, 'invoices', { hasRls: true }),
      tbl(7, 'integrations', { hasRls: false }),
    ],
    columns: [
      col(1, 1, 'id', 'uuid'),
      col(1, 2, 'email', 'text'),
      ...[2, 3, 4, 5, 6, 7].flatMap((id) => [
        col(id, 1, 'id', 'uuid'),
        col(id, 2, 'user_id', 'uuid'),
      ]),
    ],
    relationships: [2, 3, 4, 5, 6, 7].map((id, i) =>
      rel(i + 1, id, 'user_id', 1, 'id'),
    ),
  },
}

const MIXED_STATUS: Scenario = {
  key: 'status-mix',
  title: 'All status variants',
  description:
    'One table per governance state: no-RLS (dashed red), RLS-on (solid amber), RLS forced (solid amber, "rls forced" pill), proven safe (double green, Phase 4 preview).',
  snapshot: {
    tables: [
      tbl(1, 'public_posts', { hasRls: false, governance: 'red' }),
      tbl(2, 'orders', { hasRls: true, governance: 'yellow' }),
      tbl(3, 'secrets', { hasRls: true, rlsForced: true, governance: 'yellow' }),
      tbl(4, 'audit_log', { hasRls: true, governance: 'green' }),
    ],
    columns: [1, 2, 3, 4].flatMap((id) => [
      col(id, 1, 'id', 'uuid'),
      col(id, 2, 'created_at', 'timestamptz'),
    ]),
    relationships: [],
  },
}

const CYCLE: Scenario = {
  key: 'cycle',
  title: 'Cyclic FKs',
  description:
    'A → B → C → A. Dagre tolerates cycles by breaking one edge; verifies we don\'t crash.',
  snapshot: {
    tables: [
      tbl(1, 'a', { hasRls: false }),
      tbl(2, 'b', { hasRls: false }),
      tbl(3, 'c', { hasRls: false }),
    ],
    columns: [1, 2, 3].flatMap((id) => [
      col(id, 1, 'id', 'uuid'),
      col(id, 2, 'next_id', 'uuid'),
    ]),
    relationships: [
      rel(1, 1, 'next_id', 2, 'id'),
      rel(2, 2, 'next_id', 3, 'id'),
      rel(3, 3, 'next_id', 1, 'id'),
    ],
  },
}

const LARGE: Scenario = {
  key: 'large',
  title: 'Large schema (20 tables)',
  description:
    'A roughly-realistic 20-table schema. Useful for fitView padding (#21) and layout density.',
  snapshot: (() => {
    const tables = Array.from({ length: 20 }, (_, i) =>
      tbl(i + 1, `table_${(i + 1).toString().padStart(2, '0')}`, {
        hasRls: i % 3 !== 0,
        governance: i % 5 === 0 ? 'red' : 'yellow',
      }),
    )
    const columns = Array.from({ length: 20 }, (_, i) =>
      [
        col(i + 1, 1, 'id', 'uuid'),
        col(i + 1, 2, 'created_at', 'timestamptz'),
        col(i + 1, 3, `parent_id`, 'uuid'),
      ],
    ).flat()
    const relationships = Array.from({ length: 15 }, (_, i) =>
      rel(i + 1, ((i + 1) % 20) + 1, 'parent_id', (i % 4) + 1, 'id'),
    )
    return { tables, columns, relationships }
  })(),
}

export const SCENARIOS: Scenario[] = [
  EMPTY,
  SINGLE,
  WIDE_LONG_NAMES,
  PARALLEL,
  CHAIN,
  HUB,
  MIXED_STATUS,
  CYCLE,
  LARGE,
]
