package com.botclone.android.core.voice

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import com.botclone.android.domain.model.VoiceSettings
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.Locale
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

data class VoiceOption(val name: String, val label: String, val languageTag: String, val networkRequired: Boolean)

/**
 * App-wide [TextToSpeech] wrapper. Each call to [speak] applies that bot's [VoiceSettings],
 * so voices stay per-bot even though there is a single engine.
 */
@Singleton
class Speaker @Inject constructor(@ApplicationContext context: Context) {

    private val _ready = MutableStateFlow(false)
    val ready: StateFlow<Boolean> = _ready.asStateFlow()

    private val _speaking = MutableStateFlow(false)
    val speaking: StateFlow<Boolean> = _speaking.asStateFlow()

    private val tts: TextToSpeech = TextToSpeech(context) { status ->
        _ready.value = status == TextToSpeech.SUCCESS
    }.apply {
        setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) { _speaking.value = true }
            override fun onDone(utteranceId: String?) { if (!isSpeaking) _speaking.value = false }
            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) { _speaking.value = false }
            override fun onStop(utteranceId: String?, interrupted: Boolean) { _speaking.value = false }
        })
    }

    /** Installed voices for English and Hindi, sorted so Indian locales come first. */
    fun availableVoices(): List<VoiceOption> {
        if (!_ready.value) return emptyList()
        return runCatching { tts.voices.orEmpty() }.getOrDefault(emptySet())
            .filter { it.locale.language in setOf("en", "hi") && !it.features.orEmpty().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) }
            .sortedWith(compareByDescending<Voice> { it.locale.country == "IN" }.thenBy { it.locale.toLanguageTag() }.thenBy { it.name })
            .map { VoiceOption(it.name, "${it.locale.displayName} · ${it.name.substringAfterLast('-').ifBlank { it.name }}", it.locale.toLanguageTag(), it.isNetworkConnectionRequired) }
    }

    fun speak(text: String, settings: VoiceSettings, fallbackLanguage: String = "en-IN", flush: Boolean = true) {
        if (!_ready.value || text.isBlank()) return
        apply(settings, fallbackLanguage)
        val mode = if (flush) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD
        // TTS engines cap utterance length; split long replies on sentence boundaries.
        chunk(text.stripMarkdown()).forEachIndexed { i, part ->
            tts.speak(part, if (i == 0) mode else TextToSpeech.QUEUE_ADD, null, UUID.randomUUID().toString())
        }
    }

    fun stop() {
        tts.stop()
        _speaking.value = false
    }

    private fun apply(settings: VoiceSettings, fallbackLanguage: String) {
        val voice = settings.voiceName?.let { name -> runCatching { tts.voices }.getOrNull()?.firstOrNull { it.name == name } }
        if (voice != null) tts.voice = voice else tts.language = Locale.forLanguageTag(fallbackLanguage)
        tts.setSpeechRate(settings.rate.coerceIn(0.25f, 3f))
    }

    private fun chunk(text: String): List<String> {
        val max = TextToSpeech.getMaxSpeechInputLength() - 1
        if (text.length <= max) return listOf(text)
        val out = mutableListOf<String>()
        val sb = StringBuilder()
        text.split(Regex("(?<=[.!?।])\\s+")).forEach { sentence ->
            if (sb.length + sentence.length + 1 > max && sb.isNotEmpty()) { out += sb.toString(); sb.clear() }
            sb.append(sentence.take(max)).append(' ')
        }
        if (sb.isNotBlank()) out += sb.toString()
        return out
    }

    private fun String.stripMarkdown(): String = this
        .replace(Regex("```[\\s\\S]*?```"), " code block omitted. ")
        .replace(Regex("[*_`#>]+"), "")
        .replace(Regex("\\[(.*?)]\\((.*?)\\)"), "$1")
}
