import { describe, it } from "vitest";
import { runEnvironmentAgentRestartRoundtripScenario } from "./environment-agent-restart-roundtrip.scenario.js";
import { supportsFakeCodexControl } from "./provider-mode.js";

const itWithSupportedProvider = supportsFakeCodexControl() ? it : it.skip;

describe.sequential("e2e: environment-agent restart recovery", () => {
  itWithSupportedProvider(
    "recovers buffered provider events automatically after daemon restart",
    runEnvironmentAgentRestartRoundtripScenario,
    20_000,
  );
});
