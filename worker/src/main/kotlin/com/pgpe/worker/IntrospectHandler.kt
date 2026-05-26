package com.pgpe.worker

import io.github.oshai.kotlinlogging.KotlinLogging
import java.sql.Connection
import java.sql.DriverManager
import java.util.Properties

private val logger = KotlinLogging.logger {}

/**
 * Handles `q_introspect` messages: connects to the target Postgres,
 * reads its `public`-schema topology + RLS state, and replaces the
 * relevant rows in the backend's `schema_tables` / `schema_columns` /
 * `schema_relationships` tables.
 *
 * Connections to backend Postgres come pre-opened (we share one
 * across the worker's poll loop). The target connection is opened
 * per-job and closed after.
 */
class IntrospectHandler {

    /**
     * Run an introspect for one target.
     *
     * Strategy: delete-and-replace. Wrap backend writes in a tx so a
     * failure mid-way doesn't leave half-stale data. Cascade FKs on
     * `target_databases` -> `schema_tables` -> `schema_columns` /
     * `schema_relationships` mean a single DELETE on `schema_tables`
     * for this target wipes everything; we re-insert from the live
     * target.
     */
    fun handle(backend: Connection, targetId: String) {
        logger.info { "introspect: starting for target $targetId" }

        val target = loadTarget(backend, targetId)
            ?: throw IllegalStateException("target $targetId not found in backend")

        val password = loadPassword(backend, targetId)
            ?: throw IllegalStateException("target $targetId has no vault secret")

        val snapshot = openTargetConnection(target, password).use { targetConn ->
            introspectTarget(targetConn)
        }

        applySnapshot(backend, targetId, snapshot)

        logger.info {
            "introspect: target $targetId — ${snapshot.tables.size} tables, " +
                "${snapshot.columns.size} columns, ${snapshot.relationships.size} FKs"
        }
    }

    // -----------------------------------------------------------------
    // Backend lookups
    // -----------------------------------------------------------------

    private fun loadTarget(backend: Connection, targetId: String): TargetRow? {
        val sql = """
            SELECT host, port, database, username, ssl_mode
            FROM public.target_databases
            WHERE id = ?::uuid
        """.trimIndent()
        backend.prepareStatement(sql).use { ps ->
            ps.setString(1, targetId)
            ps.executeQuery().use { rs ->
                if (!rs.next()) return null
                return TargetRow(
                    host = rs.getString("host"),
                    port = rs.getInt("port"),
                    database = rs.getString("database"),
                    username = rs.getString("username"),
                    sslMode = rs.getString("ssl_mode"),
                )
            }
        }
    }

    private fun loadPassword(backend: Connection, targetId: String): String? {
        backend.prepareStatement("SELECT public.get_target_db_password(?::uuid)").use { ps ->
            ps.setString(1, targetId)
            ps.executeQuery().use { rs ->
                return if (rs.next()) rs.getString(1) else null
            }
        }
    }

    // -----------------------------------------------------------------
    // Target connection + queries
    // -----------------------------------------------------------------

    private fun openTargetConnection(t: TargetRow, password: String): Connection {
        val props = Properties().apply {
            setProperty("user", t.username)
            setProperty("password", password)
            setProperty("sslmode", t.sslMode)
            // Don't let a stuck target keep the worker hanging forever.
            setProperty("connectTimeout", "10")
            setProperty("socketTimeout", "30")
        }
        val url = "jdbc:postgresql://${t.host}:${t.port}/${t.database}"
        return DriverManager.getConnection(url, props)
    }

    private fun introspectTarget(target: Connection): TargetSnapshot {
        val tables = mutableListOf<TableRow>()
        val columns = mutableListOf<ColumnRow>()
        val relationships = mutableListOf<RelationshipRow>()

        // Tables with RLS state. Stick to `public` for Phase 1.
        val tablesSql = """
            SELECT
                n.nspname            AS schema_name,
                c.relname            AS table_name,
                c.relrowsecurity     AS has_rls,
                c.relforcerowsecurity AS rls_forced
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind = 'r'
              AND n.nspname = 'public'
            ORDER BY n.nspname, c.relname
        """.trimIndent()
        target.createStatement().use { stmt ->
            stmt.executeQuery(tablesSql).use { rs ->
                while (rs.next()) {
                    tables += TableRow(
                        schemaName = rs.getString("schema_name"),
                        tableName = rs.getString("table_name"),
                        hasRls = rs.getBoolean("has_rls"),
                        rlsForced = rs.getBoolean("rls_forced"),
                    )
                }
            }
        }

        // Columns per table (one query for all public-schema tables).
        val columnsSql = """
            SELECT
                table_schema,
                table_name,
                column_name,
                data_type,
                is_nullable,
                ordinal_position
            FROM information_schema.columns
            WHERE table_schema = 'public'
            ORDER BY table_name, ordinal_position
        """.trimIndent()
        target.createStatement().use { stmt ->
            stmt.executeQuery(columnsSql).use { rs ->
                while (rs.next()) {
                    columns += ColumnRow(
                        schemaName = rs.getString("table_schema"),
                        tableName = rs.getString("table_name"),
                        name = rs.getString("column_name"),
                        dataType = rs.getString("data_type"),
                        isNullable = rs.getString("is_nullable") == "YES",
                        ordinal = rs.getInt("ordinal_position"),
                    )
                }
            }
        }

        // FK relationships within public.
        val fkSql = """
            SELECT
                tc.constraint_name,
                tc.table_schema  AS source_schema,
                tc.table_name    AS source_table,
                kcu.column_name  AS source_column,
                ccu.table_schema AS target_schema,
                ccu.table_name   AS target_table,
                ccu.column_name  AS target_column
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name
                AND tc.table_schema    = kcu.table_schema
            JOIN information_schema.constraint_column_usage ccu
                ON ccu.constraint_name = tc.constraint_name
                AND ccu.table_schema    = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_schema = 'public'
            ORDER BY tc.constraint_name
        """.trimIndent()
        target.createStatement().use { stmt ->
            stmt.executeQuery(fkSql).use { rs ->
                while (rs.next()) {
                    relationships += RelationshipRow(
                        constraintName = rs.getString("constraint_name"),
                        sourceSchema = rs.getString("source_schema"),
                        sourceTable = rs.getString("source_table"),
                        sourceColumn = rs.getString("source_column"),
                        targetSchema = rs.getString("target_schema"),
                        targetTable = rs.getString("target_table"),
                        targetColumn = rs.getString("target_column"),
                    )
                }
            }
        }

        return TargetSnapshot(tables, columns, relationships)
    }

