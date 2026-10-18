package com.botclone.android.feature.screen

import android.annotation.SuppressLint
import android.content.Context
import android.view.inputmethod.InputMethodManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.Keyboard
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle

/**
 * Live view and remote control of a bot's sandbox desktop.
 *
 * Input: noVNC's own touch handling maps taps to left clicks, long-press / two-finger tap to right
 * click, drag to mouse drag and two-finger swipe to scroll. The keyboard button opens the soft
 * keyboard, whose keystrokes the viewer page forwards as RFB key events.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScreenShareScreen(onBack: () -> Unit, viewModel: ScreenShareViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val webView = remember { createVncWebView(context, viewModel) }

    DisposableEffect(Unit) {
        onDispose {
            webView.evaluateJavascript("window.botclone && window.botclone.disconnect()", null)
            webView.destroy()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("${state.botName}'s computer", style = MaterialTheme.typography.titleMedium)
                        Text(
                            state.statusLine(),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                },
                actions = {
                    IconButton(onClick = { viewModel.connect() }) { Icon(Icons.Outlined.Refresh, contentDescription = "Reconnect") }
                },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).imePadding()) {
            Box(Modifier.weight(1f).fillMaxWidth().background(Color(0xFF0E0F12))) {
                val session = state.session
                if (session != null) {
                    AndroidView(
                        factory = { webView },
                        update = { view ->
                            if (view.tag != session.viewerUrl) {
                                view.tag = session.viewerUrl
                                view.loadUrl(session.viewerUrl)
                            }
                        },
                        modifier = Modifier.fillMaxSize(),
                    )
                }
                when (state.status) {
                    VncStatus.REQUESTING, VncStatus.CONNECTING ->
                        CircularProgressIndicator(Modifier.align(Alignment.Center))
                    VncStatus.ERROR, VncStatus.EXPIRED, VncStatus.DISCONNECTED -> Column(
                        Modifier.align(Alignment.Center).padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(state.message ?: "Disconnected", color = MaterialTheme.colorScheme.onSurface)
                        Spacer(Modifier.height(12.dp))
                        Button(onClick = { viewModel.connect() }) { Text("Reconnect") }
                    }
                    VncStatus.CONNECTED -> Unit
                }
            }
            ControlBar(
                viewOnly = state.viewOnly,
                connected = state.status == VncStatus.CONNECTED,
                onToggleViewOnly = viewModel::toggleViewOnly,
                onKeyboard = { webView.showSoftKeyboard() },
                onKey = { key -> webView.evaluateJavascript("window.botclone.sendKey('$key')", null) },
                onCtrlAltDel = { webView.evaluateJavascript("window.botclone.sendCtrlAltDel()", null) },
            )
        }
    }
}

@Composable
private fun ControlBar(
    viewOnly: Boolean,
    connected: Boolean,
    onToggleViewOnly: () -> Unit,
    onKeyboard: () -> Unit,
    onKey: (String) -> Unit,
    onCtrlAltDel: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().navigationBarsPadding().horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FilterChip(selected = !viewOnly, onClick = onToggleViewOnly, label = { Text(if (viewOnly) "View only" else "Control") })
        val controls = connected && !viewOnly
        AssistChip(
            onClick = onKeyboard,
            enabled = controls,
            label = { Text("Keyboard") },
            leadingIcon = { Icon(Icons.Outlined.Keyboard, contentDescription = null) },
        )
        listOf("Escape" to "Esc", "Tab" to "Tab", "Left" to "←", "Up" to "↑", "Down" to "↓", "Right" to "→").forEach { (key, label) ->
            AssistChip(onClick = { onKey(key) }, enabled = controls, label = { Text(label) })
        }
        AssistChip(onClick = onCtrlAltDel, enabled = controls, label = { Text("Ctrl+Alt+Del") })
    }
}

private fun ScreenUiState.statusLine(): String {
    val base = when (status) {
        VncStatus.REQUESTING -> "Requesting secure session…"
        VncStatus.CONNECTING -> "Connecting…"
        VncStatus.CONNECTED -> if (viewOnly) "Viewing" else "Remote control"
        VncStatus.DISCONNECTED -> "Disconnected"
        VncStatus.EXPIRED -> "Session expired"
        VncStatus.ERROR -> "Error"
    }
    val timer = secondsLeft?.takeIf { status == VncStatus.CONNECTED || status == VncStatus.CONNECTING }
        ?.let { " · expires in %d:%02d".format(it / 60, it % 60) }
    return base + timer.orEmpty()
}

@SuppressLint("SetJavaScriptEnabled")
private fun createVncWebView(context: Context, viewModel: ScreenShareViewModel): WebView {
    val interceptor = NoVncAssetInterceptor(context.assets, viewModel.serverOrigin)
    return WebView(context).apply {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.setSupportZoom(false)
        setBackgroundColor(android.graphics.Color.parseColor("#0E0F12"))
        isFocusable = true
        isFocusableInTouchMode = true
        // Shares the session cookie that WebkitCookieJar stored at login.
        CookieManager.getInstance().setAcceptCookie(true)
        addJavascriptInterface(VncBridge(viewModel), "AndroidBridge")
        webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                interceptor.intercept(request)

            // Keep navigation inside the viewer; the page should never navigate elsewhere.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true
        }
    }
}

private fun WebView.showSoftKeyboard() {
    requestFocus()
    evaluateJavascript("window.botclone.focusKeyboard()") {
        val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        imm.showSoftInput(this, InputMethodManager.SHOW_IMPLICIT)
    }
}

/** Receives connection status from viewer.html. Called on a WebView binder thread. */
private class VncBridge(private val viewModel: ScreenShareViewModel) {
    @JavascriptInterface
    fun onStatus(status: String, message: String?) = viewModel.onViewerStatus(status, message)
}
