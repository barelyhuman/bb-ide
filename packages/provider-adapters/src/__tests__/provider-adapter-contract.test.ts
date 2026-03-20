import {
  createClaudeCodeProviderAdapter,
  createCodexProviderAdapter,
  createPiProviderAdapter,
} from "../index.js";
import { runProviderAdapterContractSuite } from "./provider-adapter-contract-harness.js";

const context = {
  projectId: "proj-1",
  threadId: "bb-thread-1",
  serverUrl: "http://localhost:3141",
  path: "/tmp/project/bin",
};

runProviderAdapterContractSuite({
  suiteName: "codex provider adapter contract",
  createAdapter: () => createCodexProviderAdapter(),
  context,
  providerThreadId: "codex-thread-1",
  expected: {
    id: "codex",
    displayName: "Codex",
    resumeRoutingThreadId: {
      none: "bb-thread-1",
      active: "codex-thread-1",
    },
    turnStartRoutingThreadId: "codex-thread-1",
    supportsRename: true,
    supportsServiceTier: true,
  },
});

runProviderAdapterContractSuite({
  suiteName: "claude-code provider adapter contract",
  createAdapter: () => createClaudeCodeProviderAdapter(),
  context,
  providerThreadId: "claude-session-1",
  expected: {
    id: "claude-code",
    displayName: "Claude Code",
    startRoutingThreadId: "bb-thread-1",
    resumeRoutingThreadId: {
      none: "bb-thread-1",
      active: "bb-thread-1",
    },
    turnStartRoutingThreadId: "bb-thread-1",
    supportsRename: false,
    supportsServiceTier: false,
    providerThreadIdField: {
      field: "providerThreadId",
      noneValue: null,
      activeValue: "claude-session-1",
    },
  },
});

runProviderAdapterContractSuite({
  suiteName: "pi provider adapter contract",
  createAdapter: () => createPiProviderAdapter(),
  context,
  providerThreadId: "pi-session-1",
  resumePath: "/tmp/pi/session.json",
  expected: {
    id: "pi",
    displayName: "Pi",
    startRoutingThreadId: "bb-thread-1",
    resumeRoutingThreadId: {
      none: "bb-thread-1",
      active: "pi-session-1",
    },
    turnStartRoutingThreadId: "pi-session-1",
    supportsRename: false,
    supportsServiceTier: false,
    resumePathField: {
      field: "sessionPath",
      value: "/tmp/pi/session.json",
    },
  },
});
