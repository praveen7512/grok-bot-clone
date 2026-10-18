package com.botclone.android.feature.chat

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.navigation.toRoute
import com.botclone.android.core.datastore.AppPreferences
import com.botclone.android.core.voice.SpeechEvent
import com.botclone.android.core.voice.SpeechInput
import com.botclone.android.core.voice.Speaker
import com.botclone.android.core.voice.VoiceOption
import com.botclone.android.data.repository.BotRepository
import com.botclone.android.data.repository.ChatRepository
import com.botclone.android.domain.model.Bot
import com.botclone.android.domain.model.BotStatus
import com.botclone.android.domain.model.ChatMessage
import com.botclone.android.domain.model.ChatStreamEvent
import com.botclone.android.domain.model.MemoryItem
import com.botclone.android.domain.model.Role
import com.botclone.android.domain.model.VoiceSettings
import com.botclone.android.navigation.ChatRoute
import com.botclone.android.ui.components.userMessage
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onCompletion
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject

data class ChatUiState(
    val bot: Bot? = null,
    val messages: List<ChatMessage> = emptyList(),
    val input: String = "",
    val loadingHistory: Boolean = true,
    val streaming: Boolean = false,
    val toolActivity: String? = null,
    val error: String? = null,
    /** Talk mode: mic-first input and replies spoken aloud (if the bot's voice is enabled). */
    val voiceMode: Boolean = false,
    val listening: Boolean = false,
    val transcript: String = "",
    val micLevel: Float = 0f,
    val memories: List<MemoryItem>? = null,
    val memoriesLoading: Boolean = false,
) {
    val canSend: Boolean get() = input.isNotBlank() && !streaming && bot?.status != BotStatus.ERROR
}

sealed interface ChatEffect {
    data class OpenScreen(val botId: String, val botName: String) : ChatEffect
    data object Deleted : ChatEffect
}

