import { Command } from "commander";
import type {
  CommitActionResponse,
  SquashMergeActionResponse,
} from "@bb/server-contract";
import type { Thread } from "@bb/domain";
import { createClient, unwrap } from "../client.js";
import { requireProjectId, resolveThreadId } from "../context-env.js";
import {
  getErrorMessage,
  outputJson,
  printEnvironmentGitOperationResult,
  resolveThreadIdOrSelf,
} from "./helpers.js";

export function registerEnvironmentCommands(
  program: Command,
  getUrl: () => string,
): void {
  const environment = program
    .command("environment")
    .description("Inspect and operate on first-class environments");

  environment
    .command("commit <id>")
    .description("Commit changes in an environment")
    .option("--thread <thread-id>", "Initiating thread ID")
    .option("--self", "Use BB_THREAD_ID as the initiating thread")
    .option("--message <message>", "Commit message hint")
    .option("--staged-only", "Commit only currently staged changes")
    .option("--json", "Print machine-readable JSON output")
    .action(async (
      id: string,
      opts: {
        thread?: string;
        self?: boolean;
        message?: string;
        stagedOnly?: boolean;
        json?: boolean;
      },
    ) => {
      const client = createClient(getUrl());
      try {
        const initiatingThreadId = resolveThreadIdOrSelf(opts.thread, opts);
        const result = await unwrap<CommitActionResponse>(
          client.api.v1.environments[":id"].actions.$post({
            param: { id },
            json: {
              action: "commit",
              initiatingThreadId,
              options: {
                includeUnstaged: opts.stagedOnly ? false : true,
                ...(opts.message ? { message: opts.message } : {}),
              },
            },
          }),
        );
        if (outputJson(opts, result)) return;
        printEnvironmentGitOperationResult(result);
      } catch (err: unknown) {
        console.error(`Error: ${getErrorMessage(err)}`);
        process.exit(1);
      }
    });

  environment
    .command("squash-merge <id>")
    .description("Squash-merge changes in an environment")
    .option("--thread <thread-id>", "Initiating thread ID")
    .option("--self", "Use BB_THREAD_ID as the initiating thread")
    .option("--commit-if-needed", "Allow a prep commit before squash merge")
    .option("--staged-only", "Use only staged changes for the prep commit")
    .option("--commit-message <message>", "Prep commit message hint")
    .option("--squash-message <message>", "Squash commit message hint")
    .option("--merge-base-branch <branch>", "Merge-base branch hint")
    .option("--json", "Print machine-readable JSON output")
    .action(async (
      id: string,
      opts: {
        thread?: string;
        self?: boolean;
        commitIfNeeded?: boolean;
        stagedOnly?: boolean;
        commitMessage?: string;
        squashMessage?: string;
        mergeBaseBranch?: string;
        json?: boolean;
      },
    ) => {
      const client = createClient(getUrl());
      try {
        const initiatingThreadId = resolveThreadIdOrSelf(opts.thread, opts);
        const result = await unwrap<SquashMergeActionResponse>(
          client.api.v1.environments[":id"].actions.$post({
            param: { id },
            json: {
              action: "squash_merge",
              initiatingThreadId,
              options: {
                commitIfNeeded: opts.commitIfNeeded === true,
                includeUnstaged: opts.stagedOnly ? false : true,
                ...(opts.commitMessage ? { commitMessage: opts.commitMessage } : {}),
                ...(opts.squashMessage ? { squashMessage: opts.squashMessage } : {}),
                ...(opts.mergeBaseBranch ? { mergeBaseBranch: opts.mergeBaseBranch } : {}),
              },
            },
          }),
        );
        if (outputJson(opts, result)) return;
        printEnvironmentGitOperationResult(result);
      } catch (err: unknown) {
        console.error(`Error: ${getErrorMessage(err)}`);
        process.exit(1);
      }
    });

  environment
    .command("promote <id>")
    .description("Promote an environment into the primary checkout")
    .option("--thread <id>", "Thread ID attached to the environment (defaults to BB_THREAD_ID)")
    .option("--json", "Print machine-readable JSON output")
    .action(async (id: string, opts: { thread?: string; json?: boolean }) => {
      const client = createClient(getUrl());
      try {
        const threadId = opts.thread ?? resolveThreadId();
        if (!threadId) {
          throw new Error("A thread id is required. Pass --thread or set BB_THREAD_ID.");
        }
        const result = await unwrap<{ ok: true; action: "promote"; message: string }>(
          client.api.v1.environments[":id"].actions.$post({
            param: { id },
            json: { action: "promote", initiatingThreadId: threadId },
          }),
        );
        if (outputJson(opts, result)) return;
        console.log(result.message);
      } catch (err: unknown) {
        console.error(`Error: ${getErrorMessage(err)}`);
        process.exit(1);
      }
    });

  environment
    .command("demote [id]")
    .description("Demote the currently promoted primary-checkout environment")
    .option("--project <id>", "Project ID (defaults to BB_PROJECT_ID when id is omitted)")
    .option("--thread <id>", "Thread ID attached to the environment (defaults to BB_THREAD_ID)")
    .option("--json", "Print machine-readable JSON output")
    .action(async (id: string | undefined, opts: { project?: string; thread?: string; json?: boolean }) => {
      const client = createClient(getUrl());
      try {
        const explicitThreadId = opts.thread ?? resolveThreadId();
        const resolution = (() => {
          if (id && explicitThreadId) {
            return Promise.resolve({ environmentId: id, threadId: explicitThreadId });
          }
          if (id && !explicitThreadId) {
            throw new Error("A thread id is required to demote an environment. Pass --thread or set BB_THREAD_ID.");
          }
          const threadIdFromContext = explicitThreadId;
          if (threadIdFromContext) {
            return unwrap<Thread>(
              client.api.v1.threads[":id"].$get({ param: { id: threadIdFromContext } }),
            ).then((thread) => {
              if (!thread.environmentId) {
                throw new Error(`Thread ${thread.id} has no attached environment.`);
              }
              return {
                environmentId: thread.environmentId,
                threadId: thread.id,
              };
            });
          }
          requireProjectId(opts.project); // validate project exists
          // TODO: Thread no longer has primaryCheckout — need a different API
          // to find the currently promoted environment. See phase-2a-findings.md.
          throw new Error(
            "Demoting by project requires a thread ID or environment ID. " +
            "Pass --thread or set BB_THREAD_ID, or provide the environment ID directly.",
          );
        })();

        const resolved = await resolution;
        const result = await unwrap<{ ok: true; action: "demote"; message: string }>(
          client.api.v1.environments[":id"].actions.$post({
            param: { id: resolved.environmentId },
            json: {
              action: "demote",
              initiatingThreadId: resolved.threadId,
            },
          }),
        );
        if (outputJson(opts, result)) return;
        console.log(result.message);
      } catch (err: unknown) {
        console.error(`Error: ${getErrorMessage(err)}`);
        process.exit(1);
      }
    });

  environment
    .command("promote-status")
    .description("Show which environment is active in the primary checkout")
    .option("--project <id>", "Project ID (defaults to BB_PROJECT_ID)")
    .option("--json", "Print machine-readable JSON output")
    .action(async (_opts: { project?: string; json?: boolean }) => {
      try {
        // TODO: Thread no longer has primaryCheckout — need /environments/:id/primary-status
        // or similar route. See phase-2a-findings.md.
        console.error("Error: promote-status is not available (primaryCheckout not in Thread type)");
        process.exit(1);
      } catch (err: unknown) {
        console.error(`Error: ${getErrorMessage(err)}`);
        process.exit(1);
      }
    });
}
