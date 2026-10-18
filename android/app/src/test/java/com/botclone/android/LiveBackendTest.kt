package com.botclone.android

import com.botclone.android.data.remote.dto.CreateBotRequest
import com.botclone.android.data.remote.dto.LoginRequest
import com.botclone.android.data.remote.dto.VoiceDto
import com.botclone.android.data.repository.toDomainOrNull
import com.botclone.android.domain.model.ChatStreamEvent
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * Optional end-to-end check against a running backend. Skipped unless BOTCLONE_LIVE_URL is set, e.g.
 * `BOTCLONE_LIVE_URL=http://localhost:8787 BOTCLONE_LIVE_PASSWORD=... ./gradlew testDebugUnitTest`
 */
class LiveBackendTest {
    @Test fun loginCreateChatMemoryDelete() = runBlocking {
        val url = System.getenv("BOTCLONE_LIVE_URL").orEmpty()
        assumeTrue("BOTCLONE_LIVE_URL not set", url.isNotBlank())
        val net = TestNetwork(url.trimEnd('/') + "/api/")

        net.api.login(LoginRequest(System.getenv("BOTCLONE_LIVE_PASSWORD") ?: "test123"))
        assertTrue(net.api.session().authenticated)

        val bot = net.api.createBot(CreateBotRequest("Android E2E", "test bot", VoiceDto(true, "en-in-x-ene-local", 1.1f))).bot
        try {
            assertEquals("en-in-x-ene-local", bot.voice?.name)
            val events = net.stream.stream(bot.id, "remember my phone is Pixel").toList()
            assertTrue(events.any { it is ChatStreamEvent.Delta })
            assertTrue(events.last() is ChatStreamEvent.Done)

            val history = net.api.messages(bot.id).messages.mapNotNull { it.toDomainOrNull() }
            assertTrue(history.size >= 2)
            println("live: ${events.size} events, ${history.size} visible messages, memories=${net.api.memories(bot.id).memories.map { it.key }}")
        } finally {
            assertTrue(net.api.deleteBot(bot.id).isSuccessful)
        }
    }
}
