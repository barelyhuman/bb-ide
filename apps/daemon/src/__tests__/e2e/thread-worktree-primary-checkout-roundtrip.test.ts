import { describe, it } from "vitest";
import { runThreadWorktreePrimaryCheckoutRoundtripScenario } from "./thread-worktree-primary-checkout-roundtrip.scenario.js";

describe.sequential("e2e: worktree primary checkout promotion", () => {
  it(
    "promotes and demotes a worktree thread through the CLI while keeping project primary-checkout state coherent",
    runThreadWorktreePrimaryCheckoutRoundtripScenario,
    30_000,
  );
});
