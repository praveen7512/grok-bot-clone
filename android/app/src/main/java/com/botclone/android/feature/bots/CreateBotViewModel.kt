package com.botclone.android.feature.bots

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.botclone.android.core.datastore.AppPreferences
import com.botclone.android.core.voice.Speaker
import com.botclone.android.core.voice.VoiceOption
import com.botclone.android.data.repository.BotRepository
import com.botclone.android.domain.model.VoiceSettings
import com.botclone.android.ui.components.userMessage
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class CreateBotUiState(
    val name: String = "",
    val persona: String = "",
    val voice: VoiceSettings = VoiceSettings(),
    val creating: Boolean = false,
    val error: String? = null,
) {
    val canSubmit: Boolean get() = name.isNotBlank() && name.length <= MAX_NAME && !creating

    companion object { const val MAX_NAME = 40 }
}

@HiltViewModel
class CreateBotViewModel @Inject constructor(
    private val repo: BotRepository,
    private val speaker: Speaker,
    private val prefs: AppPreferences,
) : ViewModel() {
    private val _state = MutableStateFlow(CreateBotUiState())
    val state: StateFlow<CreateBotUiState> = _state.asStateFlow()

    /** Installed TTS voices; empty until the engine is initialised. */
    val voices: StateFlow<List<VoiceOption>> = speaker.ready
        .map { if (it) speaker.availableVoices() else emptyList() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val _created = Channel<String>(Channel.BUFFERED)
    val created = _created.receiveAsFlow()

    fun onName(v: String) = _state.update { it.copy(name = v.take(CreateBotUiState.MAX_NAME), error = null) }
    fun onPersona(v: String) = _state.update { it.copy(persona = v) }
    fun onVoice(name: String?) = _state.update { it.copy(voice = it.voice.copy(voiceName = name)) }
    fun onRate(rate: Float) = _state.update { it.copy(voice = it.voice.copy(rate = rate)) }
    fun onVoiceEnabled(enabled: Boolean) = _state.update { it.copy(voice = it.voice.copy(enabled = enabled)) }

    fun preview() {
        val s = _state.value
        val name = s.name.ifBlank { "your new bot" }
        speaker.speak("Hi! I'm $name. Namaste, main aapki madad ke liye taiyaar hoon.", s.voice, prefs.current().speechLanguage)
    }

    fun create() {
        val s = _state.value
        if (!s.canSubmit) return
        _state.update { it.copy(creating = true, error = null) }
        viewModelScope.launch {
            repo.create(s.name, s.persona, s.voice)
                .onSuccess { _created.send(it.id) }
                .onFailure { e -> _state.update { it.copy(error = e.userMessage()) } }
            _state.update { it.copy(creating = false) }
        }
    }

    override fun onCleared() {
        speaker.stop()
    }
}
