import { describe, it } from "vitest";
import { runStandaloneDaemonBlockedRestartScenario } from "./standalone-daemon-blocked-restart.scenario.js";
import { supportsFakeCodexControl } from "./provider-mode.js";

const itWithSupportedProvider = supportsFakeCodexControl() ? it : it.skip;

describe.sequential("e2e: standalone daemon blocked restart", () => {
  itWithSupportedProvider(
    "rejects non-forced restart requests while active local and worktree threads exist",
    runStandaloneDaemonBlockedRestartScenario,
    60_000,
  );
});