@HiltViewModel
class ChatViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val bots: BotRepository,
    private val chat: ChatRepository,
    private val speechInput: SpeechInput,
    private val speaker: Speaker,
    private val prefs: AppPreferences,
) : ViewModel() {
    private val botId = savedStateHandle.toRoute<ChatRoute>().botId

    private val _state = MutableStateFlow(ChatUiState())
    val state: StateFlow<ChatUiState> = _state.asStateFlow()

    private val _effects = Channel<ChatEffect>(Channel.BUFFERED)
    val effects = _effects.receiveAsFlow()

    val speaking: StateFlow<Boolean> = speaker.speaking
    val voices: StateFlow<List<VoiceOption>> = speaker.ready
        .map { if (it) speaker.availableVoices() else emptyList() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val speechAvailable: Boolean get() = speechInput.isAvailable()

    private var streamJob: Job? = null
    private var listenJob: Job? = null

    init {
        loadBot()
        loadHistory()
    }

    private fun loadBot() = viewModelScope.launch {
        // Poll while the bot's container is still provisioning.
        while (isActive) {
            bots.get(botId)
                .onSuccess { bot -> _state.update { it.copy(bot = bot) } }
                .onFailure { e -> _state.update { it.copy(error = e.userMessage()) } }
            if (_state.value.bot?.status != BotStatus.PROVISIONING) break
            delay(2_000)
        }
    }

    private fun loadHistory() = viewModelScope.launch {
        chat.history(botId)
            .onSuccess { history -> _state.update { it.copy(messages = history) } }
            .onFailure { e -> _state.update { it.copy(error = e.userMessage()) } }
        _state.update { it.copy(loadingHistory = false) }
    }

    fun onInput(text: String) = _state.update { it.copy(input = text) }
    fun dismissError() = _state.update { it.copy(error = null) }

    fun send(text: String = _state.value.input) {
        val message = text.trim()
        if (message.isEmpty() || _state.value.streaming) return
        speaker.stop()
        val replyId = "local-" + UUID.randomUUID()
        _state.update {
            it.copy(
                input = "",
                streaming = true,
                error = null,
                messages = it.messages +
                    ChatMessage("local-" + UUID.randomUUID(), Role.USER, message) +
                    ChatMessage(replyId, Role.ASSISTANT, "", isStreaming = true),
            )
        }

        streamJob = viewModelScope.launch {
            chat.send(botId, message)
                .catch { e -> _state.update { it.copy(error = e.userMessage()) } }
                .onCompletion { finishReply(replyId) }
                .collect { event ->
                    when (event) {
                        is ChatStreamEvent.Delta -> updateReply(replyId) { it + event.text }.also {
                            _state.update { s -> s.copy(toolActivity = null) }
                        }
                        is ChatStreamEvent.Tool -> _state.update { it.copy(toolActivity = event.name.toToolLabel()) }
                        is ChatStreamEvent.ScreenRequested -> {
                            // The screen panel requests its own token so it can choose view vs control mode.
                            _effects.send(ChatEffect.OpenScreen(botId, _state.value.bot?.name ?: "Bot"))
                        }
                        is ChatStreamEvent.Done -> Unit
                    }
                }
        }
    }

    fun stopStreaming() {
        streamJob?.cancel()
    }

    private fun updateReply(id: String, transform: (String) -> String) = _state.update { s ->
        s.copy(messages = s.messages.map { if (it.id == id) it.copy(content = transform(it.content)) else it })
    }

    private fun finishReply(id: String) {
        val s = _state.value
        val reply = s.messages.firstOrNull { it.id == id }
        _state.update { st ->
            st.copy(
                streaming = false,
                toolActivity = null,
                // Drop an empty placeholder (e.g. screen request handled without text, or an error).
                messages = st.messages.mapNotNull { m ->
                    if (m.id != id) m else if (m.content.isBlank()) null else m.copy(isStreaming = false)
                },
            )
        }
        val bot = s.bot
        if (reply != null && reply.content.isNotBlank() && bot != null && s.voiceMode && bot.voice.enabled) {
            speaker.speak(reply.content, bot.voice, prefs.current().speechLanguage)
        }
    }

    // ---- Voice ----

    fun toggleVoiceMode() {
        val enabled = !_state.value.voiceMode
        _state.update { it.copy(voiceMode = enabled) }
        if (!enabled) {
            stopListening()
            speaker.stop()
        }
    }

    fun stopSpeaking() = speaker.stop()

    /** Starts one utterance; the final transcript is sent automatically. Call after RECORD_AUDIO is granted. */
    fun startListening() {
        if (_state.value.listening) return
        speaker.stop()
        _state.update { it.copy(listening = true, transcript = "") }
        listenJob = viewModelScope.launch {
            speechInput.listen(prefs.current().speechLanguage)
                .onCompletion { _state.update { it.copy(listening = false, micLevel = 0f) } }
                .collect { event ->
                    when (event) {
                        SpeechEvent.Ready -> Unit
                        is SpeechEvent.Level -> _state.update { it.copy(micLevel = ((event.rmsDb + 2f) / 12f).coerceIn(0f, 1f)) }
                        is SpeechEvent.Partial -> _state.update { it.copy(transcript = event.text) }
                        is SpeechEvent.Final -> {
                            _state.update { it.copy(transcript = "") }
                            send(event.text)
                        }
                        is SpeechEvent.Error -> _state.update { it.copy(transcript = "", error = event.message) }
                    }
                }
        }
    }

    fun stopListening() {
        listenJob?.cancel()
        _state.update { it.copy(listening = false, transcript = "", micLevel = 0f) }
    }

    fun onMicPermissionDenied() = _state.update { it.copy(error = "Microphone permission is needed for voice input") }

    // ---- Bot settings ----

    fun updateVoice(voice: VoiceSettings) {
        val bot = _state.value.bot ?: return
        _state.update { it.copy(bot = bot.copy(voice = voice)) } // optimistic
        viewModelScope.launch {
            bots.updateVoice(botId, voice)
                .onSuccess { updated -> _state.update { it.copy(bot = updated) } }
                .onFailure { e -> _state.update { it.copy(bot = bot, error = e.userMessage()) } }
        }
    }

    fun previewVoice(voice: VoiceSettings) {
        speaker.speak("Hi, this is how I'll sound.", voice, prefs.current().speechLanguage)
    }

    fun deleteBot() = viewModelScope.launch {
        bots.delete(botId)
            .onSuccess { _effects.send(ChatEffect.Deleted) }
            .onFailure { e -> _state.update { it.copy(error = e.userMessage()) } }
    }

    fun requestScreen() = viewModelScope.launch {
        _effects.send(ChatEffect.OpenScreen(botId, _state.value.bot?.name ?: "Bot"))
    }

    // ---- Memory ----

    fun loadMemories() {
        _state.update { it.copy(memoriesLoading = true) }
        viewModelScope.launch {
            chat.memories(botId)
                .onSuccess { list -> _state.update { it.copy(memories = list) } }
                .onFailure { e -> _state.update { it.copy(error = e.userMessage(), memories = emptyList()) } }
            _state.update { it.copy(memoriesLoading = false) }
        }
    }

    fun deleteMemory(item: MemoryItem) {
        _state.update { s -> s.copy(memories = s.memories?.filterNot { it.key == item.key }) }
        viewModelScope.launch {
            chat.deleteMemory(botId, item.key).onFailure { e ->
                _state.update { it.copy(error = e.userMessage()) }
                loadMemories()
            }
        }
    }

    override fun onCleared() {
        speaker.stop()
    }

    private fun String.toToolLabel(): String = when (this) {
        "run_shell" -> "Running a command in its sandbox…"
        "remember", "save_memory", "memory_save" -> "Saving to memory…"
        "recall", "search_memory", "memory_search" -> "Checking memory…"
        else -> "Using $this…"
    }
}
