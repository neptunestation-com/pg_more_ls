package com.pgpe.api

import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.response.respond
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Pulls the raw Bearer token off the Authorization header. The JWT
 * plugin already verified it for routes inside `authenticate("supabase")`,
 * so by the time this is called we know the header is well-formed.
 * Returns null and 401s if for any reason the header is missing now
 * (defensive — shouldn't happen).
 */
suspend fun ApplicationCall.bearerJwtOrReject(): String? {
    val header = request.headers[HttpHeaders.Authorization]
    val raw = header?.removePrefix("Bearer ")?.trim()
    if (raw.isNullOrBlank()) {
        respond(HttpStatusCode.Unauthorized, ErrorResponse("Missing bearer token"))
        return null
    }
    return raw
}

/**
 * Maps a non-success PostgREST response onto our `ErrorResponse` shape.
 * PostgREST returns a JSON object with `code` / `details` / `hint` /
 * `message`; we surface `message` (or the raw body as a fallback).
 */
suspend fun ApplicationCall.respondPostgrestError(res: RpcResult) {
    val msg = runCatching {
        val obj = Json.parseToJsonElement(res.body) as? JsonObject
        obj?.get("message")?.jsonPrimitive?.contentOrNull
    }.getOrNull() ?: res.body.ifBlank { "rpc failed (status ${res.status})" }
    respond(HttpStatusCode.fromValue(res.status), ErrorResponse(msg))
}
