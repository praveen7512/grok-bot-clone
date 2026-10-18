package com.botclone.android.core.network

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonElement
import okhttp3.Interceptor
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import javax.inject.Inject

/**
 * Tolerates common response envelopes (`{"data": ...}`, `{"bots": [...]}`, `{"bot": {...}}`)
 * by unwrapping them to the bare payload the [com.botclone.android.data.remote.ApiService] DTOs expect.
 * Skips SSE and non-JSON responses.
 */
class EnvelopeUnwrapInterceptor @Inject constructor(private val json: Json) : Interceptor {

    private val envelopeKeys = setOf("data", "bots", "bot", "messages", "memory", "memories", "items", "result")

    override fun intercept(chain: Interceptor.Chain): Response {
        val response = chain.proceed(chain.request())
        val body = response.body ?: return response
        val type = body.contentType()
        if (!response.isSuccessful || type?.subtype?.contains("json") != true) return response

        val raw = body.string()
        val unwrapped = runCatching { unwrap(json.parseToJsonElement(raw)) }.getOrNull()
        val out = unwrapped?.toString() ?: raw
        return response.newBuilder().body(out.toResponseBody(type)).build()
    }

    private fun unwrap(element: JsonElement): JsonElement {
        if (element !is JsonObject || element.size != 1) return element
        val (key, value) = element.entries.first()
        return if (key in envelopeKeys && (value is JsonObject || value is JsonArray)) value else element
    }
}
