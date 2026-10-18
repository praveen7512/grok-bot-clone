# Backend API used by the Android app

Verified against `server/src/routes/*.ts` on 2026-10-19 (and live against the backend in mock-LLM mode).
Base is `{server}/api/`. Auth is the httpOnly `SameSite=Lax` session cookie set by login. Errors are
`{ "error": { "code", "message" } }`.

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `auth/login` | `{password}` | `{ok:true}` + Set-Cookie (401 wrong password, 429 rate limit) |
| GET | `auth/me` | | `{authenticated, expiresAt}` |
| POST | `auth/logout` | | `{ok:true}` |
| GET | `bots` | | `{bots: Bot[]}` |
| POST | `bots` | `{name, persona?, voice?:{enabled?, name?, rate? (0.5–2)}}` (voice is `.strict()`) | 201 `{bot}` |
| GET | `bots/:id` | | `{bot}` |
| PATCH | `bots/:id` | `{name?, persona?, voice?}` | `{bot}` |
| DELETE | `bots/:id` | | 204 |
| GET | `bots/:id/messages` | | `{messages: StoredMessage[], summary}`. `content` is Anthropic blocks |
| DELETE | `bots/:id/messages` | | 204 |
| POST | `bots/:id/chat` | `{message}` | SSE `data: ChatEvent` (see below) |
| GET | `bots/:id/memories` | | `{memories: [{key, value, createdAt, updatedAt}]}` |
| DELETE | `bots/:id/memories/:key` | | 204 |
| POST | `bots/:id/screen-session` | `{mode: "view"\|"control"}` | `{session:{token, mode, expiresAt(ms), wsPath}}`, or 501 in demo mode |
| WS | `/vnc/:id?token=` (no `/api`) | subprotocol `binary` | raw RFB. Needs the session cookie and the token |

`Bot = {id (uuid), name, persona, status: provisioning|ready|stopped|error, voice:{enabled, name, rate}, createdAt, ...}`

ChatEvent `type`: `user_saved`, `text {delta}`, `tool_call {name, input}`, `tool_result`, `assistant_saved`,
`screen {session}`, `summarized`, `done`, `error {code, message}`. The app uses `text`, `tool_call`, `screen`, `done` and `error`.
