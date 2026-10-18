package com.botclone.android.core.datastore

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.botclone.android.BuildConfig
import com.botclone.android.core.di.ApplicationScope
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.runBlocking
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import javax.inject.Inject
import javax.inject.Singleton

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "botclone_prefs")

data class AppSettings(
    /** Server root, e.g. `http://192.168.1.10:8080/`. Used for the noVNC viewer page. */
    val serverUrl: String = BuildConfig.DEFAULT_BASE_URL,
    /** Path prefix of the REST API under [serverUrl]. */
    val apiPrefix: String = DEFAULT_API_PREFIX,
    /** True after a successful login; the session itself is an httpOnly cookie held by [com.botclone.android.core.network.WebkitCookieJar]. */
    val signedIn: Boolean = false,
    /** Optional bearer token, only if the backend returns one. */
    val authToken: String? = null,
    /** Recognizer language for voice input, e.g. `en-IN` or `hi-IN`. */
    val speechLanguage: String = "en-IN",
) {
    val serverHttpUrl: HttpUrl? get() = serverUrl.toHttpUrlOrNull()

    val apiBaseUrl: HttpUrl?
        get() = serverHttpUrl?.resolve(apiPrefix.trim('/').let { if (it.isEmpty()) "" else "$it/" })

    companion object {
        const val DEFAULT_API_PREFIX = "api"
    }
}

/**
 * Single source of truth for user-configurable settings and the auth session.
 * Exposes a hot [settings] StateFlow so OkHttp interceptors can read it synchronously.
 */
@Singleton
class AppPreferences @Inject constructor(
    @ApplicationContext private val context: Context,
    @ApplicationScope scope: CoroutineScope,
) {
    private object Keys {
        val serverUrl = stringPreferencesKey("server_url")
        val apiPrefix = stringPreferencesKey("api_prefix")
        val signedIn = booleanPreferencesKey("signed_in")
        val token = stringPreferencesKey("auth_token")
        val speechLanguage = stringPreferencesKey("speech_language")
    }

    val settingsFlow: Flow<AppSettings> = context.dataStore.data.map { p ->
        AppSettings(
            serverUrl = p[Keys.serverUrl] ?: BuildConfig.DEFAULT_BASE_URL,
            apiPrefix = p[Keys.apiPrefix] ?: AppSettings.DEFAULT_API_PREFIX,
            signedIn = p[Keys.signedIn] ?: false,
            authToken = p[Keys.token],
            speechLanguage = p[Keys.speechLanguage] ?: "en-IN",
        )
    }

    private val cached: StateFlow<AppSettings?> = settingsFlow.stateIn(scope, SharingStarted.Eagerly, null)

    /** Current settings; blocks only on the very first read before DataStore has emitted. */
    fun current(): AppSettings = cached.value ?: runBlocking { settingsFlow.first() }

    suspend fun setServer(serverUrl: String, apiPrefix: String) {
        val normalized = serverUrl.trim().let { if (it.endsWith("/")) it else "$it/" }
        context.dataStore.edit {
            it[Keys.serverUrl] = normalized
            it[Keys.apiPrefix] = apiPrefix.trim()
        }
    }

    suspend fun setSpeechLanguage(tag: String) {
        context.dataStore.edit { it[Keys.speechLanguage] = tag }
    }

    suspend fun saveSession(token: String?) {
        context.dataStore.edit {
            it[Keys.signedIn] = true
            if (token != null) it[Keys.token] = token else it.remove(Keys.token)
        }
    }

    suspend fun clearSession() {
        context.dataStore.edit {
            it[Keys.signedIn] = false
            it.remove(Keys.token)
        }
    }
}
