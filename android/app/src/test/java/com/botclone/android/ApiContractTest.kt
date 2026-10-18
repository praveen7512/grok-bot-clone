package com.botclone.android

import com.botclone.android.core.network.HttpError
import com.botclone.android.data.remote.dto.ScreenSessionRequest
import com.botclone.android.data.repository.toDomain
import com.botclone.android.data.repository.toDomainOrNull
import com.botclone.android.domain.model.BotStatus
import com.botclone.android.domain.model.ChatStreamEvent
import com.botclone.android.domain.model.Role
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

/** Parses payloads recorded from the real backend (server/src/routes/botRoutes.ts, mock LLM). */
class ApiContractTest {
    private lateinit var server: MockWebServer
    private lateinit var net: TestNetwork

    @Before fun setUp() {
        server = MockWebServer().apply { start() }
        net = TestNetwork(server.url("/api/").toString())
    }

    @After fun tearDown() = server.shutdown()

    private fun json(body: String, code: Int = 200) =
        server.enqueue(MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json; charset=utf-8").setBody(body))

    @Test fun botEnvelopeMapsVoiceAndStatus() = runTest {
        json("""{"bot":{"id":"a4861698-efac-4d5a-a283-071d16ffb79c","name":"Jarvis","persona":"helpful","status":"ready","sandboxKind":"subprocess","sandboxRef":"/x","voice":{"enabled":true,"name":"hi-in-x-hia-local","rate":1.2},"lastActiveAt":null,"createdAt":1792352020325,"updatedAt":1792352020326}}""")
        val bot = net.api.getBot("a4861698-efac-4d5a-a283-071d16ffb79c").bot.toDomain()
        assertEquals(BotStatus.READY, bot.status)
        assertEquals("hi-in-x-hia-local", bot.voice.voiceName)
        assertEquals(1.2f, bot.voice.rate)
        assertEquals("/api/bots/a4861698-efac-4d5a-a283-071d16ffb79c", server.takeRequest().path)
    }

    @Test fun messagesHideToolResultsAndKeepText() = runTest {
        json("""{"messages":[
          {"id":1,"botId":"b","role":"user","content":[{"type":"text","text":"remember my name is Praveen"}],"summarized":false,"createdAt":1},
          {"id":2,"botId":"b","role":"assistant","content":[{"type":"text","text":"Using save_memory… "},{"type":"tool_use","id":"t","name":"save_memory","input":{"key":"k","value":"v"}}],"summarized":false,"createdAt":2},
          {"id":3,"botId":"b","role":"user","content":[{"type":"tool_result","tool_use_id":"t","content":"Saved"}],"summarized":false,"createdAt":3}
        ],"summary":null}""")
        val msgs = net.api.messages("b").messages.mapNotNull { it.toDomainOrNull() }
        assertEquals(2, msgs.size)
        assertEquals(Role.ASSISTANT, msgs[1].role)
        assertEquals("Using save_memory…", msgs[1].content)
    }

    @Test fun memoriesEnvelope() = runTest {
        json("""{"memories":[{"key":"my_name_is","value":"my name is Praveen","createdAt":1,"updatedAt":2}]}""")
        val m = net.api.memories("b").memories.single().toDomain()
        assertEquals("my_name_is", m.key)
        assertEquals(2L, m.updatedAt)
    }

    @Test fun screenSessionEnvelopeAndModeBody() = runTest {
        json("""{"session":{"token":"abc","mode":"control","expiresAt":1792352620000,"wsPath":"/vnc/b?token=abc"}}""")
        val s = net.api.createScreenSession("b", ScreenSessionRequest("control")).session
        assertEquals("abc", s.token)
        assertEquals("""{"mode":"control"}""", server.takeRequest().body.readUtf8())
    }

    @Test fun chatStreamParsesBackendEvents() = runTest {
        val sse = listOf(
            """{"type":"user_saved","message":{"id":1,"role":"user","content":[{"type":"text","text":"hi"}]}}""",
            """{"type":"text","delta":"Using save_m"}""",
            """{"type":"text","delta":"emory… "}""",
            """{"type":"tool_call","id":"t","name":"save_memory","input":{"key":"k","value":"v"}}""",
            """{"type":"tool_result","id":"t","name":"save_memory","output":"ok","isError":false}""",
            """{"type":"screen","session":{"token":"tok","mode":"view","expiresAt":1,"wsPath":"/vnc/b?token=tok"}}""",
            """{"type":"text","delta":"Done."}""",
            """{"type":"done"}""",
        ).joinToString("") { "data: $it\n\n" }
        server.enqueue(MockResponse().setHeader("Content-Type", "text/event-stream").setBody(": ping\n\n$sse"))

        val events = net.stream.stream("b", "hi").toList()
        assertEquals(
            listOf(
                ChatStreamEvent.Delta("Using save_m"),
                ChatStreamEvent.Delta("emory… "),
                ChatStreamEvent.Tool("save_memory"),
                ChatStreamEvent.ScreenRequested("tok"),
                ChatStreamEvent.Delta("Done."),
                ChatStreamEvent.Done(null),
            ),
            events,
        )
        val req = server.takeRequest()
        assertEquals("/api/bots/b/chat", req.path)
        assertEquals("""{"message":"hi"}""", req.body.readUtf8())
    }

    @Test fun chatStreamErrorEventFails() = runTest {
        server.enqueue(MockResponse().setHeader("Content-Type", "text/event-stream")
            .setBody("data: {\"type\":\"error\",\"code\":\"llm\",\"message\":\"Claude is down\"}\n\n"))
        try {
            net.stream.stream("b", "hi").toList()
            fail("expected error")
        } catch (e: Exception) {
            assertEquals("Claude is down", e.message)
        }
    }

    @Test fun chat401CarriesServerMessageAndSignalsExpiry() = runTest {
        json("""{"error":{"code":"unauthorized","message":"Session expired or missing. Please log in."}}""", code = 401)
        var expired = false
        val job = backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { net.sessionEvents.expired.collect { expired = true } }
        try {
            net.stream.stream("b", "hi").toList()
            fail("expected error")
        } catch (e: HttpError) {
            assertEquals(401, e.code)
            assertEquals("Session expired or missing. Please log in.", e.serverMessage)
        } finally {
            job.cancel()
        }
        assertTrue(expired)
    }
}
