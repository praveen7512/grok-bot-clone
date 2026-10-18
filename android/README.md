# BotClone for Android

Native Android client for the BotClone backend (`../server`). It covers the same core features as the web app:
owner login, a bot list, creating bots, streaming chat, per-bot memory, voice in/out, and live screen sharing
with remote control of each bot's sandbox desktop.

**Stack:** Kotlin 2.0, Jetpack Compose (Material 3), MVVM, Hilt, Retrofit + OkHttp (+ okhttp-sse),
kotlinx.serialization, Coroutines/Flow, DataStore, and type-safe Navigation Compose. minSdk 26, target/compile SDK 35.

## Build

Requirements: JDK 17+ (tested with 21) and the Android SDK (platform 35, build-tools 35). Android Studio Ladybug or newer works too.

```bash
cd android
echo "sdk.dir=$ANDROID_HOME" > local.properties   # Android Studio creates this for you
./gradlew assembleDebug                            # -> app/build/outputs/apk/debug/app-debug.apk
./gradlew installDebug                             # install on a connected device or emulator
./gradlew testDebugUnitTest                        # JVM tests (API contract + SSE parsing)
```

Optional end-to-end test against a running backend:

```bash
BOTCLONE_LIVE_URL=http://localhost:8787 BOTCLONE_LIVE_PASSWORD=<OWNER_PASSWORD> ./gradlew testDebugUnitTest
```

## Connecting to the backend

The server URL is set at runtime under **Settings** (the gear icon on the login screen):

| Where the backend runs | Server URL |
|---|---|
| Your Mac, app on the emulator | `http://10.0.2.2:8787` (default) |
| Your Mac, app on a phone on the same Wi-Fi | `http://<mac-lan-ip>:8787` |
| Deployed | `https://your-domain` |

The API prefix defaults to `api`. Sign in with the backend's `OWNER_PASSWORD`.
Cleartext HTTP is allowed so local dev works (`res/xml/network_security_config.xml`). Turn it off for production builds.

## Architecture

```
com.botclone.android
├── BotCloneApp, MainActivity        Hilt app, single activity, sign-out/401 → login
├── navigation/AppNavHost            type-safe routes: Login, BotList, CreateBot, Chat, Screen, Settings
├── core/
│   ├── datastore/AppPreferences     server URL, API prefix, signed-in flag, speech language (DataStore)
│   ├── network/                     Retrofit/OkHttp module, BaseUrlInterceptor (runtime URL switching),
│   │                                AuthInterceptor (401 → SessionEvents), WebkitCookieJar,
│   │                                ChatStreamClient (SSE → Flow<ChatStreamEvent>), HttpError
│   ├── voice/SpeechInput            SpeechRecognizer as a cold Flow<SpeechEvent>
│   ├── voice/Speaker                TextToSpeech singleton that applies each bot's VoiceSettings
│   └── di/                          application CoroutineScope
├── data/
│   ├── remote/ApiService, dto/      REST contract that mirrors server/src/routes
│   └── repository/                  Auth, Bot, Chat, Screen repositories + DTO→domain mappers
├── domain/model/                    Bot, VoiceSettings, ChatMessage, MemoryItem, ScreenSession, ChatStreamEvent
├── feature/
│   ├── auth/                        LoginScreen + VM (owner password)
│   ├── bots/                        BotList (pull to refresh, polls while provisioning, long-press delete),
│   │                                CreateBot (name, persona, voice picker + preview + speed)
│   ├── chat/                        ChatScreen + VM: streaming bubbles, tool activity, type/talk modes,
│   │                                memory sheet, voice settings dialog, clear chat, delete bot
│   ├── screen/                      ScreenShareScreen + VM, NoVncAssetInterceptor
│   ├── settings/                    server URL, API prefix, speech language, sign out
│   └── voice/VoiceSettingsEditor    shared Compose editor for a bot's voice
└── ui/                              theme, shared components, error → message mapping
assets/novnc/                        noVNC 1.7.0 core (MPL-2.0) + viewer.html
```

### How the pieces work

- **Auth.** The backend uses an httpOnly session cookie. `WebkitCookieJar` stores OkHttp cookies in the WebView
  `CookieManager`, so the cookie from `POST /api/auth/login` is also available to the screen-share WebView,
  and it survives app restarts. On launch, `GET /api/auth/me` checks that the session is still valid. Any 401 sends you back to login.
- **Streaming chat.** `POST /api/bots/:id/chat` is consumed with okhttp-sse and exposed as a `Flow`.
  `text` deltas are appended to the reply bubble as they arrive, `tool_call` shows "Saving to memory…" or "Running a command…",
  `screen` opens the screen panel, and `done` ends the turn. Stop cancels the stream, which aborts the request on the server.
- **Context isolation and memory.** These are enforced server-side, per bot id. The app shows each bot's own history
  (`GET /messages`, with tool turns hidden) and memories (`GET /memories`, with delete).
- **Voice.** The headset icon switches between typing and talking. Talk mode uses a large mic button with a live
  partial transcript and sends automatically when you stop speaking. Replies are read aloud by `TextToSpeech`
  using that bot's voice (name, speed, on/off), which is saved on the bot via `PATCH /api/bots/:id`. The mic is
  also available in type mode. The recognition language (en-IN, hi-IN or en-US) is set in Settings.
  Voices picked on the web are Web Speech names. If that voice isn't installed on the phone, the default voice is used.
- **Screen share and remote control.** Tap the monitor icon, or say or type "show me your computer" or "apna computer dikhao".
  The app requests `POST /api/bots/:id/screen-session {mode}` (a 10-minute token) and opens `viewer.html` in a WebView.
  The viewer is bundled noVNC, served by `NoVncAssetInterceptor` under the **backend's origin**
  (`{server}/__botclone_android/novnc/viewer.html`), so `WS /vnc/:id?token=` is same-origin and carries the
  SameSite=Lax session cookie, which the proxy requires. noVNC turns touch into mouse input (tap = click,
  two-finger tap = right click, drag, two-finger scroll). The **Keyboard** chip opens the soft keyboard, and the
  viewer forwards keystrokes as RFB keysyms. There are also chips for Esc, Tab, the arrow keys and Ctrl+Alt+Del.
  The View only / Control toggle requests a new token in the other mode, and the server enforces view-only.
  A countdown shows when the token expires, then you can reconnect.

## Notes and limitations

- Screen sharing needs the backend in Docker sandbox mode. In subprocess (demo) mode the API returns 501, and the app shows that message.
- If the server URL has a sub-path (for example `https://host/botclone/`), the VNC WebSocket still goes to `/vnc/...` on that host, matching the backend.
- Release builds: add signing config and disable cleartext traffic.
