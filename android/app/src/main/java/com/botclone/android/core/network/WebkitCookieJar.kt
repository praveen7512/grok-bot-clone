package com.botclone.android.core.network

import android.webkit.CookieManager
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import javax.inject.Inject
import javax.inject.Singleton

/**
 * OkHttp [CookieJar] backed by the WebView [CookieManager].
 *
 * The backend's owner session is an httpOnly cookie. Sharing one store means the cookie set by
 * `POST /api/auth/login` through Retrofit is automatically sent by the WebView when the noVNC page
 * opens `WS /vnc/:id?token=`, which requires both the session cookie and the screen token.
 * CookieManager also persists cookies across app restarts.
 */
@Singleton
class WebkitCookieJar @Inject constructor() : CookieJar {
    private val manager: CookieManager by lazy { CookieManager.getInstance().apply { setAcceptCookie(true) } }

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val origin = url.originString()
        cookies.forEach { manager.setCookie(origin, it.toString()) }
        manager.flush()
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val header = manager.getCookie(url.toString()) ?: return emptyList()
        return header.split(';').mapNotNull { Cookie.parse(url, it.trim()) }
    }

    fun clear() {
        manager.removeAllCookies(null)
        manager.flush()
    }

    private fun HttpUrl.originString() = "$scheme://$host" + if (port != HttpUrl.defaultPort(scheme)) ":$port" else ""
}
