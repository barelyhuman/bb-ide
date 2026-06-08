import { describe, expect, it } from "vitest";
import { renderManagedThreadTurnStatusBatchMessage } from "../../src/services/threads/managed-thread-notifications.js";

describe("managed thread notifications", () => {
  it("preserves manual-stop safety guidance for interrupted batched outcomes", () => {
    const message = renderManagedThreadTurnStatusBatchMessage({
      items: [
        {
          managedThreadId: "thr_child",
          title: "Fix checkout flow",
          turnStatus: "interrupted",
        },
      ],
    });

    expect(message).toContain("interrupted: thr_child (Fix checkout flow)");
    expect(message).toContain(
      "If it was stopped manually by the user, treat that as intentional; do not resume, restart, retry, replace, or continue the work unless the user explicitly asks.",
    );
  });
});
