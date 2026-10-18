package com.botclone.android.core.voice

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.flowOn
import javax.inject.Inject

sealed interface SpeechEvent {
    data object Ready : SpeechEvent
    data class Level(val rmsDb: Float) : SpeechEvent
    data class Partial(val text: String) : SpeechEvent
    data class Final(val text: String) : SpeechEvent
    data class Error(val message: String) : SpeechEvent
}

/**
 * Wraps [SpeechRecognizer] as a cold Flow: collect to start listening, cancel to stop.
 * One utterance per collection; the flow completes after a final result or error.
 * Requires RECORD_AUDIO, which the UI requests before collecting.
 */
class SpeechInput @Inject constructor(@ApplicationContext private val context: Context) {

    fun isAvailable(): Boolean = SpeechRecognizer.isRecognitionAvailable(context)

    fun listen(languageTag: String): Flow<SpeechEvent> = callbackFlow {
        val recognizer = SpeechRecognizer.createSpeechRecognizer(context)
        recognizer.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) { trySend(SpeechEvent.Ready) }
            override fun onRmsChanged(rmsdB: Float) { trySend(SpeechEvent.Level(rmsdB)) }
            override fun onPartialResults(partialResults: Bundle?) {
                partialResults.firstResult()?.let { trySend(SpeechEvent.Partial(it)) }
            }
            override fun onResults(results: Bundle?) {
                val text = results.firstResult()
                trySend(if (text.isNullOrBlank()) SpeechEvent.Error("Didn't catch that") else SpeechEvent.Final(text))
                close()
            }
            override fun onError(error: Int) {
                trySend(SpeechEvent.Error(error.describe()))
                close()
            }
            override fun onBeginningOfSpeech() = Unit
            override fun onBufferReceived(buffer: ByteArray?) = Unit
            override fun onEndOfSpeech() = Unit
            override fun onEvent(eventType: Int, params: Bundle?) = Unit
        })

        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, languageTag)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
        recognizer.startListening(intent)
        awaitClose {
            recognizer.cancel()
            recognizer.destroy()
        }
    }.flowOn(Dispatchers.Main) // SpeechRecognizer must be used from the main thread

    private fun Bundle?.firstResult(): String? =
        this?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()

    private fun Int.describe(): String = when (this) {
        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Didn't catch that"
        SpeechRecognizer.ERROR_AUDIO -> "Microphone error"
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission needed"
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Network error during recognition"
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Recognizer busy, try again"
        else -> "Speech recognition error ($this)"
    }
}
