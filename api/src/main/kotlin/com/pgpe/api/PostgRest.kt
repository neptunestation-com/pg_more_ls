package com.pgpe.api

import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation as ClientContentNegotiation
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.JsonElement

/**
 * Thin HTTP client for Supabase PostgREST. Used by the api's
 * target-management endpoints to invoke SECURITY DEFINER RPC wrappers
 * defined in `supabase/migrations/20260525235429_*` while preserving
 * the caller's identity (PostgREST sets `request.jwt.claims` from the
 * forwarded Bearer token so `auth.uid()` inside the function resolves
 * to the actual user).
 */
class PostgRest(
    private val baseUrl: String,
    private val anonKey: String,
) {
    private val http = HttpClient(CIO) {
        install(ClientContentNegotiation) { json() }
    }

    /**
     * POST `/rest/v1/rpc/{functionName}` with the user's Bearer JWT.
     * Caller must hand in the raw JWT string (no `Bearer ` prefix).
     */
    suspend fun callRpc(
        functionName: String,
        body: JsonElement,
        userJwt: String,
    ): RpcResult {
        val res = http.post("$baseUrl/rest/v1/rpc/$functionName") {
            contentType(ContentType.Application.Json)
            headers.append("apikey", anonKey)
            headers.append(HttpHeaders.Authorization, "Bearer $userJwt")
            setBody(body)
        }
        return RpcResult(status = res.status.value, body = res.bodyAsText())
    }

    fun close() = http.close()
}

data class RpcResult(val status: Int, val body: String) {
    val isSuccess: Boolean get() = status in 200..299
}
