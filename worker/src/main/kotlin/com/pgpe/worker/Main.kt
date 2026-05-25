package com.pgpe.worker

import io.github.oshai.kotlinlogging.KotlinLogging
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import java.sql.Connection
import java.sql.DriverManager
import kotlin.time.Duration.Companion.seconds

private val logger = KotlinLogging.logger {}

private const val DEFAULT_QUEUE = "q_placeholder"
private const val VISIBILITY_TIMEOUT_SECONDS = 30
private const val MESSAGES_PER_POLL = 1

fun main() = runBlocking {
    val pgUrl = requireEnv("SUPABASE_DB_URL")
    val queue = System.getenv("PGMQ_PLACEHOLDER_QUEUE") ?: DEFAULT_QUEUE
    val pollSeconds = System.getenv("WORKER_POLL_SECONDS")?.toIntOrNull() ?: 30
    val pollInterval = pollSeconds.seconds

    logger.info { "pgpe-worker starting; polling pgmq queue '$queue' every $pollInterval" }

    while (true) {
        try {
            DriverManager.getConnection(pgUrl).use { conn ->
                pollOnce(conn, queue)
            }
        } catch (e: Exception) {
            logger.error(e) { "Poll cycle failed; backing off" }
        }
        delay(pollInterval)
    }
}

private fun pollOnce(conn: Connection, queue: String) {
    conn.prepareStatement("SELECT msg_id, message FROM pgmq.read(?, ?, ?)").use { stmt ->
        stmt.setString(1, queue)
        stmt.setInt(2, VISIBILITY_TIMEOUT_SECONDS)
        stmt.setInt(3, MESSAGES_PER_POLL)
        stmt.executeQuery().use { rs ->
            if (rs.next()) {
                val msgId = rs.getLong("msg_id")
                val message = rs.getString("message")
                logger.info { "Got message $msgId from '$queue': $message" }
                archive(conn, queue, msgId)
            } else {
                logger.info { "alive — no messages on '$queue'" }
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
