import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConnection, migrate, EnvironmentRepository, ProjectRepository, ThreadEnvironmentAttachmentRepository, ThreadRepository, type DbConnection } from "@bb/db";
import {
  ensureDockerEnvironmentArtifacts,
  ensureLocalGitWorkspace,
  removeDockerEnvironmentArtifacts,
  removeLocalGitWorkspace,
  resolveDockerEnvironmentState,
  resolveLocalGitWorkspaceState,
} from "@bb/environment";
import { EnvironmentFactory } from "../env-factory.js";

vi.mock("@bb/environment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bb/environment")>();
  return {
    ...actual,
    ensureLocalGitWorkspace: vi.fn(actual.ensureLocalGitWorkspace),
    removeLocalGitWorkspace: vi.fn(actual.removeLocalGitWorkspace),
    ensureDockerEnvironmentArtifacts: vi.fn(actual.ensureDockerEnvironmentArtifacts),
    removeDockerEnvironmentArtifacts: vi.fn(actual.removeDockerEnvironmentArtifacts),
    resolveLocalGitWorkspaceState: vi.fn(actual.resolveLocalGitWorkspaceState),
    resolveDockerEnvironmentState: vi.fn(actual.resolveDockerEnvironmentState),
  };
});

interface SqliteClient {
  close(): void;
}

function sqliteClient(db: DbConnection): SqliteClient {
  return (db as unknown as { $client: SqliteClient }).$client;
}

describe("EnvironmentFactory", () => {
  let db: DbConnection;
  let sqlite: SqliteClient;
  let projects: ProjectRepository;
  let threads: ThreadRepository;
  let environments: EnvironmentRepository;
  let attachments: ThreadEnvironmentAttachmentRepository;

  beforeEach(() => {
    db = createConnection(":memory:");
    migrate(db);
    sqlite = sqliteClient(db);
    projects = new ProjectRepository(db);
    threads = new ThreadRepository(db);
    environments = new EnvironmentRepository(db);
    attachments = new ThreadEnvironmentAttachmentRepository(db);
  });

  afterEach(() => {
    sqlite.close();
    vi.clearAllMocks();
  });

  it("stores authoritative properties when reserving a managed environment", () => {
    const project = projects.create({
      name: "factory-project",
      rootPath: "/tmp/factory-project",
    });
    const thread = threads.create({ projectId: project.id });
    const factory = new EnvironmentFactory(environments, attachments);

    const environmentId = factory.reserveThreadEnvironment({
      threadId: thread.id,
      projectId: project.id,
      projectRootPath: project.rootPath,
      environmentCreationArgs: {
        kind: "docker",
      },
    });

    expect(environmentId).toBeDefined();
    expect(environmentId && environments.getById(environmentId)).toMatchObject({
      projectId: project.id,
      managed: true,
      properties: {
        provisioningSystemKind: "docker-worktree",
        location: "docker",
        workspaceKind: "arbitrary_path",
      },
    });
    expect(environmentId && environments.getById(environmentId)?.descriptor).toBeUndefined();
  });

  it("creates a thread_environment_attachment row when reserving", () => {
    const project = projects.create({
      name: "factory-attach-project",
      rootPath: "/tmp/factory-attach-project",
    });
    const thread = threads.create({ projectId: project.id });
    const factory = new EnvironmentFactory(environments, attachments);

    const environmentId = factory.reserveThreadEnvironment({
      threadId: thread.id,
      projectId: project.id,
      projectRootPath: project.rootPath,
      environmentCreationArgs: {
        kind: "worktree",
      },
    });

    expect(environmentId).toBeDefined();
    const attachment = attachments.getByThreadId(thread.id);
    expect(attachment).toMatchObject({
      threadId: thread.id,
      environmentId,
    });
  });

  it("creates a distinct managed environment for each reservation request", () => {
    const project = projects.create({
      name: "factory-shared-project",
      rootPath: "/tmp/factory-shared-project",
    });
    const thread1 = threads.create({ projectId: project.id });
    const thread2 = threads.create({ projectId: project.id });
    const factory = new EnvironmentFactory(environments, attachments);

    const envId1 = factory.reserveThreadEnvironment({
      threadId: thread1.id,
      projectId: project.id,
      projectRootPath: project.rootPath,
      environmentCreationArgs: {
        kind: "worktree",
      },
    });

    const envId2 = factory.reserveThreadEnvironment({
      threadId: thread2.id,
      projectId: project.id,
      projectRootPath: project.rootPath,
      environmentCreationArgs: {
        kind: "worktree",
      },
    });

    expect(envId1).toBeDefined();
    expect(envId2).toBeDefined();
    expect(envId1).not.toBe(envId2);
    expect(attachments.getByThreadId(thread1.id)).toMatchObject({
      threadId: thread1.id,
      environmentId: envId1,
    });
    expect(attachments.getByThreadId(thread2.id)).toMatchObject({
      threadId: thread2.id,
      environmentId: envId2,
    });
  });

  it("materializes managed worktree artifacts by environmentId", async () => {
    vi.mocked(resolveLocalGitWorkspaceState).mockReturnValue({
      workspaceRoot: "/tmp/factory-project/.worktrees/env-1",
      branchName: "bb/env-env-1",
    });
    vi.mocked(ensureLocalGitWorkspace).mockResolvedValue(true);

    const project = projects.create({
      name: "factory-managed-worktree-project",
      rootPath: "/tmp/factory-project",
    });
    const env = environments.create({
      projectId: project.id,
      managed: true,
      properties: {
        provisioningSystemKind: "worktree",
        location: "localhost",
        workspaceKind: "worktree",
      },
    });
    const factory = new EnvironmentFactory(environments, attachments);

    const result = await factory.ensureManagedEnvironmentArtifacts({
      environmentId: env.id,
      projectRootPath: project.rootPath,
      runtimeEnv: {},
    });

    expect(result).toEqual({ created: true });
    expect(resolveLocalGitWorkspaceState).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: project.id,
        environmentId: env.id,
      }),
    );
    expect(ensureLocalGitWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        state: {
          workspaceRoot: "/tmp/factory-project/.worktrees/env-1",
          branchName: "bb/env-env-1",
        },
      }),
    );
  });

  it("cleans up managed docker artifacts by environmentId", async () => {
    vi.mocked(removeDockerEnvironmentArtifacts).mockResolvedValue(undefined);
    vi.mocked(removeLocalGitWorkspace).mockResolvedValue(undefined);

    const project = projects.create({
      name: "factory-managed-docker-project",
      rootPath: "/tmp/factory-project",
    });
    const env = environments.create({
      projectId: project.id,
      managed: true,
      properties: {
        provisioningSystemKind: "docker-worktree",
        location: "docker",
        workspaceKind: "arbitrary_path",
      },
      runtimeState: {
        kind: "docker",
        state: {
          worktree: {
            workspaceRoot: "/tmp/factory-project/.worktrees/env-1",
            branchName: "bb/env-env-1",
          },
          containerName: "bb-env-1",
          image: "bb/environment:local",
          mountPath: "/workspace",
          agentHostPort: 4311,
          agentContainerPort: 4310,
        },
      },
    });
    const factory = new EnvironmentFactory(environments, attachments);

    await factory.cleanupManagedEnvironmentArtifacts({
      environmentId: env.id,
      projectRootPath: project.rootPath,
      runtimeEnv: {},
    });

    expect(removeDockerEnvironmentArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({
        state: expect.objectContaining({
          containerName: "bb-env-1",
        }),
      }),
    );
    expect(removeLocalGitWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceRoot: "/tmp/factory-project/.worktrees/env-1",
      }),
    );
  });
});
