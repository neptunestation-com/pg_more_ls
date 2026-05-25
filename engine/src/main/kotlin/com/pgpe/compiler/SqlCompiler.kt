package com.pgpe.compiler

import com.pgpe.ast.*

fun compile(policySet: PolicySet, metadata: SchemaMetadata): CompiledState {
    val normalized = normalize(policySet)
    val evaluator = SelectorEvaluator(metadata)

    val tableArtifacts = mutableListOf<TableArtifacts>()

    for (table in metadata.tables) {
        val applicablePolicies = normalized.policies.filter { policy ->
            evaluator.matches(policy.selector, table)
        }
        if (applicablePolicies.isEmpty()) continue

        val qualifiedName = "${table.schema}.${table.name}"

        val compiledPolicies = applicablePolicies.map { policy ->
            val policyName = "${policy.name}_${table.name}"
            val sql = SqlCompiler.compilePolicy(policy, table, metadata)
            CompiledPolicy(policyName, table.name, sql)
        }

        tableArtifacts.add(TableArtifacts(
            table = table.name,
            schema = table.schema,
            enableRls = "ALTER TABLE $qualifiedName ENABLE ROW LEVEL SECURITY;",
            forceRls = "ALTER TABLE $qualifiedName FORCE ROW LEVEL SECURITY;",
            policies = compiledPolicies
        ))
    }

    return CompiledState(tableArtifacts)
}

object SqlCompiler {

    // PostgreSQL types that current_setting()'s text return value is binary-coercible to.
    // For these, no explicit cast is needed on the session value. See ADR §9.2.
    private val TEXT_LIKE_TYPES = setOf("text", "varchar", "character varying", "character")

    fun compilePolicy(policy: Policy, table: TableMetadata, schema: SchemaMetadata): String {
        val policyName = "${policy.name}_${table.name}"
        val qualifiedTable = "${table.schema}.${table.name}"
        val typeClause = "AS ${policy.type.name}"
        val cmdClause = compileCmdClause(policy.commands)
        val usingExpr = compileClauses(policy.clauses, table, schema)

        return buildString {
            append("CREATE POLICY $policyName\n")
            append("  ON $qualifiedTable\n")
            append("  $typeClause\n")
            append("  FOR $cmdClause\n")
            append("  USING ($usingExpr);")
        }
    }

    fun compileCmdClause(commands: Set<Command>): String {
        val allCommands = setOf(Command.SELECT, Command.INSERT, Command.UPDATE, Command.DELETE)
        return if (commands == allCommands) "ALL"
        else commands.joinToString(", ") { it.name }
    }

    fun compileClauses(clauses: List<Clause>, table: TableMetadata, schema: SchemaMetadata): String {
        if (clauses.isEmpty()) return "false"
        return clauses.joinToString(" OR ") { compileClause(it, table, schema) }
    }

    fun compileClause(clause: Clause, table: TableMetadata, schema: SchemaMetadata): String {
        if (clause.atoms.isEmpty()) return "true"
        val sorted = clause.atoms.sortedBy { atomSortKey(it) }
        return sorted.joinToString(" AND ") { compileAtom(it, table, schema) }
    }

    fun compileAtom(atom: Atom, table: TableMetadata, schema: SchemaMetadata): String {
        return when (atom) {
            is Atom.BinaryAtom -> compileBinaryAtom(atom, table, schema, qualified = false)
            is Atom.UnaryAtom -> compileUnaryAtom(atom, table, qualified = false)
            is Atom.TraversalAtom -> compileTraversalAtom(atom, table, schema)
        }
    }

    private fun compileBinaryAtom(
        atom: Atom.BinaryAtom,
        table: TableMetadata,
        schema: SchemaMetadata,
        qualified: Boolean
    ): String {
        val op = compileBinaryOp(atom.op)
        val left = atom.left
        val right = atom.right

        // Column-vs-session: emit cast keyed off the column's type.
        if (left is ValueSource.Col && right is ValueSource.Session) {
            val leftSql = compileValueSource(left, table, qualified)
            val rightSql = compileSessionWithCast(right, table, left.name)
            return "$leftSql $op $rightSql"
        }
        if (left is ValueSource.Session && right is ValueSource.Col) {
            val leftSql = compileSessionWithCast(left, table, right.name)
            val rightSql = compileValueSource(right, table, qualified)
            return "$leftSql $op $rightSql"
        }

        val leftSql = compileValueSource(left, table, qualified)
        val rightSql = compileValueSource(right, table, qualified)
        return "$leftSql $op $rightSql"
    }

