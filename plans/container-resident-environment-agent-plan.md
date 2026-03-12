# Goal

Finish hardening Beanbag’s `docker` environment around the container-resident `environment-agent` model, so the provider runtime and env-agent both run inside the container and the same deployment shape can later be reused for E2B sandboxes.

# Scope

- Keep the existing container-resident Docker environment-agent path and remove remaining host-managed or opt-in assumptions around it.
- Introduce a repo-owned Docker image definition that captures the runtime contract for containerized environments.
- Add a distributable Beanbag environment-agent artifact that can be started inside Docker now and E2B later.
- Preserve the existing host-managed model for `local` and `worktree`.
- Keep the hybrid delivery architecture: environment-agent push to daemon with daemon nudge/replay as backstop.

# Implementation Steps

Current status:

- Docker already provisions a direct environment-agent target and starts the env-agent inside the container.
- Docker roundtrip coverage already exists, so the remaining work is about hardening and simplification rather than proving the model from scratch.
- The main remaining gaps are:
  - a repo-owned image/runtime contract
  - cleaner bundle and boot semantics
  - removal of leftover host-managed assumptions
  - better readiness and availability reporting

1. Add a repo-owned container image definition.
   - Create a Docker assets location in the repo, for example under `packages/environment/docker/`.
   - Add a `Dockerfile` that includes the minimum runtime contract needed for Beanbag container environments:
     - Node
     - git
     - shell/core Unix tools
     - any provider runtime prerequisites Beanbag requires
   - Keep the image intentionally small and aligned with current Beanbag needs, not Terragon’s full “everything installed” image.
   - Treat this Dockerfile as the source of truth that future E2B templates should build from.

2. Produce a deployable environment-agent bundle.
   - Add a build step or package output for `@beanbag/environment-agent` so it can be launched inside a container without depending on the whole monorepo source tree.
   - Prefer a single runnable JS artifact or a very small runtime payload.
   - Follow Terragon’s daemon pattern from [`packages/sandbox/src/daemon.ts`](https://github.com/terragon-labs/terragon-oss/blob/main/packages/sandbox/src/daemon.ts): ship a versioned app bundle separately from the base image.

3. Define the container boot contract.
   - Decide how Docker environments get the environment-agent artifact:
     - baked into the image, or
     - copied/written into the container at prepare time
   - Recommended direction:
     - keep the base image stable
     - inject the current environment-agent bundle at boot time
   - Pass the same startup config the current host-managed agent uses:
     - thread/project/environment IDs
     - daemon callback URL
     - auth token
     - provider launch config

4. Harden and simplify the in-container agent lifecycle.
   - Keep [docker-environment.ts](/Users/michael/Projects/bb/packages/environment/src/docker-environment.ts) focused on:
     - creating or resuming the container
     - ensuring the environment-agent bundle is present in the container
     - starting or reconnecting to the container-local environment-agent
     - verifying readiness over HTTP
   - Keep Docker-specific environment-agent boot logic isolated in [docker-environment-agent.ts](/Users/michael/Projects/bb/packages/environment/src/docker-environment-agent.ts).
   - Remove any remaining dependency on [host-environment-agent.ts](/Users/michael/Projects/bb/packages/environment/src/host-environment-agent.ts) for Docker paths.
   - Keep `local` and `worktree` on the host-managed agent path for now.

5. Make the container agent reachable from the daemon.
   - Decide how the daemon reaches the in-container HTTP environment-agent:
     - publish a host port and map it to the container
     - or use a Docker exec/tunnel helper as a transport bridge
   - Prefer a direct HTTP endpoint with an explicit per-thread auth token, because that matches the future E2B mental model.
   - Persist enough container/agent metadata in Docker environment state to reconnect cleanly after daemon restart.

6. Keep Docker first-class and remove remaining opt-in assumptions.
   - Keep [server.ts](/Users/michael/Projects/bb/apps/daemon/src/server.ts) registering Docker by default.
   - Remove docs, tests, or fallback logic that still describe Docker as host-agent-managed or feature-gated.
   - Prefer targeted validation and explicit provisioning failures over hidden availability rules.

7. Add Docker readiness and error handling.
   - Validate:
     - Docker CLI presence
     - Docker daemon reachability
     - availability of the configured/default image
     - successful startup of the in-container environment-agent
   - Produce clear, stable errors instead of leaking raw `docker` stderr when possible.

8. Align the design with future E2B support.
   - Extract the common “environment-resident agent” boot contract so it is not Docker-specific.
   - Keep Docker-specific logic limited to:
     - container lifecycle
     - file/bundle injection
     - port exposure/reachability
   - Plan for a future `e2b` environment to reuse:
     - the same image contract
     - the same environment-agent bundle
     - the same daemon callback/auth model

9. Clean up obsolete Docker scaffolding.
   - Remove any leftover compatibility helpers that only exist for the older host-managed Docker path.
   - Remove any fallback assumptions that the provider wrapper alone is sufficient for Docker.
   - Update tests and docs so Docker is no longer described as opt-in or host-agent-managed.

# Validation

- `pnpm --filter @beanbag/environment-agent build`
- `pnpm --filter @beanbag/environment test`
- `pnpm --filter @beanbag/environment typecheck`
- `pnpm --filter @beanbag/daemon test`
- `pnpm --filter @beanbag/daemon typecheck`
- Add Docker-focused tests for:
  - default Docker registration without feature flags
  - missing Docker CLI / daemon
  - missing image or failed local image build
  - container-resident environment-agent startup and readiness
  - daemon reconnect to an already-running Docker environment-agent

# Open Questions/Risks

- Should Beanbag auto-build the repo Dockerfile into a local image when missing, or require an explicit setup/build step?
- Should the environment-agent bundle be baked into the image or injected at boot time?
- What is the cleanest daemon-to-container connectivity model for local Docker that still resembles future E2B networking closely enough?
- How much of Docker’s current worktree-backed model should remain versus moving to a more self-contained cloned-repo model like Terragon’s sandbox setup?
- Do we want to expose Docker availability metadata in the API/UI, or rely on selection-time provisioning errors initially?
