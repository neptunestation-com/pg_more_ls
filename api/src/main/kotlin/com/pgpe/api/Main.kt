package com.pgpe.api

import io.github.oshai.kotlinlogging.KotlinLogging
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.server.plugins.calllogging.CallLogging
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.plugins.cors.routing.CORS
import io.ktor.server.response.respond
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import kotlinx.serialization.Serializable

private val logger = KotlinLogging.logger {}

@Serializable
data class HealthResponse(val status: String, val service: String = "pgpe-api")

fun main() {
    val port = System.getenv("PORT")?.toIntOrNull() ?: 8080
    logger.info { "Starting pgpe-api on 0.0.0.0:$port" }

    embeddedServer(Netty, port = port, host = "0.0.0.0") {
        module()
    }.start(wait = true)
}

fun Application.module() {
    install(ContentNegotiation) { json() }
    install(CallLogging)

    // CORS: allow the Vite dev server (localhost:5173) by default;
    // override via ALLOWED_ORIGINS env var (comma-separated). Once
    // the frontend has a Cloudflare Pages URL (Phase 0.7) we'll add
    // that to the env-driven list.
    install(CORS) {
        val configured = System.getenv("ALLOWED_ORIGINS")
            ?.split(',')
            ?.map { it.trim() }
            ?.filter { it.isNotEmpty() }
            ?: listOf("http://localhost:5173")
        configured.forEach { allowHost(it.removePrefix("http://").removePrefix("https://"), schemes = listOf("http", "https")) }
        allowMethod(HttpMethod.Get)
        allowMethod(HttpMethod.Post)
        allowMethod(HttpMethod.Put)
        allowMethod(HttpMethod.Delete)
        allowMethod(HttpMethod.Options)
        allowHeader(HttpHeaders.Authorization)
        allowHeader(HttpHeaders.ContentType)
    }

    routing {
        get("/healthz") {
            call.respond(HealthResponse(status = "ok"))
        }
    }
}
