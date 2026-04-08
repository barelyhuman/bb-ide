import { describe, expect, it } from "vitest";
import { createConnection } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import { deleteProject, createProject } from "../../src/data/projects.js";
import {
  getProjectExecutionDefaults,
  upsertProjectExecutionDefaults,
} from "../../src/data/project-execution-defaults.js";
import { upsertHost } from "../../src/data/hosts.js";

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, {
    name: "defaults-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "defaults-project",
    source: {
      type: "local_path",
      hostId: host.id,
      path: "/tmp/defaults-project",
    },
  });
  return { db, project };
}

describe("project-execution-defaults", () => {
  it("returns null when a project has no stored defaults for a provider", () => {
    const { db, project } = setup();

    expect(
      getProjectExecutionDefaults(db, {
        projectId: project.id,
        providerId: "codex",
      }),
    ).toBeNull();
  });

  it("upserts provider-scoped execution defaults", () => {
    const { db, project } = setup();

    upsertProjectExecutionDefaults(db, {
      projectId: project.id,
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: "medium",
      sandboxMode: "danger-full-access",
      serviceTier: "default",
      source: "client/thread/start",
    });

    expect(
      getProjectExecutionDefaults(db, {
        projectId: project.id,
        providerId: "codex",
      }),
    ).toEqual({
      model: "gpt-5",
      reasoningLevel: "medium",
      sandboxMode: "danger-full-access",
      serviceTier: "default",
      source: "client/thread/start",
    });
  });

  it("replaces the previous defaults for the same project and provider", () => {
    const { db, project } = setup();

    upsertProjectExecutionDefaults(db, {
      projectId: project.id,
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: "medium",
      sandboxMode: "danger-full-access",
      serviceTier: "default",
      source: "client/thread/start",
    });
    upsertProjectExecutionDefaults(db, {
      projectId: project.id,
      providerId: "codex",
      model: "gpt-5-mini",
      reasoningLevel: "high",
      sandboxMode: "workspace-write",
      serviceTier: "fast",
      source: "client/turn/requested",
    });

    expect(
      getProjectExecutionDefaults(db, {
        projectId: project.id,
        providerId: "codex",
      }),
    ).toEqual({
      model: "gpt-5-mini",
      reasoningLevel: "high",
      sandboxMode: "workspace-write",
      serviceTier: "fast",
      source: "client/turn/requested",
    });
  });

  it("keeps defaults isolated by provider", () => {
    const { db, project } = setup();

    upsertProjectExecutionDefaults(db, {
      projectId: project.id,
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: "medium",
      sandboxMode: "danger-full-access",
      serviceTier: "default",
      source: "client/thread/start",
    });
    upsertProjectExecutionDefaults(db, {
      projectId: project.id,
      providerId: "claude-code",
      model: "claude-opus-4-1",
      reasoningLevel: "high",
      sandboxMode: "workspace-write",
      serviceTier: "fast",
      source: "client/turn/requested",
    });

    expect(
      getProjectExecutionDefaults(db, {
        projectId: project.id,
        providerId: "codex",
      }),
    ).toMatchObject({
      model: "gpt-5",
      source: "client/thread/start",
    });
    expect(
      getProjectExecutionDefaults(db, {
        projectId: project.id,
        providerId: "claude-code",
      }),
    ).toMatchObject({
      model: "claude-opus-4-1",
      source: "client/turn/requested",
    });
  });

  it("deletes defaults when the project is deleted", () => {
    const { db, project } = setup();

    upsertProjectExecutionDefaults(db, {
      projectId: project.id,
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: "medium",
      sandboxMode: "danger-full-access",
      serviceTier: "default",
      source: "client/thread/start",
    });

    expect(deleteProject(db, noopNotifier, project.id)).toBe(true);
    expect(
      getProjectExecutionDefaults(db, {
        projectId: project.id,
        providerId: "codex",
      }),
    ).toBeNull();
  });
});
