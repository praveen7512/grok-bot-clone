package com.botclone.android.feature.screen

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.navigation.toRoute
import com.botclone.android.core.datastore.AppPreferences
import com.botclone.android.data.repository.ScreenRepository
import com.botclone.android.domain.model.ScreenSession
import com.botclone.android.navigation.ScreenRoute
import com.botclone.android.ui.components.userMessage
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject

enum class VncStatus { REQUESTING, CONNECTING, CONNECTED, DISCONNECTED, EXPIRED, ERROR }

data class ScreenUiState(
    val botName: String,
    val viewOnly: Boolean = false,
    val session: ScreenSession? = null,
    val status: VncStatus = VncStatus.REQUESTING,
    val message: String? = null,
    val secondsLeft: Long? = null,
)

@HiltViewModel
class ScreenShareViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val repo: ScreenRepository,
    prefs: AppPreferences,
) : ViewModel() {
    private val route = savedStateHandle.toRoute<ScreenRoute>()

    /** Origin the viewer page is served under; see [NoVncAssetInterceptor]. */
    val serverOrigin: String = prefs.current().serverHttpUrl?.toString().orEmpty()

    private val _state = MutableStateFlow(ScreenUiState(botName = route.botName))
    val state: StateFlow<ScreenUiState> = _state.asStateFlow()

    private var countdown: Job? = null

    init {
        connect()
    }

    /** Requests a fresh short-lived token. Called on open, mode switch, reconnect and after expiry. */
    fun connect(viewOnly: Boolean = _state.value.viewOnly) {
        _state.update { it.copy(viewOnly = viewOnly, status = VncStatus.REQUESTING, message = null, session = null) }
        viewModelScope.launch {
            repo.createSession(route.botId, viewOnly)
                .onSuccess { session ->
                    _state.update { it.copy(session = session, status = VncStatus.CONNECTING) }
                    startCountdown(session.expiresAtEpochMs)
                }
                .onFailure { e -> _state.update { it.copy(status = VncStatus.ERROR, message = e.userMessage()) } }
        }
    }

    fun toggleViewOnly() = connect(!_state.value.viewOnly)

    /** Status reported by the viewer page through the JS bridge (any thread). */
    fun onViewerStatus(status: String, message: String?) {
        if (_state.value.status == VncStatus.EXPIRED) return
        val mapped = when (status) {
            "connecting" -> VncStatus.CONNECTING
            "connected" -> VncStatus.CONNECTED
            "disconnected" -> VncStatus.DISCONNECTED
            else -> VncStatus.ERROR
        }
        _state.update { it.copy(status = mapped, message = message?.takeIf { m -> m.isNotBlank() }) }
    }

    private fun startCountdown(expiresAt: Long?) {
        countdown?.cancel()
        if (expiresAt == null) {
            _state.update { it.copy(secondsLeft = null) }
            return
        }
        countdown = viewModelScope.launch {
            while (isActive) {
                val left = (expiresAt - System.currentTimeMillis()) / 1000
                if (left <= 0) {
                    _state.update { it.copy(secondsLeft = 0, status = VncStatus.EXPIRED, session = null,
                        message = "Session expired for security. Reconnect to continue.") }
                    break
                }
                _state.update { it.copy(secondsLeft = left) }
                delay(1_000)
            }
        }
    }
}
