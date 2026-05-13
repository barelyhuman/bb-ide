import { describe, expect, it } from "vitest";
import type {
  Environment,
  LocalPathProjectSource,
  WorkspaceStatus,
} from "@bb/domain";
import {
  makeWorkspaceStatus,
  makeWorkspaceWorkingTree,
} from "@bb/test-helpers";
import {
  buildDemoteAvailability,
  buildPromoteAvailability,
  derivePromotionStateFromFacts,
  type PromotionWorkspaceFacts,
} from "../../../src/services/environments/environment-promotion.js";

const SOURCE: LocalPathProjectSource = {
  id: "src-1",
  projectId: "proj-1",
  type: "local_path",
  hostId: "host-1",
  path: "/tmp/project",
  isDefault: true,
  createdAt: 0,
  updatedAt: 0,
};

function makeEnvironment(overrides: Partial<Environment> = {}): Environment {
  return {
    id: "env-1",
    projectId: "proj-1",
    hostId: "host-1",
    path: "/tmp/project/.bb-worktrees/thread",
    managed: true,
    isGitRepo: true,
    isWorktree: true,
    workspaceProvisionType: "managed-worktree",
    branchName: "bb/thread",
    baseBranch: null,
    defaultBranch: "main",
    mergeBaseBranch: null,
    cleanupRequestedAt: null,
    cleanupMode: null,
    status: "ready",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

interface FactsOverrides {
  primaryStatus?: WorkspaceStatus | null;
  environmentStatus?: WorkspaceStatus | null;
  eligibilityUnavailableReason?:
    | PromotionWorkspaceFacts["eligibilityUnavailableReason"];
  source?: LocalPathProjectSource | null;
}

function makeFacts(overrides: FactsOverrides = {}): PromotionWorkspaceFacts {
  return {
    eligibilityUnavailableReason: null,
    primaryStatus: makeWorkspaceStatus(),
    environmentStatus: makeWorkspaceStatus(),
    source: SOURCE,
    ...overrides,
  };
}

function computeResponse(
  environment: Environment,
  facts: PromotionWorkspaceFacts,
) {
  const state = derivePromotionStateFromFacts(environment, facts);
  return {
    state,
    actions: {
      promote: buildPromoteAvailability(facts, state),
      demote: buildDemoteAvailability(environment, facts, state),
    },
  };
}

describe("promotion derivation", () => {
  describe("derivePromotionStateFromFacts", () => {
    it("reports promoted when the primary checkout sits on the env branch and the env worktree does not", () => {
      const environment = makeEnvironment({ branchName: "bb/thread" });
      const facts = makeFacts({
        primaryStatus: makeWorkspaceStatus({
          branch: { currentBranch: "bb/thread", defaultBranch: "main" },
        }),
        environmentStatus: makeWorkspaceStatus({
          branch: { currentBranch: null, defaultBranch: "main" },
        }),
      });

      expect(derivePromotionStateFromFacts(environment, facts)).toEqual({
        isPromoted: true,
        branchName: "bb/thread",
      });
    });

    it("reports not promoted when the env branch still lives on its worktree", () => {
      const environment = makeEnvironment({ branchName: "bb/thread" });
      const facts = makeFacts({
        primaryStatus: makeWorkspaceStatus({
          branch: { currentBranch: "main", defaultBranch: "main" },
        }),
        environmentStatus: makeWorkspaceStatus({
          branch: { currentBranch: "bb/thread", defaultBranch: "main" },
        }),
      });

      expect(derivePromotionStateFromFacts(environment, facts)).toEqual({
        isPromoted: false,
        branchName: "bb/thread",
      });
    });

    it("reports not promoted with no branch name when the environment row has none", () => {
      const environment = makeEnvironment({ branchName: null });
      const facts = makeFacts();

      expect(derivePromotionStateFromFacts(environment, facts)).toEqual({
        isPromoted: false,
        branchName: null,
      });
    });

    it("reports not promoted when eligibility is already unavailable", () => {
      const environment = makeEnvironment({ branchName: "bb/thread" });
      const facts = makeFacts({
        eligibilityUnavailableReason: "environment_not_ready",
      });

      expect(derivePromotionStateFromFacts(environment, facts)).toEqual({
        isPromoted: false,
        branchName: "bb/thread",
      });
    });

    it("reports not promoted when either workspace status is missing", () => {
      const environment = makeEnvironment({ branchName: "bb/thread" });

      expect(
        derivePromotionStateFromFacts(
          environment,
          makeFacts({ primaryStatus: null }),
        ),
      ).toEqual({ isPromoted: false, branchName: "bb/thread" });
      expect(
        derivePromotionStateFromFacts(
          environment,
          makeFacts({ environmentStatus: null }),
        ),
      ).toEqual({ isPromoted: false, branchName: "bb/thread" });
    });
  });

  describe("action availability", () => {
    it("blocks promote on an already-promoted env and clears demote", () => {
      const environment = makeEnvironment({ branchName: "bb/thread" });
      const facts = makeFacts({
        primaryStatus: makeWorkspaceStatus({
          branch: { currentBranch: "bb/thread", defaultBranch: "main" },
        }),
        environmentStatus: makeWorkspaceStatus({
          branch: { currentBranch: null, defaultBranch: "main" },
        }),
      });

      expect(computeResponse(environment, facts).actions).toEqual({
        promote: { unavailableReasons: ["already_promoted"] },
        demote: { unavailableReasons: [] },
      });
    });

    it("allows promote on an eligible non-promoted env and blocks demote", () => {
      const environment = makeEnvironment({ branchName: "bb/thread" });
      const facts = makeFacts({
        primaryStatus: makeWorkspaceStatus({
          branch: { currentBranch: "main", defaultBranch: "main" },
        }),
        environmentStatus: makeWorkspaceStatus({
          branch: { currentBranch: "bb/thread", defaultBranch: "main" },
        }),
      });

      expect(computeResponse(environment, facts).actions).toEqual({
        promote: { unavailableReasons: [] },
        demote: { unavailableReasons: ["not_promoted"] },
      });
    });

    it("surfaces dirty-state reasons on both actions when both worktrees are dirty", () => {
      const environment = makeEnvironment({ branchName: "bb/thread" });
      const dirty = makeWorkspaceWorkingTree({
        hasUncommittedChanges: true,
        state: "dirty_uncommitted",
      });
      const facts = makeFacts({
        primaryStatus: makeWorkspaceStatus({
          workingTree: dirty,
          branch: { currentBranch: "main", defaultBranch: "main" },
        }),
        environmentStatus: makeWorkspaceStatus({
          workingTree: dirty,
          branch: { currentBranch: "bb/thread", defaultBranch: "main" },
        }),
      });

      expect(computeResponse(environment, facts).actions).toEqual({
        promote: {
          unavailableReasons: ["primary_checkout_dirty", "environment_dirty"],
        },
        demote: {
          unavailableReasons: [
            "primary_checkout_dirty",
            "environment_dirty",
            "not_promoted",
          ],
        },
      });
    });

    it("blocks promote with environment_branch_mismatch when the env worktree is on a different branch", () => {
      const environment = makeEnvironment({ branchName: "bb/thread" });
      const facts = makeFacts({
        primaryStatus: makeWorkspaceStatus({
          branch: { currentBranch: "main", defaultBranch: "main" },
        }),
        environmentStatus: makeWorkspaceStatus({
          branch: { currentBranch: "bb/other", defaultBranch: "main" },
        }),
      });

      const response = computeResponse(environment, facts);
      expect(response.state.isPromoted).toBe(false);
      expect(response.actions.promote).toEqual({
        unavailableReasons: ["environment_branch_mismatch"],
      });
    });

    it("blocks demote with missing_default_branch when the env row has no default branch", () => {
      // The blocker is driven by the Environment row's defaultBranch, not
      // the workspace.status branch values — those still come from git and
      // remain populated.
      const environment = makeEnvironment({
        branchName: "bb/thread",
        defaultBranch: null,
      });
      const facts = makeFacts({
        primaryStatus: makeWorkspaceStatus({
          branch: { currentBranch: "bb/thread", defaultBranch: "main" },
        }),
        environmentStatus: makeWorkspaceStatus({
          branch: { currentBranch: null, defaultBranch: "main" },
        }),
      });

      expect(computeResponse(environment, facts).actions.demote).toEqual({
        unavailableReasons: ["missing_default_branch"],
      });
    });

    it("returns the eligibility reason as the sole blocker when eligibility is unavailable", () => {
      const environment = makeEnvironment({ branchName: "bb/thread" });
      const facts = makeFacts({
        eligibilityUnavailableReason: "environment_not_ready",
        primaryStatus: null,
        environmentStatus: null,
      });

      expect(computeResponse(environment, facts).actions).toEqual({
        promote: { unavailableReasons: ["environment_not_ready"] },
        demote: { unavailableReasons: ["environment_not_ready"] },
      });
    });

    it("returns a status-unavailable blocker when the primary status could not be read", () => {
      const environment = makeEnvironment({ branchName: "bb/thread" });
      const facts = makeFacts({ primaryStatus: null });

      expect(computeResponse(environment, facts).actions).toEqual({
        promote: { unavailableReasons: ["primary_checkout_status_unavailable"] },
        demote: { unavailableReasons: ["primary_checkout_status_unavailable"] },
      });
    });

    it("returns a status-unavailable blocker when the env status could not be read", () => {
      const environment = makeEnvironment({ branchName: "bb/thread" });
      const facts = makeFacts({ environmentStatus: null });

      expect(computeResponse(environment, facts).actions).toEqual({
        promote: { unavailableReasons: ["environment_status_unavailable"] },
        demote: { unavailableReasons: ["environment_status_unavailable"] },
      });
    });
  });
});
