import { describe, it } from "vitest";
import { runThreadSpawnRoundtripScenario } from "./thread-spawn-roundtrip.scenario.js";
import { e2eTimeoutMs } from "./provider-mode.js";

describe.sequential("e2e: CLI -> HTTP -> daemon -> agent -> API", () => {
  it(
    "spawns a thread via CLI and records outbound + lifecycle events",
    runThreadSpawnRoundtripScenario,
    e2eTimeoutMs(15_000, 120_000),
  );
});
