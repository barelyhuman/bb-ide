import { describe, it } from "vitest";
import { runStandaloneDaemonCliRoundtripScenario } from "./standalone-daemon-cli-roundtrip.scenario.js";
import { supportsFakeCodexControl } from "./provider-mode.js";

const itWithSupportedProvider = supportsFakeCodexControl() ? it : it.skip;

describe.sequential("e2e: standalone daemon cli roundtrip", () => {
  itWithSupportedProvider(
    "covers spawn, restart, follow-up, steer, and post-stop follow-up via the standalone daemon process",
    runStandaloneDaemonCliRoundtripScenario,
    60_000,
  );
});
