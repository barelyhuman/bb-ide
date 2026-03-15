# Test Quality Refactor — Mock Discipline & Behavior-Based Assertions

## Goal

Refactor ~76 implementation-detail assertions across 4 test files to assert behavior/outcomes instead. Establish clear mocking principles so future tests don't regress.

## Mocking Principles

### Mock at boundaries, not inside the system

**Run the real thing when it's cheap:**
- SQLite/DB operations (in-memory DB is fast and catches real constraint violations)
- Pure functions, helpers, type transformations
- State machines, validators, serializers

**Mock when the real thing is expensive, slow, or has side effects:**
- External providers (Codex, OpenAI) — network calls, cost, flakiness
- File system operations that create/delete real files
- Process spawning (child_process.spawn)
- Network listeners (HTTP servers, WebSocket)
- Timers and delays (use vi.useFakeTimers)

**Never mock:**
- The module under test
- Private methods of the class being tested (use public API)
- Database repositories (use real in-memory SQLite via `createConnection(":memory:")`)

### Assert outcomes, not call sequences

**Good:** Check resulting state, return values, persisted data, emitted events
**Bad:** Check that internal method A called internal method B with args C

## Scope

### Priority 1: orchestrator.test.ts (54 bad assertions)

The orchestrator test is the worst offender. Common patterns to fix:

**A. Replace private method spies with state checks (~20 assertions)**
```typescript
// BAD: Spy on private cleanup
const spy = vi.spyOn(harness, "_cleanupEnvironmentRuntime");
manager.stop("thread-1");
expect(spy).toHaveBeenCalledWith("thread-1");

// GOOD: Check the outcome
manager.stop("thread-1");
expect(manager.getEnvironmentRuntime("thread-1")).toBeUndefined();
expect(threadRepo.getById("thread-1")?.status).toBe("idle");
```

**B. Replace callback count checks with outcome verification (~15 assertions)**
```typescript
// BAD: Check cleanup callback was called
expect(cleanup).toHaveBeenCalledTimes(1);
expect(stopWatchingWorkspaceStatus).toHaveBeenCalledTimes(1);

// GOOD: Check environment is detached
expect(service.getEnvironmentRuntime("thread-1")).toBeUndefined();
```

**C. Replace systemTell spy with event persistence checks (~10 assertions)**
```typescript
// BAD: Assert exact notification text
expect(systemTellSpy).toHaveBeenCalledWith("thread-manager-1", {
  input: [{ type: "text", text: "[bb system]: The following thread..." }]
});

// GOOD: Verify notification event was persisted
const events = eventRepo.listByThread("thread-manager-1");
expect(events).toContainEqual(
  expect.objectContaining({ type: "system/notification" })
);
```

**D. Replace threadRepo.create assertion with return value check (~5 assertions)**
```typescript
// BAD: Assert mock was called
expect(threadRepo.create).toHaveBeenCalledWith({ projectId: "proj-1", ... });

// GOOD: Assert the returned thread
const result = await manager.spawn({ projectId: "proj-1" });
expect(result.projectId).toBe("proj-1");
expect(result.status).toBeDefined();
```

### Priority 2: environment-service.test.ts (8 bad assertions)

**Move to real in-memory DB instead of mocked repos.** The service test currently uses hand-rolled mock repos with `vi.fn()`. Since all operations are synchronous SQLite, using a real in-memory DB would:
- Catch FK constraint violations (we just had this issue)
- Remove the need for mock state tracking
- Make assertions about actual persisted state instead of mock call args

**Pattern:**
```typescript
// INSTEAD OF:
const threadRepo = { getById: vi.fn(), update: vi.fn(), ... };
// ... later:
expect(threadRepo.update).toHaveBeenCalledWith("thread-1", { status: "idle" });

// USE:
const db = createConnection(":memory:");
migrate(db);
const threadRepo = new ThreadRepository(db);
// ... later:
expect(threadRepo.getById("thread-1")?.status).toBe("idle");
```

### Priority 3: routes/threads.test.ts (9 bad assertions)

Route tests should ONLY assert on:
- HTTP status codes
- Response body content
- Response headers

They should NOT assert on which internal orchestrator methods were called.

```typescript
// BAD: Checking internal method
expect(threadManager.resolveThreadOpenPath).toHaveBeenCalledWith("thread-1", "src/file.ts");

// GOOD: Check response
expect(res.status).toBe(200);
const body = await res.json();
expect(body.path).toBe("/workspace/src/file.ts");
```

### Priority 4: environment-agent-orchestrator.test.ts (5 bad assertions)

Replace call-count checks on retry logic with outcome verification.

```typescript
// BAD: Assert retry count
expect(ensureRuntime).toHaveBeenCalledTimes(2);
expect(suspendAndWait).toHaveBeenCalledWith("thread-1");

// GOOD: Assert the retry succeeded
expect(result.target.baseUrl).toBeDefined();
expect(result.projectRootPath).toBe("/test");
```

## Approach

### Phase 1: Establish patterns (1 commit)
- Convert the orchestrator.test.ts `createMocks()` to use real in-memory DB for thread/event/project repos
- Fix the first 5-10 assertions as examples of each pattern
- Document the mocking principles in AGENTS.md

### Phase 2: Orchestrator bulk fix (2-3 commits)
- Work through the remaining ~44 bad assertions in orchestrator.test.ts
- Group by pattern (private spies, callback counts, systemTell, etc.)

### Phase 3: Other files (1-2 commits)
- environment-service.test.ts: move to real DB
- routes/threads.test.ts: remove internal method assertions
- env-agent-orchestrator.test.ts: fix retry count checks

## Validation

- All existing tests must still pass (behavior preserved, only assertion style changes)
- `pnpm vitest run` — full unit suite green
- `pnpm test:e2e:qa:smoke` — e2e smoke green
- No new mocks introduced for DB operations
