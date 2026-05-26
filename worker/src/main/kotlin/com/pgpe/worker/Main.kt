package com.pgpe.worker

import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.sql.Connection
import java.sql.DriverManager
import kotlin.time.Duration.Companion.seconds

private val logger = KotlinLogging.logger {}

private const val INTROSPECT_QUEUE = "q_introspect"
private const val VISIBILITY_TIMEOUT_SECONDS = 60
private const val MESSAGES_PER_POLL = 1

fun main() = runBlocking {
    val pgUrl = requireEnv("SUPABASE_DB_URL")
    val pollSeconds = System.getenv("WORKER_POLL_SECONDS")?.toIntOrNull() ?: 30
    val pollInterval = pollSeconds.seconds

    val introspectHandler = IntrospectHandler()

    logger.info { "pgpe-worker starting; polling pgmq queue '$INTROSPECT_QUEUE' every $pollInterval" }

    while (true) {
        try {
            DriverManager.getConnection(pgUrl).use { backend ->
                pollOnce(backend, INTROSPECT_QUEUE, introspectHandler)
            }
        } catch (e: Exception) {
            logger.error(e) { "Poll cycle failed; backing off" }
        }
        delay(pollInterval)
    }
}

private fun pollOnce(
    backend: Connection,
    queue: String,
    handler: IntrospectHandler,
) {
    backend.prepareStatement("SELECT msg_id, message FROM pgmq.read(?, ?, ?)").use { stmt ->
        stmt.setString(1, queue)
        stmt.setInt(2, VISIBILITY_TIMEOUT_SECONDS)
        stmt.setInt(3, MESSAGES_PER_POLL)
        stmt.executeQuery().use { rs ->
            if (!rs.next()) {
                logger.info { "alive — no messages on '$queue'" }
                return
            }
            val msgId = rs.getLong("msg_id")
            val messageJson = rs.getString("message")
            logger.info { "got message $msgId on '$queue': $messageJson" }

            val parsed = runCatching {
                Json.parseToJsonElement(messageJson) as JsonObject
            }.getOrNull()
            val targetId = parsed?.get("target_id")?.jsonPrimitive?.content

            if (targetId == null) {
                logger.warn { "message $msgId missing target_id; archiving" }
                archive(backend, queue, msgId)
                return
            }

            try {
                handler.handle(backend, targetId)
                archive(backend, queue, msgId)
            } catch (e: Exception) {
                logger.error(e) { "introspect failed for target $targetId (msg $msgId); archiving" }
                // Phase 1 keeps things simple: archive on failure so a single
                // bad target doesn't poison the queue. A retry / dead-letter
                // strategy is a Phase 5 (drift timeline) concern.
                archive(backend, queue, msgId)
            }
        }
    }
}

private fun archive(conn: Connection, queue: String, msgId: Long) {
    conn.prepareStatement("SELECT pgmq.archive(?, ?)").use { stmt ->
        stmt.setString(1, queue)
        stmt.setLong(2, msgId)
        stmt.execute()
    }
}

private fun requireEnv(name: String): String =
    System.getenv(name) ?: error("Required env var $name is not set")
