/**
 * Provider contract integration tests.
 *
 * These tests validate that each provider adapter correctly implements the
 * ProviderAdapter contract by spawning real bridge processes and exchanging
 * JSON-RPC messages. Every provider runs the same test suite.
 *
 * All tests run concurrently — each test spawns its own bridge process
 * so there's no shared state.
 *
 * Requirements per provider:
 *   - codex: OPENAI_API_KEY or ~/.codex/auth.json
 *   - claude-code: ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN
 *   - pi: ~/.pi/agent/auth.json (run `pi login`)
 *
 * Run with: pnpm test:integration
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createCodexProviderAdapter } from "../../codex-provider-adapter.js";
import { createClaudeCodeProviderAdapter } from "../../claude-code-provider-adapter.js";
import { createPiProviderAdapter } from "../../pi-provider-adapter.js";
import { hasCodexAuth, readCodexAuthFile } from "../../codex-auth.js";
import { BridgeTestHarness, type CollectedTurn } from "./provider-bridge-harness.js";

// ---------------------------------------------------------------------------
// Provider configurations
// ---------------------------------------------------------------------------

const DIST = resolve(__dirname, "../../../dist/bridges");

interface ProviderTestConfig {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: any; // ProviderAdapter<any, any>
  processOverrides?: { processCommand: string; processArgs: string[] };
  launchEnv?: () => Promise<Record<string, string>> | Record<string, string>;
  checkAuth: () => Promise<boolean> | boolean;
  authInstructions: string;
}

function newThreadId(): string {
  return `thr_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Check if any notification in a turn has a given method. */
function hasMethod(turn: CollectedTurn, method: string): boolean {
  return turn.notifications.some((n) => n.method === method);
}

/** Find agent message text from item/completed notifications. */
function findAgentMessageText(turn: CollectedTurn): string {
  const texts: string[] = [];
  for (const n of turn.notifications) {
    if (n.method !== "item/completed") continue;
    const item = (n.params as Record<string, unknown> | undefined)?.item;
    if (item && typeof item === "object" && "type" in item) {
      const typed = item as { type: string; text?: string };
      if (typed.type === "agentMessage" && typed.text) {
        texts.push(typed.text);
      }
    }
  }
  return texts.join(" ");
}

const codexAdapter = createCodexProviderAdapter();
const claudeCodeAdapter = createClaudeCodeProviderAdapter();
const piAdapter = createPiProviderAdapter();

const providers: ProviderTestConfig[] = [
  {
    name: "codex",
    adapter: codexAdapter,
    checkAuth: async () => {
      if (process.env.OPENAI_API_KEY?.trim()) return true;
      return hasCodexAuth(await readCodexAuthFile());
    },
    launchEnv: async () => {
      const c = await codexAdapter.resolveLaunchConfiguration?.({ projectId: "integration-test", threadId: "test" });
      return c?.env ?? {};
    },
    authInstructions: "Set OPENAI_API_KEY or run `codex login`",
  },
  {
    name: "claude-code",
    adapter: claudeCodeAdapter,
    processOverrides: {
      processCommand: "node",
      processArgs: [resolve(DIST, "claude-code", "bridge.js")],
    },
    checkAuth: () =>
      !!(
        process.env.ANTHROPIC_API_KEY?.trim() ||
        process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()
      ),
    launchEnv: async () => {
      const c = await claudeCodeAdapter.resolveLaunchConfiguration?.({ projectId: "integration-test", threadId: "test" });
      return c?.env ?? {};
    },
    authInstructions: "Set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN",
  },
  {
    name: "pi",
    adapter: piAdapter,
    processOverrides: {
      processCommand: "node",
      processArgs: [resolve(DIST, "pi", "bridge.js")],
    },
    checkAuth: () =>
      existsSync(resolve(homedir(), ".pi", "agent", "auth.json")),
    launchEnv: async () => {
      const c = await piAdapter.resolveLaunchConfiguration?.({ projectId: "integration-test", threadId: "test" });
      return c?.env ?? {};
    },
    authInstructions: "Run `pi -> /login` to configure ~/.pi/agent/auth.json",
  },
];

// ---------------------------------------------------------------------------
// Helper: run a test with its own bridge harness
// ---------------------------------------------------------------------------

