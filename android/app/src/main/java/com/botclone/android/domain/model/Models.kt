package com.botclone.android.domain.model

/**
 * Per-bot text-to-speech preferences, stored on the bot row by the backend.
 * [voiceName] is a platform voice name (an Android TTS voice, or a Web Speech voice when created from the web);
 * when it isn't installed on this device the app falls back to the default voice for the speech language.
 */
data class VoiceSettings(
    val enabled: Boolean = true,
    val voiceName: String? = null,
    val rate: Float = 1.0f,
)

enum class BotStatus { PROVISIONING, READY, STOPPED, ERROR, UNKNOWN;
    companion object {
        fun from(raw: String?): BotStatus = when (raw?.lowercase()) {
            "provisioning", "starting", "creating", "pending" -> PROVISIONING
            "ready", "running", "live" -> READY
            "stopped", "exited", "paused" -> STOPPED
            "error", "failed" -> ERROR
            else -> UNKNOWN
        }
    }
}

data class Bot(
    val id: String,
    val name: String,
    val persona: String,
    val status: BotStatus,
    val voice: VoiceSettings,
    val createdAt: Long?,
)

enum class Role { USER, ASSISTANT, SYSTEM }

data class ChatMessage(
    val id: String,
    val role: Role,
    val content: String,
    val createdAt: Long? = null,
    val isStreaming: Boolean = false,
)

data class MemoryItem(val key: String, val value: String, val updatedAt: Long?)

data class ScreenSession(
    val token: String,
    val expiresAtEpochMs: Long?,
    val viewOnly: Boolean,
    /** Absolute URL of the bundled noVNC viewer page (served under the backend origin), token embedded. */
    val viewerUrl: String,
)

/** Events produced while streaming a bot reply. */
sealed interface ChatStreamEvent {
    data class Delta(val text: String) : ChatStreamEvent
    data class Done(val messageId: String?) : ChatStreamEvent
    /** Backend detected "show me your computer" / "screen dikhao": open the screen panel. [token] may be pre-issued. */
    data class ScreenRequested(val token: String?) : ChatStreamEvent
    /** The bot is running a tool (memory, shell in its sandbox). */
    data class Tool(val name: String) : ChatStreamEvent
}
