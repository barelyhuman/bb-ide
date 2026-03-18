# Codex App Server

This repo should not keep a vendored copy of the upstream Codex app-server
README.

Use these sources instead:

- Upstream reference: [openai/codex app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
- Generated local types: `packages/core/src/generated/codex-app-server/**`
- Local exports used by bb: `packages/core/src/index.ts`,
  `packages/core/src/types.ts`

If you need to understand which Codex notifications bb currently consumes, read
the generated schema plus the normalization code in
`packages/core/src/thread-event-normalization.ts`.