async function withHarness(
  provider: ProviderTestConfig,
  fn: (harness: BridgeTestHarness) => Promise<void>,
): Promise<void> {
  const hasAuth = await provider.checkAuth();
  if (!hasAuth) {
    throw new Error(
      `${provider.name} requires authentication. ${provider.authInstructions}`,
    );
  }
  const launchEnv = await provider.launchEnv?.() ?? {};
  const translateEvent = provider.adapter.translateEvent
    ? (msg: unknown) => provider.adapter.translateEvent(msg)
    : undefined;
  const harness = new BridgeTestHarness(
    provider.adapter.process,
    { env: launchEnv },
    provider.processOverrides,
    translateEvent,
  );
  try {
    await harness.start();
    await harness.sendRequest(provider.adapter.buildCommand({
      type: "initialize",
      clientInfo: { name: "bb", version: "0.0.1" },
    }));
    await fn(harness);
  } finally {
    await harness.stop();
  }
}

// ---------------------------------------------------------------------------
// Command builders — use adapter.buildCommand with ProviderRequest
// ---------------------------------------------------------------------------

function threadStartCmd(provider: ProviderTestConfig, threadId: string, opts?: {
  developerInstructions?: string;
  dynamicTools?: Array<{ name: string; description: string; inputSchema: unknown }>;
}) {
  const cmd = provider.adapter.buildCommand({
    type: "thread/start",
    threadId,
    req: {
      projectId: "integration-test",
      input: [{ type: "text", text: "Start" }],
      sandboxMode: "danger-full-access",
      ...opts,
    },
    context: { projectId: "integration-test", threadId },
    dynamicTools: opts?.dynamicTools,
  });
  if (!cmd) throw new Error("buildCommand returned null for thread/start");
  return cmd;
}

function turnStartCmd(provider: ProviderTestConfig, threadId: string, providerThreadId: string | undefined, text: string) {
  const cmd = provider.adapter.buildCommand({
    type: "turn/start",
    threadId,
    providerThreadId,
    input: [{ type: "text", text }],
  });
  if (!cmd) throw new Error("buildCommand returned null for turn/start");
  return cmd;
}

function threadResumeCmd(provider: ProviderTestConfig, threadId: string, providerThreadId: string | undefined) {
  const cmd = provider.adapter.buildCommand({
    type: "thread/resume",
    threadId,
    providerThreadId,
    context: { projectId: "integration-test", threadId },
  });
  if (!cmd) throw new Error("buildCommand returned null for thread/resume");
  return cmd;
}

// ---------------------------------------------------------------------------
// Tests — all concurrent, each with its own harness
// ---------------------------------------------------------------------------

