import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DbConnection } from "@beanbag/db";
import {
  createConnection,
  migrate,
  EnvironmentAgentCommandRepository,
  EnvironmentAgentSessionRepository,
  ProjectRepository,
  ThreadRepository,
} from "@beanbag/db";
import { EnvironmentAgentCommandDispatcher } from "../environment-agent-command-dispatcher.js";
import { EnvironmentAgentSessionCommandClient } from "../environment-agent-session-command-client.js";

interface SqliteClient { close(): void; }
function sqliteClient(db: DbConnection): SqliteClient {
  return (db as unknown as { $client: SqliteClient }).$client;
}

describe("EnvironmentAgentSessionCommandClient", () => {
  let db: DbConnection;
  let sqlite: SqliteClient;
  let projects: ProjectRepository;
  let threads: ThreadRepository;
  let sessions: EnvironmentAgentSessionRepository;
  let commands: EnvironmentAgentCommandRepository;
  let dispatcher: EnvironmentAgentCommandDispatcher;

  beforeEach(() => {
    db = createConnection(":memory:");
    migrate(db);
    sqlite = sqliteClient(db);
    projects = new ProjectRepository(db);
    threads = new ThreadRepository(db);
    sessions = new EnvironmentAgentSessionRepository(db);
    commands = new EnvironmentAgentCommandRepository(db);
    dispatcher = new EnvironmentAgentCommandDispatcher(sessions, commands);
  });

  afterEach(() => {
    sqlite.close();
  });

  function createThreadId(): string {
    const project = projects.create({
      name: "session-command-client-project",
      rootPath: "/tmp/session-command-client-project",
    });
    return threads.create({ projectId: project.id }).id;
  }

  it("enqueues commands onto the active session and waits for completion", async () => {
    const threadId = createThreadId();
    const session = sessions.create({
      id: "sess-1",
      threadId,
      agentId: "agent-1",
      agentInstanceId: "instance-1",
      protocolVersion: 1,
      transportKind: "http-long-poll",
      leaseExpiresAt: 30_000,
      now: 1_000,
    });
    const client = new EnvironmentAgentSessionCommandClient({
      threadId,
      commandDispatcher: dispatcher,
      commandTimeoutMs: 1_000,
      pollIntervalMs: 10,
    });

    setTimeout(() => {
      const queued = commands.getById("cmd-1");
      if (!queued) return;
      commands.markStarted("cmd-1", 1_100);
      commands.markCompleted({
        commandId: "cmd-1",
        result: { providerThreadId: "provider-1" },
        now: 1_200,
      });
    }, 20);

    await expect(
      client.sendCommand({
        meta: {
          protocolVersion: 1,
          commandId: "cmd-1",
          idempotencyKey: "cmd-1",
          sentAt: 1_050,
        },
        command: {
          type: "thread.start",
          threadId,
          projectId: "project-1",
          params: { prompt: "hello" },
        },
      }),
    ).resolves.toMatchObject({
      state: "accepted",
      result: { providerThreadId: "provider-1" },
    });

    expect(commands.getById("cmd-1")).toMatchObject({
      sessionId: session.id,
      state: "completed",
    });
  });

  it("surfaces failed queued commands as rejected command acks", async () => {
    const threadId = createThreadId();
    sessions.create({
      id: "sess-2",
      threadId,
      agentId: "agent-1",
      agentInstanceId: "instance-2",
      protocolVersion: 1,
      transportKind: "http-long-poll",
      leaseExpiresAt: 30_000,
      now: 1_000,
    });
    const client = new EnvironmentAgentSessionCommandClient({
      threadId,
      commandDispatcher: dispatcher,
      commandTimeoutMs: 1_000,
      pollIntervalMs: 10,
    });

    setTimeout(() => {
      commands.markFailed({
        commandId: "cmd-2",
        errorCode: "provider_unavailable",
        errorMessage: "provider down",
        now: 1_200,
      });
    }, 20);

    await expect(
      client.sendCommand({
        meta: {
          protocolVersion: 1,
          commandId: "cmd-2",
          idempotencyKey: "cmd-2",
          sentAt: 1_050,
        },
        command: {
          type: "workspace.status",
          threadId,
        },
      }),
    ).resolves.toMatchObject({
      state: "rejected",
      errorCode: "provider_unavailable",
      message: "provider down",
    });
  });
});
