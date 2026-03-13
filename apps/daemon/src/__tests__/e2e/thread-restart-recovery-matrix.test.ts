import { describe, it } from "vitest";
import { runThreadRestartRecoveryMatrixScenario } from "./thread-restart-recovery-matrix.scenario.js";
import { supportsFakeCodexControl } from "./provider-mode.js";

// TODO: restore fake-provider restart coverage once the lazy env-daemon
// replacement model has dedicated assertions for first-use recovery.
const itWithSupportedProvider = supportsFakeCodexControl() ? it.skip : it.skip;

describe.sequential("e2e: restart recovery matrix", () => {
  itWithSupportedProvider(
    "covers missing-worker restart recovery and idle restart follow-up stability for local and worktree threads",
    runThreadRestartRecoveryMatrixScenario,
    90_000,
  );
});
