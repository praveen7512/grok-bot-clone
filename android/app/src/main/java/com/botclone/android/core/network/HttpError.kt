package com.botclone.android.core.network

import com.botclone.android.data.remote.dto.ErrorEnvelope
import kotlinx.serialization.json.Json
import retrofit2.HttpException
import java.io.IOException

/** HTTP failure outside Retrofit (the SSE chat stream), with the backend's error message if present. */
class HttpError(val code: Int, val serverMessage: String?) : IOException(serverMessage ?: "HTTP $code")

private val errorJson = Json { ignoreUnknownKeys = true }

/** Extracts `error.message` from the backend's `{ error: { code, message } }` body. */
fun parseErrorMessage(body: String): String? =
    runCatching { errorJson.decodeFromString<ErrorEnvelope>(body).error?.message }.getOrNull()

/** Backend error message for a Retrofit [HttpException], read once from the error body. */
fun HttpException.serverMessage(): String? = response()?.errorBody()?.string()?.let(::parseErrorMessage)
