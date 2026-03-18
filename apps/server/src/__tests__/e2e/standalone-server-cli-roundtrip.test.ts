import { describe, it } from "vitest";
import { runStandaloneServerCliRoundtripScenario } from "./standalone-server-cli-roundtrip.scenario.js";
import { supportsFakeCodexControl } from "./provider-mode.js";

const itWithSupportedProvider = supportsFakeCodexControl() ? it : it.skip;

describe.sequential("e2e: standalone server cli roundtrip", () => {
  itWithSupportedProvider(
    "covers spawn, restart, follow-up, steer, and post-stop follow-up via the standalone server process",
    runStandaloneServerCliRoundtripScenario,
    60_000,
  );
});
