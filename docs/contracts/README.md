# Contracts

This folder is for the small set of contracts that still benefit from a
hand-written explanation.

## What belongs here

Keep docs here only when they describe a durable boundary that spans processes
or packages and cannot be understood quickly from one source file alone.

Current examples:

- the server `<->` environment-daemon session protocol
- the server-side persistence expectations around that protocol

## What does not belong here

Do not keep hand-maintained inventories of:

- HTTP routes
- database tables
- package dependency graphs
- event unions or generated provider schemas

Those drift too easily and already have better sources of truth in code.

## Source of truth

- Server routes: `apps/server/src/routes/**`
- HTTP request/response types and schemas: `packages/core/src/api-types.ts`,
  `packages/core/src/schemas.ts`
- Thread/event types: `packages/core/src/types.ts`,
  `packages/core/src/thread-event-normalization.ts`
- Database schema and repositories: `packages/db/src/schema.ts`,
  `packages/db/src/repositories.ts`,
  `packages/db/src/environment-daemon-repositories.ts`
- Package boundaries: workspace `package.json` files plus import sites
- Env-daemon session protocol types: `packages/environment-daemon/src/session-protocol.ts`

If a doc here cannot stay tighter and clearer than those files, remove it.
