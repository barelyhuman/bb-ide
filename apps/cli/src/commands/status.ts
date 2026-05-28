import { Command } from "commander";
import type { Thread, ThreadTimelinePendingTodos } from "@bb/domain";
import type { ProjectResponse } from "@bb/server-contract";
import { action } from "../action.js";
import {
  resolveContextSnapshot,
  type ContextSnapshot,
} from "../context-env.js";
import { type Client, createClient, unwrap } from "../client.js";
import { outputJson } from "./helpers.js";
import {
  type ThreadEnvironmentInfo,
  fetchEnvironmentInfo,
  printEnvironmentInfo,
} from "./environment-helpers.js";
import {
  fetchThreadPendingTodos,
  printPendingTodos,
} from "./thread/pending-todos.js";

interface StatusPayload {
  project: { id: string; name: string } | null;
  thread: {
    id: string;
    type: string;
    status: string;
    title: string | null;
    pinnedAt: number | null;
    parentThreadId: string | null;
    environment: ThreadEnvironmentInfo | null;
  } | null;
  managedThreads: Array<{
    id: string;
    status: string;
    title: string | null;
  }> | null;
  pendingTodos: ThreadTimelinePendingTodos | null;
}

interface StatusCommandOptions {
  json?: boolean;
}

type ResolveServerUrl = () => string;
type ResolveStatusContext = () => ContextSnapshot;

async function fetchSilent<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

function fetchProject(args: {
  client: Client;
  projectId: string;
}): Promise<ProjectResponse | null> {
  return fetchSilent(() =>
    unwrap<ProjectResponse>(
      args.client.api.v1.projects[":id"].$get({
        param: { id: args.projectId },
      }),
    ),
  );
}

function fetchThread(args: {
  client: Client;
  threadId: string;
}): Promise<Thread | null> {
  return fetchSilent(() =>
    unwrap<Thread>(
      args.client.api.v1.threads[":id"].$get({
        param: { id: args.threadId },
      }),
    ),
  );
}

function fetchManagedThreads(args: {
  client: Client;
  projectId: string;
  parentThreadId: string;
}): Promise<Thread[] | null> {
  return fetchSilent(() =>
    unwrap<Thread[]>(
      args.client.api.v1.threads.$get({
        query: {
          projectId: args.projectId,
          parentThreadId: args.parentThreadId,
        },
      }),
    ),
  );
}

export function registerStatusCommand(
  program: Command,
  getUrl: ResolveServerUrl,
  getContext: ResolveStatusContext = resolveContextSnapshot,
): void {
  program
    .command("status")
    .description("Show current context")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: StatusCommandOptions) => {
        const context = getContext();

        const payload: StatusPayload = {
          project: null,
          thread: null,
          managedThreads: null,
          pendingTodos: null,
        };

        let serverAvailable = false;

        // Try to fetch enriched data from the server
        if (context.projectId || context.threadId) {
          const client = createClient(getUrl());

          const [projectResult, threadResult] = await Promise.all([
            context.projectId
              ? fetchProject({ client, projectId: context.projectId })
              : Promise.resolve(null),
            context.threadId
              ? fetchThread({ client, threadId: context.threadId })
              : Promise.resolve(null),
          ]);

          if (projectResult) {
            payload.project = {
              id: projectResult.id,
              name: projectResult.name,
            };
            serverAvailable = true;
          }

          if (threadResult) {
            let environmentInfo: ThreadEnvironmentInfo | null = null;
            if (threadResult.environmentId) {
              environmentInfo = await fetchEnvironmentInfo({
                client,
                environmentId: threadResult.environmentId,
              });
            }

            payload.pendingTodos = await fetchThreadPendingTodos({
              client,
              threadId: threadResult.id,
            });

            payload.thread = {
              id: threadResult.id,
              type: threadResult.type,
              status: threadResult.status,
              title: threadResult.title ?? null,
              pinnedAt: threadResult.pinnedAt,
              parentThreadId: threadResult.parentThreadId ?? null,
              environment: environmentInfo,
            };
            serverAvailable = true;

            // If the thread is a manager, fetch managed (child) threads
            if (threadResult.type === "manager") {
              const managed = await fetchManagedThreads({
                client,
                projectId: threadResult.projectId,
                parentThreadId: threadResult.id,
              });
              if (managed) {
                payload.managedThreads = managed.map((t) => ({
                  id: t.id,
                  status: t.status,
                  title: t.title ?? null,
                }));
              }
            }
          }
        }

        // JSON output
        if (outputJson(opts, payload)) return;

        // Human-readable output
        if (serverAvailable && payload.project) {
          console.log(
            `Project: ${payload.project.name} (${payload.project.id})`,
          );
        } else if (context.projectId) {
          console.log(`Project: ${context.projectId}`);
        } else {
          console.log("Project: (not set)");
        }

        console.log("");

        if (serverAvailable && payload.thread) {
          console.log(`Thread: ${payload.thread.id}`);
          console.log(`  Type: ${payload.thread.type}`);
          console.log(`  Status: ${payload.thread.status}`);
          if (payload.thread.title) {
            console.log(`  Title: ${payload.thread.title}`);
          }
          if (payload.thread.pinnedAt !== null) {
            console.log(
              `  Pinned: ${new Date(payload.thread.pinnedAt).toLocaleString()}`,
            );
          }
          if (payload.thread.parentThreadId) {
            console.log(`  Parent: ${payload.thread.parentThreadId}`);
          }
          if (payload.thread.environment) {
            printEnvironmentInfo(payload.thread.environment);
          }

          if (payload.managedThreads && payload.managedThreads.length > 0) {
            console.log("");
            console.log(`Managed threads: ${payload.managedThreads.length}`);
            for (const mt of payload.managedThreads) {
              const title = mt.title ? `"${mt.title}"` : "";
              console.log(`  ${mt.id}  ${mt.status}  ${title}`);
            }
          }

          printPendingTodos(payload.pendingTodos);
        } else if (context.threadId) {
          console.log(`Thread: ${context.threadId}`);
        } else {
          console.log("Thread: (not set)");
        }

        if (!context.projectId && !context.threadId) {
          console.log("");
          console.log("Tip: run bb guide for help getting started.");
        }
      }),
    );
}
