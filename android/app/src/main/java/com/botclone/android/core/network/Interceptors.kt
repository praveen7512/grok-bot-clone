package com.botclone.android.core.network

import com.botclone.android.core.datastore.AppPreferences
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/** Placeholder base given to Retrofit; [BaseUrlInterceptor] swaps it for the configured API base on every call. */
const val PLACEHOLDER_BASE_URL = "http://botclone.invalid/"

/**
 * Rewrites requests aimed at [PLACEHOLDER_BASE_URL] to the API base from Settings,
 * so the backend can be changed at runtime without rebuilding Retrofit.
 */
class BaseUrlInterceptor @Inject constructor(private val prefs: AppPreferences) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        if (request.url.host != "botclone.invalid") return chain.proceed(request)
        val base = prefs.current().apiBaseUrl ?: throw IOException("Invalid server URL. Fix it in Settings.")
        val relative = request.url.encodedPath.removePrefix("/") +
            (request.url.encodedQuery?.let { "?$it" } ?: "")
        val target = base.resolve(relative) ?: throw IOException("Cannot resolve $relative against $base")
        return chain.proceed(request.newBuilder().url(target).build())
    }
}

/** Adds `Authorization: Bearer <token>` when the backend issued one (cookies cover the default case) and reports 401s so the UI can send the user back to login. */
class AuthInterceptor @Inject constructor(
    private val prefs: AppPreferences,
    private val sessionEvents: SessionEvents,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val settings = prefs.current()
        val token = settings.authToken
        val request = chain.request().newBuilder().apply {
            if (token != null) header("Authorization", "Bearer $token")
        }.build()
        val response = chain.proceed(request)
        if (response.code == 401 && settings.signedIn && !request.url.encodedPath.endsWith("auth/login")) {
            sessionEvents.notifyExpired()
        }
        return response
    }
}

@Singleton
class SessionEvents @Inject constructor() {
    private val _expired = MutableSharedFlow<Unit>(extraBufferCapacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    val expired: SharedFlow<Unit> = _expired

    fun notifyExpired() {
        _expired.tryEmit(Unit)
    }
}
