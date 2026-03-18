import { describe, it } from "vitest";
import { runDynamicToolsServerRoundtripScenario } from "./dynamic-tools-server-roundtrip.scenario.js";

const shouldRun = process.env.BB_E2E_PROVIDER_MODE === "real";

describe.runIf(shouldRun).sequential("e2e: server dynamic tools roundtrip", () => {
  it(
    "round-trips a dynamic tool call through environment-daemon and BB",
    runDynamicToolsServerRoundtripScenario,
    180_000,
  );
});