for (const provider of providers) {
  describe.concurrent(`${provider.name} provider contract`, () => {
    it("lists models", async () => {
      const hasAuth = await provider.checkAuth();
      if (!hasAuth) throw new Error(provider.authInstructions);

      const models = await provider.adapter.listModels();
      expect(models.length).toBeGreaterThan(0);
      for (const model of models) {
        expect(model.id).toBeTruthy();
        expect(model.model).toBeTruthy();
        expect(model.displayName).toBeTruthy();
        expect(model.supportedReasoningEfforts.length).toBeGreaterThan(0);
      }
      expect(models.some((m: { isDefault: boolean }) => m.isDefault)).toBe(true);
    });

    it("preflight check passes", async () => {
      const hasAuth = await provider.checkAuth();
      if (!hasAuth) throw new Error(provider.authInstructions);

      const error = await provider.adapter.preflightSessionStart?.();
      expect(error).toBeUndefined();
    });

    it("starts a thread and runs a single turn", async () => {
      await withHarness(provider, async (harness) => {
        const threadId = newThreadId();
        await harness.startThread(threadStartCmd(provider, threadId));

        const turn = await harness.runTurn(
          turnStartCmd(provider, threadId, harness.getProviderThreadId(), "Reply with exactly the word: PONG"),
        );

        expect(turn.ok).toBe(true);
        expect(hasMethod(turn, "turn/started")).toBe(true);
        expect(hasMethod(turn, "turn/completed")).toBe(true);
      });
    });

    it("handles a follow-up turn in the same session", async () => {
      await withHarness(provider, async (harness) => {
        const threadId = newThreadId();
        await harness.startThread(threadStartCmd(provider, threadId));
        const ptid = harness.getProviderThreadId();

        const turn1 = await harness.runTurn(turnStartCmd(provider, threadId, ptid, "Say ALPHA"));
        expect(turn1.ok).toBe(true);

        const turn2 = await harness.runTurn(turnStartCmd(provider, threadId, ptid, "Say BETA"));
        expect(turn2.ok).toBe(true);
        expect(hasMethod(turn2, "turn/completed")).toBe(true);
      });
    });

    it("respects developer instructions", async () => {
      await withHarness(provider, async (harness) => {
        const threadId = newThreadId();
        await harness.startThread(threadStartCmd(provider, threadId, {
          developerInstructions: "Always end every response with the exact string '[TEST_TAG]'.",
        }));

        const turn = await harness.runTurn(
          turnStartCmd(provider, threadId, harness.getProviderThreadId(), "Say hello in one short sentence."),
        );
        expect(turn.ok).toBe(true);

        const text = findAgentMessageText(turn);
        if (text) {
          expect(text).toContain("[TEST_TAG]");
        }
      });
    });

    it("recovers from a bad request", async () => {
      await withHarness(provider, async (harness) => {
        const threadId = newThreadId();
        await harness.startThread(threadStartCmd(provider, threadId));
        const ptid = harness.getProviderThreadId();

        // First turn succeeds
        const turn1 = await harness.runTurn(turnStartCmd(provider, threadId, ptid, "Say ALPHA"));
        expect(turn1.ok).toBe(true);

        // Bad request — nonexistent thread
        const badTurn = await harness.runTurn(turnStartCmd(provider, "nonexistent", "nonexistent", "Fail"));
        expect(badTurn.ok).toBe(false);

        // Recovery — bridge should still work
        const turn2 = await harness.runTurn(turnStartCmd(provider, threadId, ptid, "Say RECOVERED"));
        expect(turn2.ok).toBe(true);
        expect(hasMethod(turn2, "turn/completed")).toBe(true);
      });
    });

    it("handles dynamic tool calls", async () => {
      await withHarness(provider, async (harness) => {
        harness.onToolCall((msg) => {
          const params = msg.params as Record<string, unknown> | undefined;
          if (params?.tool === "bb_test_status") {
            return {
              contentItems: [{ type: "inputText", text: "STATUS: ALL_SYSTEMS_GREEN" }],
              success: true,
            };
          }
          return null;
        });

        const threadId = newThreadId();
        await harness.startThread(threadStartCmd(provider, threadId, {
          developerInstructions:
            "You have a tool called bb_test_status. When asked about status, " +
            "you MUST call bb_test_status. Report what it returns verbatim.",
          dynamicTools: [{
            name: "bb_test_status",
            description: "Returns system status. Always call this when asked about status.",
            inputSchema: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
            },
          }],
        }));

        const turn = await harness.runTurn(
          turnStartCmd(provider, threadId, harness.getProviderThreadId(), "What is the system status? Use the bb_test_status tool."),
        );
        expect(turn.ok).toBe(true);

        const text = findAgentMessageText(turn);
        expect(text).toContain("ALL_SYSTEMS_GREEN");
      });
    });

    it("resumes a thread across process lifetimes", async () => {
      const threadId = newThreadId();
      let providerThreadId: string | undefined;

      // First session: establish context
      await withHarness(provider, async (harness) => {
        await harness.startThread(threadStartCmd(provider, threadId));

        const turn = await harness.runTurn(
          turnStartCmd(provider, threadId, harness.getProviderThreadId(),
            "Remember the secret word: STRAWBERRY. Just confirm you'll remember it."),
        );
        expect(turn.ok).toBe(true);
        providerThreadId = harness.getProviderThreadId();
        expect(providerThreadId).toBeTruthy();
      });

      // Second session: resume and recall
      await withHarness(provider, async (harness) => {
        const resumeResponse = await harness.sendRequest(
          threadResumeCmd(provider, threadId, providerThreadId),
        );
        expect(resumeResponse.error).toBeUndefined();

        const turn = await harness.runTurn(
          turnStartCmd(provider, threadId, providerThreadId,
            "What was the secret word I asked you to remember? Reply with just the word."),
        );
        expect(turn.ok).toBe(true);

        const text = findAgentMessageText(turn);
        if (text) {
          expect(text.toUpperCase()).toContain("STRAWBERRY");
        }
      });
    });
  });
}
