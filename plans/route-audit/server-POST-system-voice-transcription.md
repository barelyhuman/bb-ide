# `POST /api/v1/system/voice-transcription` — Transcribe Audio to Text

**Route:** `apps/server/src/routes/system.ts:93`
**Contract:** `{ form: SystemVoiceTranscriptionForm } -> SystemVoiceTranscriptionResponse` (200)
**Complexity:** Medium (external API call to OpenAI)

## Request Body (or Params)

| Field | Required | Notes |
|---|---|---|
| `file` (form) | Yes | Audio file. Validated as `instanceof File`. Size-checked against 25MB limit. Passed to OpenAI Whisper API. |
| `prompt` (form) | Optional | Context hint for transcription. If present and a non-empty string, trimmed and passed to OpenAI as the `prompt` parameter. |

**All 2 fields consumed. No dead params.**

Note: This route does NOT use the `typedRoutes` validation for the body — it reads `formData` manually from the request. The `SystemVoiceTranscriptionForm` type in the contract is a loose `{ [key: string]: string | Blob }` — no Zod schema validation at the route level.

## Implementation Trace

1. (sync) Check `deps.config.openAiApiKey`. If falsy, throws `ApiError(501, "not_configured")`.
2. (async) `context.req.formData()` — reads multipart form data from request.
3. (sync) `formData.get("file")` — validates it's an `instanceof File`. If not, throws generic `Error("Audio file is required")`.
4. (async) `transcribeVoiceInput({file, openAiApiKey, prompt})`:
   - (sync) Size check: `file.size > 25 * 1024 * 1024` -> throws `ApiError(400, "invalid_request", "Audio file exceeds 25MB limit")`.
   - (async) Builds `FormData` with `model: "gpt-4o-transcribe"`, `file`, and optionally `prompt`.
   - (async) `fetch("https://api.openai.com/v1/audio/transcriptions", ...)` — external HTTP POST to OpenAI.
   - (async) Parses JSON response. If `!response.ok`, extracts error message from OpenAI error format or falls back to generic message, throws `ApiError(502, "provider_rpc_error")`.
   - (sync) Validates `parsed.text` is a string. Throws 502 if not.
5. Returns `{ text: transcription }`.

> **-> HTTP 200 returns here.** No background work. No DB access.

## DB Query Summary

No queries.

**Total: 0 queries.**

## Code Reuse

| Function | Shared? | Other callers |
|---|---|---|
| `transcribeVoiceInput` | One-off | Only this route |

## Flags

1. **No Zod validation on the form body.** The `prompt` field is checked manually with `typeof formData.get("prompt") === "string"`. The `file` field is checked with `instanceof File`. This is reasonable for multipart forms (Zod doesn't handle `FormData` natively), but it means the error for a missing file is a generic `Error` (500) rather than a typed `ApiError` (400). The `"Audio file is required"` error will be caught by the global error handler and returned as `{ code: "internal_error" }` with status 500.

2. ~~**Missing file returns 500 instead of 400.** The `throw new Error("Audio file is required")` on line 100 should probably be `throw new ApiError(400, "invalid_request", "Audio file is required")` for a proper client error response.~~ **Fixed** — now throws `ApiError(400)` instead of plain `Error`.

3. **OpenAI model is hardcoded** to `"gpt-4o-transcribe"`. Not configurable. This is fine for now but worth noting if model selection becomes a concern.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `transcribeVoiceInput` API wrapper | `apps/app/src/lib/api.ts:291` | Posts audio file + optional prompt to the transcription endpoint via `postMultipart` |
| `PromptBox` | `apps/app/src/components/promptbox/PromptBox.tsx:444` | Calls `transcribeVoiceInput` after recording audio; inserts transcript into prompt box |
| `useVoiceInput` hook | `apps/app/src/hooks/useVoiceInput.ts:236` | Orchestrates recording state machine; calls the `onTranscribe` callback provided by `PromptBox` |
| `public-environments-system.test.ts` | `apps/server/test/public-environments-system.test.ts:540` | Tests that transcription is rejected when OpenAI API key is not configured |
| No CLI callers | — | Voice transcription is a web-app-only feature |

---

## Review Comments

Flag 2 fixed (2026-03-28): changed `throw new Error(...)` to `throw new ApiError(400, "invalid_request", "Audio file is required")` so missing file now returns 400 instead of 500.
