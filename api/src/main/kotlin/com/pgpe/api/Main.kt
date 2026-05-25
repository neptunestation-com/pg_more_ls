package com.pgpe.api

import com.auth0.jwt.JWT
import com.auth0.jwt.algorithms.Algorithm
import io.github.oshai.kotlinlogging.KotlinLogging
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.auth.Authentication
import io.ktor.server.auth.authenticate
import io.ktor.server.auth.jwt.JWTPrincipal
import io.ktor.server.auth.jwt.jwt
import io.ktor.server.auth.principal
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.server.plugins.calllogging.CallLogging
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.plugins.cors.routing.CORS
import io.ktor.server.response.respond
import io.ktor.server.routing.get
import io.ktor.server.routing.route
import io.ktor.server.routing.routing
import kotlinx.serialization.Serializable

private val logger = KotlinLogging.logger {}

@Serializable
data class HealthResponse(val status: String, val service: String = "pgpe-api")

@Serializable
data class MeResponse(
    val userId: String,
    val role: String?,
    val email: String?,
)

@Serializable
data class ErrorResponse(val error: String)

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

    install(CORS) {
        val configured = System.getenv("ALLOWED_ORIGINS")
            ?.split(',')
            ?.map { it.trim() }
            ?.filter { it.isNotEmpty() }
            ?: listOf("http://localhost:5173")
        configured.forEach {
            allowHost(
                it.removePrefix("http://").removePrefix("https://"),
                schemes = listOf("http", "https"),
            )
        }
        allowMethod(HttpMethod.Get)
        allowMethod(HttpMethod.Post)
        allowMethod(HttpMethod.Put)
        allowMethod(HttpMethod.Delete)
        allowMethod(HttpMethod.Options)
        allowHeader(HttpHeaders.Authorization)
        allowHeader(HttpHeaders.ContentType)
    }

    // JWT verification. Supabase signs end-user JWTs with HS256 using the
    // project's JWT secret (Dashboard → Settings → API → JWT Settings).
    // The same secret signs the anon / service_role keys, so this verifier
    // accepts all three classes of caller — we distinguish authenticated
    // users from service_role inside individual route handlers via the
    // `role` claim.
    val jwtSecret = System.getenv("SUPABASE_JWT_SECRET")
        ?: error(
            "SUPABASE_JWT_SECRET is not set. Retrieve from the Supabase " +
                "dashboard (Settings → API → JWT Settings) and add to " +
                ".env.local locally / `flyctl secrets set` for prod.",
        )

    install(Authentication) {
        jwt("supabase") {
            realm = "pgpe-api"
            verifier(
                JWT.require(Algorithm.HMAC256(jwtSecret))
                    .acceptLeeway(5)
                    .build(),
            )
            validate { credential ->
                // Token signature and expiry already verified above. Reject
                // tokens missing a subject (the user id) — every legitimate
                // Supabase JWT has one.
                if (credential.payload.subject.isNullOrBlank()) {
                    null
                } else {
                    JWTPrincipal(credential.payload)
                }
            }
            challenge { _, _ ->
                call.respond(
                    HttpStatusCode.Unauthorized,
                    ErrorResponse("Invalid or missing token"),
                )
            }
        }
    }

    routing {
        // Public routes — no auth required.
        get("/healthz") {
            call.respond(HealthResponse(status = "ok"))
        }

        // Authenticated routes. Phase 1.4 adds target management here.
        authenticate("supabase") {
            route("/api/v1") {
                get("/me") {
                    val principal = call.principal<JWTPrincipal>()!!
                    val payload = principal.payload
                    call.respond(
                        MeResponse(
                            userId = payload.subject,
                            role = payload.getClaim("role").asString(),
                            email = payload.getClaim("email").asString(),
                        ),
                    )
                }
            }
        }
    }
}
