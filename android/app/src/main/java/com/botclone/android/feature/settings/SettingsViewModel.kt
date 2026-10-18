package com.botclone.android.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.botclone.android.core.datastore.AppPreferences
import com.botclone.android.data.repository.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import javax.inject.Inject

data class SettingsUiState(
    val serverUrl: String = "",
    val apiPrefix: String = "",
    val speechLanguage: String = "en-IN",
    val urlError: String? = null,
    val saved: Boolean = false,
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val prefs: AppPreferences,
    private val auth: AuthRepository,
) : ViewModel() {
    private val _state = MutableStateFlow(SettingsUiState())
    val state: StateFlow<SettingsUiState> = _state.asStateFlow()

    val signedIn: StateFlow<Boolean> = prefs.settingsFlow.map { it.signedIn }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    init {
        viewModelScope.launch {
            val s = prefs.settingsFlow.first()
            _state.update { it.copy(serverUrl = s.serverUrl, apiPrefix = s.apiPrefix, speechLanguage = s.speechLanguage) }
        }
    }

    fun onServerUrl(v: String) = _state.update { it.copy(serverUrl = v, urlError = null, saved = false) }
    fun onApiPrefix(v: String) = _state.update { it.copy(apiPrefix = v, saved = false) }

    fun onSpeechLanguage(tag: String) {
        _state.update { it.copy(speechLanguage = tag) }
        viewModelScope.launch { prefs.setSpeechLanguage(tag) }
    }

    fun save() {
        val url = _state.value.serverUrl.trim()
        val parsed = url.toHttpUrlOrNull()
        if (parsed == null) {
            _state.update { it.copy(urlError = "Enter a full URL, e.g. http://192.168.1.10:8787") }
            return
        }
        viewModelScope.launch {
            prefs.setServer(url, _state.value.apiPrefix)
            _state.update { it.copy(saved = true) }
        }
    }

    fun logout() {
        viewModelScope.launch { auth.logout() }
    }
}