    // -----------------------------------------------------------------
    // Backend apply
    // -----------------------------------------------------------------

    private fun applySnapshot(backend: Connection, targetId: String, snap: TargetSnapshot) {
        val wasAutoCommit = backend.autoCommit
        backend.autoCommit = false
        try {
            // Wipe and re-insert. The FKs on schema_tables.target_id with
            // ON DELETE CASCADE handle schema_columns + schema_relationships.
            backend.prepareStatement(
                "DELETE FROM public.schema_tables WHERE target_id = ?::uuid"
            ).use { ps ->
                ps.setString(1, targetId)
                ps.executeUpdate()
            }

            // Insert tables; capture the new ids by (schema, name) for child rows.
            val tableIdByName = mutableMapOf<Pair<String, String>, String>()
            val insertTableSql = """
                INSERT INTO public.schema_tables
                    (target_id, schema_name, table_name, has_rls, rls_forced)
                VALUES (?::uuid, ?, ?, ?, ?)
                RETURNING id
            """.trimIndent()
            for (t in snap.tables) {
                backend.prepareStatement(insertTableSql).use { ps ->
                    ps.setString(1, targetId)
                    ps.setString(2, t.schemaName)
                    ps.setString(3, t.tableName)
                    ps.setBoolean(4, t.hasRls)
                    ps.setBoolean(5, t.rlsForced)
                    ps.executeQuery().use { rs ->
                        rs.next()
                        tableIdByName[t.schemaName to t.tableName] = rs.getString("id")
                    }
                }
            }

            val insertColSql = """
                INSERT INTO public.schema_columns
                    (table_id, name, data_type, is_nullable, ordinal)
                VALUES (?::uuid, ?, ?, ?, ?)
            """.trimIndent()
            for (c in snap.columns) {
                val tid = tableIdByName[c.schemaName to c.tableName] ?: continue
                backend.prepareStatement(insertColSql).use { ps ->
                    ps.setString(1, tid)
                    ps.setString(2, c.name)
                    ps.setString(3, c.dataType)
                    ps.setBoolean(4, c.isNullable)
                    ps.setInt(5, c.ordinal)
                    ps.executeUpdate()
                }
            }

            val insertFkSql = """
                INSERT INTO public.schema_relationships
                    (target_id, source_table_id, source_column,
                     target_table_id, target_column, constraint_name)
                VALUES (?::uuid, ?::uuid, ?, ?::uuid, ?, ?)
            """.trimIndent()
            for (r in snap.relationships) {
                val srcId = tableIdByName[r.sourceSchema to r.sourceTable] ?: continue
                val tgtId = tableIdByName[r.targetSchema to r.targetTable] ?: continue
                backend.prepareStatement(insertFkSql).use { ps ->
                    ps.setString(1, targetId)
                    ps.setString(2, srcId)
                    ps.setString(3, r.sourceColumn)
                    ps.setString(4, tgtId)
                    ps.setString(5, r.targetColumn)
                    ps.setString(6, r.constraintName)
                    ps.executeUpdate()
                }
            }

            // Stamp the introspection time on the target.
            backend.prepareStatement(
                "UPDATE public.target_databases SET last_introspected_at = now() WHERE id = ?::uuid"
            ).use { ps ->
                ps.setString(1, targetId)
                ps.executeUpdate()
            }

            backend.commit()
        } catch (e: Exception) {
            backend.rollback()
            throw e
        } finally {
            backend.autoCommit = wasAutoCommit
        }
    }
}

// ---------------------------------------------------------------------
// Plain data carriers
// ---------------------------------------------------------------------

private data class TargetRow(
    val host: String,
    val port: Int,
    val database: String,
    val username: String,
    val sslMode: String,
)

private data class TableRow(
    val schemaName: String,
    val tableName: String,
    val hasRls: Boolean,
    val rlsForced: Boolean,
)

private data class ColumnRow(
    val schemaName: String,
    val tableName: String,
    val name: String,
    val dataType: String,
    val isNullable: Boolean,
    val ordinal: Int,
)

private data class RelationshipRow(
    val constraintName: String,
    val sourceSchema: String,
    val sourceTable: String,
    val sourceColumn: String,
    val targetSchema: String,
    val targetTable: String,
    val targetColumn: String,
)

private data class TargetSnapshot(
    val tables: List<TableRow>,
    val columns: List<ColumnRow>,
    val relationships: List<RelationshipRow>,
)