    private fun compileUnaryAtom(atom: Atom.UnaryAtom, table: TableMetadata, qualified: Boolean): String {
        val source = compileValueSource(atom.source, table, qualified)
        return when (atom.op) {
            UnaryOp.IS_NULL -> "$source IS NULL"
            UnaryOp.IS_NOT_NULL -> "$source IS NOT NULL"
        }
    }

    private fun compileTraversalAtom(
        atom: Atom.TraversalAtom,
        sourceTable: TableMetadata,
        schema: SchemaMetadata
    ): String {
        val rel = atom.relationship
        val targetTable = schema.tables.find { it.name == rel.targetTable }
            ?: TableMetadata(rel.targetTable, "public", emptyList())
        val targetQualified = "${targetTable.schema}.${targetTable.name}"
        val sourceQualified = "${sourceTable.schema}.${sourceTable.name}"

        val innerAtoms = atom.clause.atoms.sortedBy { atomSortKey(it) }
        val innerParts = innerAtoms.map { innerAtom ->
            compileAtomForTarget(innerAtom, targetTable, schema)
        }

        val joinCondition = "$targetQualified.${rel.targetCol} = $sourceQualified.${rel.sourceCol}"

        val allConditions = listOf(joinCondition) + innerParts
        val whereClause = allConditions.joinToString("\n      AND ")

        return "EXISTS (\n    SELECT 1 FROM $targetQualified\n    WHERE $whereClause\n  )"
    }

    private fun compileAtomForTarget(
        atom: Atom,
        targetTable: TableMetadata,
        schema: SchemaMetadata
    ): String {
        return when (atom) {
            is Atom.BinaryAtom -> compileBinaryAtom(atom, targetTable, schema, qualified = true)
            is Atom.UnaryAtom -> compileUnaryAtom(atom, targetTable, qualified = true)
            is Atom.TraversalAtom -> compileTraversalAtom(atom, targetTable, schema)
        }
    }

    private fun compileValueSource(vs: ValueSource, table: TableMetadata, qualified: Boolean): String {
        return when (vs) {
            is ValueSource.Col -> if (qualified) "${table.schema}.${table.name}.${vs.name}" else vs.name
            is ValueSource.Session -> "(SELECT current_setting('${vs.key}'))"
            is ValueSource.Lit -> compileLiteral(vs.value)
            is ValueSource.Fn -> "${vs.name}(${vs.args.joinToString(", ") { compileValueSource(it, table, qualified) }})"
        }
    }

    private fun compileSessionWithCast(
        session: ValueSource.Session,
        table: TableMetadata,
        columnName: String
    ): String {
        val base = "(SELECT current_setting('${session.key}'))"
        val columnType = table.columns.find { it.name == columnName }?.type
        if (columnType == null) {
            System.err.println(
                "pgpe: warning — column '$columnName' not found in metadata for table " +
                "'${table.schema}.${table.name}'; emitting session reference without type cast"
            )
            return base
        }
        if (columnType.lowercase() in TEXT_LIKE_TYPES) return base
        return "$base::$columnType"
    }

    private fun compileLiteral(lit: LiteralValue): String {
        return when (lit) {
            is LiteralValue.StringLit -> "'${lit.value}'"
            is LiteralValue.IntLit -> lit.value.toString()
            is LiteralValue.BoolLit -> lit.value.toString()
            is LiteralValue.NullLit -> "NULL"
            is LiteralValue.ListLit -> "(${lit.values.joinToString(", ") { compileLiteral(it) }})"
        }
    }

    private fun compileBinaryOp(op: BinaryOp): String {
        return when (op) {
            BinaryOp.EQ -> "="
            BinaryOp.NEQ -> "<>"
            BinaryOp.LT -> "<"
            BinaryOp.GT -> ">"
            BinaryOp.LTE -> "<="
            BinaryOp.GTE -> ">="
            BinaryOp.IN -> "IN"
            BinaryOp.NOT_IN -> "NOT IN"
            BinaryOp.LIKE -> "LIKE"
            BinaryOp.NOT_LIKE -> "NOT LIKE"
        }
    }

    private fun atomSortKey(atom: Atom): String {
        return when (atom) {
            is Atom.BinaryAtom -> "0_${atom.left}_${atom.op}_${atom.right}"
            is Atom.UnaryAtom -> "1_${atom.source}_${atom.op}"
            is Atom.TraversalAtom -> "2_${atom.relationship.targetTable}"
        }
    }

    fun render(compiled: CompiledState): String {
        return buildString {
            for ((index, table) in compiled.tables.withIndex()) {
                if (index > 0) append("\n")
                append("-- ============================================================\n")
                append("-- ${table.table}\n")
                append("-- ============================================================\n")
                append("${table.enableRls}\n")
                append("${table.forceRls}\n")
                for (policy in table.policies) {
                    append("\n")
                    append("${policy.sql}\n")
                }
            }
        }
    }
}
