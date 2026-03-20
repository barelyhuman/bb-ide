# Shared Environment Routing Invariants

These invariants define the expected ownership boundaries for shared environments.
They apply across server orchestration, env-daemon runtime, provider bridges, and QA.

## Ownership Boundaries

- Environment owns the env-daemon process and the server-to-daemon session.
- Thread owns provider session state, thread-scoped commands, and thread-scoped event history.
- Provider child owns only the provider runtime process for a routed provider spec. It does not own the environment or any privileged thread identity.

## Hard Rules

1. There is no special thread for an environment.

- “owner”, “originating”, “representative”, and “primary transport” thread concepts must not be used as routing authority for environment-scoped behavior.
- `environmentId` is the authority for environment runtime identity.

2. Routing must fail closed.

- Work must never be sent to a guessed thread or guessed provider.
- If the system cannot resolve a unique `(environmentId, threadId, providerId, providerThreadId)` target, it must return or surface an explicit error.
- Silent fallback to the callback thread, the first attached thread, or the first provider in the environment is a correctness bug.

3. Attachment state is the runtime source of truth.

- When attachment rows exist, attachment membership is authoritative for runtime routing and lifecycle.
- `threads.environmentId` may exist as compatibility residue, but it must not override attachment state in shared-environment flows.

4. Managed vs unmanaged behavior is environment-scoped.

- `managed` alone decides whether setup and cleanup semantics apply.
- Managed artifact lifecycle is keyed by `environmentId`, not by the thread that first provisioned or resumed the environment.

5. Environment-scoped and thread-scoped commands are distinct.

- Environment-scoped operations must not piggyback on arbitrary thread routing.
- Thread-scoped operations must require an explicit attached thread and provider binding.

## Minimum Acceptance Bar

- No thread/provider/environment ambiguity can silently degrade into an idle-looking or unresponsive thread.
- Multi-thread same-provider and multi-thread mixed-provider scenarios in one environment both converge correctly.
- Archive, resume, cleanup, and reprovision decisions are keyed by environment attachment state and `managed`, never by a legacy special-thread concept.
