package com.pgpe.api

import com.auth0.jwk.JwkProviderBuilder
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
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import io.ktor.server.routing.routing
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import java.net.URI
import java.util.concurrent.TimeUnit

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

@Serializable
data class CreateTargetRequest(
    val orgId: String,
    val name: String,
    val host: String,
    val port: Int = 5432,
    val database: String,
    val username: String,
    val password: String,
    val isProduction: Boolean = false,
    val sslMode: String = "require",
)

@Serializable
data class CreateTargetResponse(val id: String)

@Serializable
data class EnqueueIntrospectResponse(val msgId: Long)

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

    val supabaseUrl = System.getenv("SUPABASE_URL")
        ?: error("SUPABASE_URL is not set.")
    val supabaseAnonKey = System.getenv("SUPABASE_ANON_KEY")
        ?: error("SUPABASE_ANON_KEY is not set.")

    val jwksUri = URI("$supabaseUrl/auth/v1/.well-known/jwks.json").toURL()
    val issuer = "$supabaseUrl/auth/v1"

    val jwkProvider = JwkProviderBuilder(jwksUri)
        .cached(10, 24, TimeUnit.HOURS)
        .rateLimited(10, 1, TimeUnit.MINUTES)
        .build()

    val postgrest = PostgRest(baseUrl = supabaseUrl, anonKey = supabaseAnonKey)

    install(Authentication) {
        jwt("supabase") {
            realm = "pgpe-api"
            verifier(jwkProvider, issuer) {
                acceptLeeway(5)
            }
            validate { credential ->
                if (credential.payload.subject.isNullOrBlank()) null
                else JWTPrincipal(credential.payload)
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
        get("/healthz") {
            call.respond(HealthResponse(status = "ok"))
        }

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

                post("/targets") {
                    val req = call.receive<CreateTargetRequest>()
                    val jwt = call.bearerJwtOrReject() ?: return@post
                    val rpcBody = buildJsonObject {
                        put("p_org_id", JsonPrimitive(req.orgId))
                        put("p_name", JsonPrimitive(req.name))
                        put("p_host", JsonPrimitive(req.host))
                        put("p_port", JsonPrimitive(req.port))
                        put("p_database", JsonPrimitive(req.database))
                        put("p_username", JsonPrimitive(req.username))
                        put("p_password", JsonPrimitive(req.password))
                        put("p_is_production", JsonPrimitive(req.isProduction))
                        put("p_ssl_mode", JsonPrimitive(req.sslMode))
                    }
                    val res = postgrest.callRpc("create_target", rpcBody, jwt)
                    if (res.isSuccess) {
                        // PostgREST returns the uuid as a JSON string literal `"..."`
                        call.respond(
                            HttpStatusCode.Created,
                            CreateTargetResponse(id = res.body.trim().trim('"')),
                        )
                    } else {
                        call.respondPostgrestError(res)
                    }
                }

                post("/targets/{id}/introspect") {
                    val targetId = call.parameters["id"]
                        ?: return@post call.respond(
                            HttpStatusCode.BadRequest,
                            ErrorResponse("missing target id"),
                        )
                    val jwt = call.bearerJwtOrReject() ?: return@post
                    val rpcBody = buildJsonObject {
                        put("p_target_id", JsonPrimitive(targetId))
                    }
                    val res = postgrest.callRpc("enqueue_introspect", rpcBody, jwt)
                    if (res.isSuccess) {
                        val msgId = res.body.trim().toLongOrNull()
                            ?: return@post call.respond(
                                HttpStatusCode.InternalServerError,
                                ErrorResponse("unexpected rpc response: ${res.body}"),
                            )
                        call.respond(
                            HttpStatusCode.Accepted,
                            EnqueueIntrospectResponse(msgId = msgId),
                        )
                    } else {
                        call.respondPostgrestError(res)
                    }
                }

                delete("/targets/{id}") {
                    val targetId = call.parameters["id"]
                        ?: return@delete call.respond(
                            HttpStatusCode.BadRequest,
                            ErrorResponse("missing target id"),
                        )
                    val jwt = call.bearerJwtOrReject() ?: return@delete
                    val rpcBody = buildJsonObject {
                        put("p_target_id", JsonPrimitive(targetId))
                    }
                    val res = postgrest.callRpc("delete_target", rpcBody, jwt)
                    if (res.isSuccess) {
                        call.respond(HttpStatusCode.NoContent)
                    } else {
                        call.respondPostgrestError(res)
                    }
                }
            }
        }
    }
}
