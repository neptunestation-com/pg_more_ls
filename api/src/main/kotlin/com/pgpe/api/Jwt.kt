package com.pgpe.api

import java.util.Base64

/**
 * Decode a JWT's payload segment without verifying its signature.
 *
 * Returns the raw JSON payload as a string, or null if the token is
 * malformed. NOT a security primitive — Phase 0.3 uses this only to
 * log incoming claims for diagnostic purposes. Real verification
 * (against Supabase's JWT secret or JWKS) will land alongside the
 * first authenticated route in Phase 1.
 */
internal fun decodeJwtPayload(token: String): String? {
    val parts = token.split(".")
    if (parts.size != 3) return null
    val payloadB64 = parts[1]
    val padded = payloadB64 + "=".repeat((4 - payloadB64.length % 4) % 4)
    return runCatching {
        Base64.getUrlDecoder().decode(padded).toString(Charsets.UTF_8)
    }.getOrNull()
}
