package com.botclone.android.core.network

import com.botclone.android.data.remote.dto.ChatRequest
import com.botclone.android.data.remote.dto.StreamChunkDto
import com.botclone.android.domain.model.ChatStreamEvent
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
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
 * Streams a bot reply from `POST {api}/bots/{id}/chat` (Server-Sent Events, backend `ChatEvent`).
 * Each event is `data: {"type": ..., ...}`:
 *  - `text`        {"delta": "..."}                 incremental assistant text
 *  - `tool_call`   {"name": "run_shell", ...}       bot is using a tool (memory / its sandbox)
 *  - `screen`      {"session": {token, mode, ...}}  "show me your computer" detected
 *  - `done`                                         turn finished
 *  - `error`       {"code": ..., "message": "..."}
 * `user_saved`, `assistant_saved`, `tool_result`, `summarized` and `: ping` comments are ignored.
 */
@Singleton
class ChatStreamClient @Inject constructor(
    private val client: OkHttpClient,
    private val json: Json,
    private val sessionEvents: SessionEvents,
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
                    "text" -> {
                        val text = chunk.delta ?: chunk.text
                        if (!text.isNullOrEmpty()) trySend(ChatStreamEvent.Delta(text))
                    }
                    "tool_call" -> trySend(ChatStreamEvent.Tool(chunk.name ?: "tool"))
                    "screen" -> trySend(ChatStreamEvent.ScreenRequested(chunk.session?.token))
                    "done" -> {
                        trySend(ChatStreamEvent.Done(null))
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
                // Non-2xx before streaming (e.g. 401, 404, validation) -> HttpError carrying the backend message.
                val reason = when {
                    response != null && !response.isSuccessful -> {
                        if (response.code == 401) sessionEvents.notifyExpired()
                        HttpError(response.code, response.body?.string()?.let(::parseErrorMessage))
                    }
                    else -> t ?: IOException("Chat stream failed")
                }
                close(reason)
            }
        }

        val source = EventSources.createFactory(client).newEventSource(request, listener)
        awaitClose { source.cancel() }
    }

    private fun StreamChunkDto.errorMessage(): String? = (message as? JsonPrimitive)?.contentOrNull
}
