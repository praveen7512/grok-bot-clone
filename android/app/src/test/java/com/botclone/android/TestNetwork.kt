package com.botclone.android

import com.botclone.android.core.network.ChatStreamClient
import com.botclone.android.core.network.NetworkModule
import com.botclone.android.core.network.PLACEHOLDER_BASE_URL
import com.botclone.android.core.network.SessionEvents
import com.botclone.android.data.remote.ApiService
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/** JVM stand-ins for the Android-only pieces (DataStore-backed base URL, WebView cookie store). */
class TestNetwork(apiBase: String) {
    private val base = apiBase.toHttpUrl()

    private val cookies = object : CookieJar {
        private val store = mutableListOf<Cookie>()
        override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) { store += cookies }
        override fun loadForRequest(url: HttpUrl) = store.filter { it.matches(url) }
    }

    val client: OkHttpClient = OkHttpClient.Builder()
        .cookieJar(cookies)
        .addInterceptor { chain ->
            val req = chain.request()
            val url = if (req.url.host == PLACEHOLDER_BASE_URL.toHttpUrl().host) {
                base.resolve(req.url.encodedPath.removePrefix("/"))!!
            } else req.url
            chain.proceed(req.newBuilder().url(url).build())
        }
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    val json = NetworkModule.provideJson()
    val sessionEvents = SessionEvents()
    val api: ApiService = NetworkModule.provideApiService(NetworkModule.provideRetrofit(client, json))
    val stream = ChatStreamClient(client, json, sessionEvents)
}
