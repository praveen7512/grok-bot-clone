package com.botclone.android.feature.screen

import android.content.res.AssetManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import com.botclone.android.data.repository.ScreenRepository
import java.io.IOException

/**
 * Serves the noVNC viewer bundled in `assets/novnc/` for requests to `{server}/__botclone_android/...`.
 *
 * Loading the viewer under the backend's own origin (instead of file:// or a data URL) keeps the
 * `WS /vnc/:id?token=` connection same-origin, so the WebView sends the httpOnly SameSite=Lax session
 * cookie that the backend requires alongside the screen token. Nothing under this prefix ever reaches the server.
 */
class NoVncAssetInterceptor(
    private val assets: AssetManager,
    private val serverOrigin: String, // e.g. "http://10.0.2.2:8787/"
) {
    private val prefix = serverOrigin.trimEnd('/') + "/" + ScreenRepository.ASSET_PREFIX

    fun intercept(request: WebResourceRequest): WebResourceResponse? {
        val url = request.url.toString().substringBefore('?').substringBefore('#')
        if (!url.startsWith(prefix)) return null
        val path = url.removePrefix(prefix)
        if (path.contains("..")) return notFound()
        return try {
            WebResourceResponse(mimeFor(path), "utf-8", assets.open(path)).apply {
                responseHeaders = mapOf("Cache-Control" to "no-cache")
            }
        } catch (_: IOException) {
            notFound()
        }
    }

    private fun notFound() = WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), null)

    private fun mimeFor(path: String) = when (path.substringAfterLast('.', "").lowercase()) {
        "html" -> "text/html"
        "js", "mjs" -> "text/javascript" // ES modules require a JS MIME type
        "css" -> "text/css"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        "json" -> "application/json"
        else -> "application/octet-stream"
    }
}
