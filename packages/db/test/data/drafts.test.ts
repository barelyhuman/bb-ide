import { describe, expect, it, vi } from "vitest";
import { createConnection } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import {
  claimDraft,
  claimNextDraft,
  createDraft,
  deleteDraft,
  getDraft,
  listDrafts,
  releaseDraftClaim,
} from "../../src/data/drafts.js";
import { createProject } from "../../src/data/projects.js";
import { createThread } from "../../src/data/threads.js";

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  const project = createProject(db, noopNotifier, { name: "test-project" });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
  });
  return { db, project, thread };
}

describe("drafts", () => {
  it("creates a draft", () => {
    const { db, thread } = setup();
    const draft = createDraft(db, noopNotifier, {
      threadId: thread.id,
      content: "[]",
      model: "gpt-5",
      reasoningLevel: "medium",
      sandboxMode: "danger-full-access",
      serviceTier: "flex",
    });

    expect(draft.id).toMatch(/^draft_/);
    expect(draft.threadId).toBe(thread.id);
    expect(draft.content).toBe("[]");
    expect(draft.model).toBe("gpt-5");
    expect(draft.serviceTier).toBe("flex");
  });

  it("gets a draft by ID", () => {
    const { db, thread } = setup();
    const draft = createDraft(db, noopNotifier, {
      threadId: thread.id,
      content: "[]",
      model: "gpt-5",
      reasoningLevel: "medium",
      sandboxMode: "danger-full-access",
      serviceTier: "flex",
    });

    const fetched = getDraft(db, draft.id);
    expect(fetched?.id).toBe(draft.id);
    expect(getDraft(db, "draft_nonexistent")).toBeNull();
  });

  it("lists drafts by thread", () => {
    const { db, thread } = setup();
    createDraft(db, noopNotifier, {
      threadId: thread.id,
      content: "[]",
      model: "gpt-5",
      reasoningLevel: "medium",
      sandboxMode: "danger-full-access",
      serviceTier: "flex",
    });
    createDraft(db, noopNotifier, {
      threadId: thread.id,
      content: "[{}]",
      model: "gpt-5",
      reasoningLevel: "high",
      sandboxMode: "danger-full-access",
      serviceTier: "flex",
    });

    expect(listDrafts(db, thread.id)).toHaveLength(2);
  });

  it("deletes a draft", () => {
    const { db, thread } = setup();
    const draft = createDraft(db, noopNotifier, {
      threadId: thread.id,
      content: "[]",
      model: "gpt-5",
      reasoningLevel: "medium",
      sandboxMode: "danger-full-access",
      serviceTier: "flex",
    });

    expect(deleteDraft(db, noopNotifier, draft.id)).toBe(true);
    expect(listDrafts(db, thread.id)).toHaveLength(0);
    expect(deleteDraft(db, noopNotifier, draft.id)).toBe(false);
  });

  it("claims a draft and hides it from the queue until the claim is released", () => {
    const { db, thread } = setup();
    const draft = createDraft(db, noopNotifier, {
      threadId: thread.id,
      content: "[]",
      model: "gpt-5",
      reasoningLevel: "medium",
      sandboxMode: "danger-full-access",
      serviceTier: "flex",
    });

    const claimedDraft = claimDraft(db, noopNotifier, draft.id);
    expect(claimedDraft?.id).toBe(draft.id);
    expect(listDrafts(db, thread.id)).toHaveLength(0);

    expect(releaseDraftClaim(db, noopNotifier, draft.id)).toBe(true);
    expect(listDrafts(db, thread.id)).toHaveLength(1);
  });

  it("claims the oldest queued draft first", () => {
    const { db, thread } = setup();
    const nowSpy = vi.spyOn(Date, "now");
    try {
      nowSpy.mockReturnValueOnce(1_000);
      const firstDraft = createDraft(db, noopNotifier, {
        threadId: thread.id,
        content: "[]",
        model: "gpt-5",
        reasoningLevel: "medium",
        sandboxMode: "danger-full-access",
        serviceTier: "flex",
      });
      nowSpy.mockReturnValueOnce(2_000);
      const secondDraft = createDraft(db, noopNotifier, {
        threadId: thread.id,
        content: "[{}]",
        model: "gpt-5",
        reasoningLevel: "high",
        sandboxMode: "danger-full-access",
        serviceTier: "flex",
      });

      const claimedDraft = claimNextDraft(db, noopNotifier, thread.id);
      expect(claimedDraft?.id).toBe(firstDraft.id);
      expect(listDrafts(db, thread.id).map((draft) => draft.id)).toEqual([
        secondDraft.id,
      ]);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
