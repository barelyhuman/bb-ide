import { describe, it } from "vitest";
import { runThreadSharedEnvironmentRoundtripScenario } from "./thread-shared-environment-roundtrip.scenario.js";

describe.sequential("e2e: shared environment roundtrip", () => {
  it(
    "reuses one env-daemon across attached worktree threads while sibling lifecycle changes continue to work",
    async () => {
      await runThreadSharedEnvironmentRoundtripScenario();
    },
    180_000,
  );
});
