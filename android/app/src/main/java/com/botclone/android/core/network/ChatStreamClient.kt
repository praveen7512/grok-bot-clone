package com.botclone.android.core.network

import com.botclone.android.data.remote.dto.ChatRequest
import com.botclone.android.data.remote.dto.StreamChunkDto
import com.botclone.android.domain.model.ChatStreamEvent
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Streams a bot reply from `POST {api}/bots/{id}/chat` (Server-Sent Events).
 *
 * Events (SSE `event:` name, or a `type` field in the JSON payload):
 *  - `text`   {"text": "..."}       incremental assistant text
 *  - `tool`   {"name": "run_shell"} bot is using a tool in its sandbox
 *  - `screen` {"token"?: "..."}     "show me your computer" detected, open the screen panel
 *  - `done`   {"messageId"?: ...}   turn finished
 *  - `error`  {"message": "..."} or {"error": {"message": ...}}
 * A bare `data: [DONE]` also ends the stream.
 */
@Singleton
class ChatStreamClient @Inject constructor(
    private val client: OkHttpClient,
    private val json: Json,
) {
    fun stream(botId: String, message: String): Flow<ChatStreamEvent> = callbackFlow {
        val request = Request.Builder()
            .url("${PLACEHOLDER_BASE_URL}bots/$botId/chat")
            .header("Accept", "text/event-stream")
            .post(json.encodeToString(ChatRequest(message)).toRequestBody("application/json".toMediaType()))
            .build()

        val listener = object : EventSourceListener() {
            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                if (data.trim() == "[DONE]") {
                    trySend(ChatStreamEvent.Done(null)); close(); return
                }
                val chunk = runCatching { json.decodeFromString<StreamChunkDto>(data) }
                    .getOrElse { StreamChunkDto(text = data) } // plain-text deltas
                when ((type ?: chunk.type ?: "text").lowercase()) {
                    "text", "delta", "token", "content_block_delta" -> {
                        val text = chunk.text ?: chunk.delta
                        if (!text.isNullOrEmpty()) trySend(ChatStreamEvent.Delta(text))
                    }
                    "tool", "tool_use" -> trySend(ChatStreamEvent.Tool(chunk.name ?: "tool"))
                    "screen", "screen_share" -> trySend(ChatStreamEvent.ScreenRequested(chunk.token))
                    "done", "end", "message_stop" -> {
                        trySend(ChatStreamEvent.Done(chunk.messageId?.jsonPrimitiveOrNull()?.content))
                        close()
                    }
                    "error" -> close(IOException(chunk.errorMessage() ?: "Stream error"))
                    else -> Unit // ping / unknown events are ignored
                }
            }

            override fun onClosed(eventSource: EventSource) {
                close()
            }

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                val reason = t ?: IOException(
                    response?.let { "Chat failed (${it.code}): ${it.body?.string()?.take(200).orEmpty()}" } ?: "Chat stream failed",
                )
                close(reason)
            }
        }

        val source = EventSources.createFactory(client).newEventSource(request, listener)
        awaitClose { source.cancel() }
    }

    private fun JsonElement.jsonPrimitiveOrNull(): JsonPrimitive? = this as? JsonPrimitive

    private fun StreamChunkDto.errorMessage(): String? = message ?: when (val e = error) {
        is JsonPrimitive -> e.contentOrNull
        is JsonObject -> (e["message"] as? JsonPrimitive)?.contentOrNull
        else -> null
    }
}
