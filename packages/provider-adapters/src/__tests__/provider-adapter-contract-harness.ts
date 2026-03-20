import { describe, expect, it } from "vitest";
import type {
  PromptInput,
  SpawnThreadRequest,
} from "@bb/core";
import type {
  ProviderAdapter,
  ProviderDynamicTool,
  ProviderThreadContext,
  ProviderToolCallResponse,
} from "../provider-adapter.js";

export interface ProviderAdapterContractFixture {
  suiteName: string;
  createAdapter: () => ProviderAdapter;
  context: ProviderThreadContext;
  startRequest?: SpawnThreadRequest;
  turnInput?: PromptInput[];
  dynamicTools?: ProviderDynamicTool[];
  providerThreadId?: string;
  resumePath?: string;
  expected: {
    id: string;
    displayName: string;
    startRoutingThreadId?: string;
    resumeRoutingThreadId: {
      none: string;
      active: string;
    };
    turnStartRoutingThreadId: string;
    turnSteerRoutingThreadId?: string;
    supportsRename: boolean;
    supportsServiceTier: boolean;
    providerThreadIdField?: {
      field: string;
      noneValue: string | null;
      activeValue: string;
    };
    resumePathField?: {
      field: string;
      value: string;
    };
  };
}

const DEFAULT_START_REQUEST: SpawnThreadRequest = {
  projectId: "proj-1",
  input: [{ type: "text", text: "Fix the failing test output" }],
  sandboxMode: "workspace-write",
};

const DEFAULT_DYNAMIC_TOOLS: ProviderDynamicTool[] = [
  {
    name: "bb.test",
    description: "Run provider contract checks",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    },
  },
];

const DEFAULT_TURN_INPUT: PromptInput[] = [
  { type: "text", text: "Continue with the next change" },
];

const SAMPLE_TOOL_RESPONSE: ProviderToolCallResponse = {
  success: true,
  contentItems: [
    { type: "inputText", text: "tool ok" },
    { type: "inputImage", imageUrl: "https://example.com/tool.png" },
  ],
};

function getStringRecordValue(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

export function runProviderAdapterContractSuite(
  fixture: ProviderAdapterContractFixture,
): void {
  describe(fixture.suiteName, () => {
    const startRequest = fixture.startRequest ?? DEFAULT_START_REQUEST;
    const turnInput = fixture.turnInput ?? DEFAULT_TURN_INPUT;
    const dynamicTools = fixture.dynamicTools ?? DEFAULT_DYNAMIC_TOOLS;
    const expectedTurnSteerRoutingThreadId =
      fixture.expected.turnSteerRoutingThreadId ??
      fixture.expected.turnStartRoutingThreadId;

    it("matches the shared provider adapter contract", () => {
      const adapter = fixture.createAdapter();

      expect(adapter.id).toBe(fixture.expected.id);
      expect(adapter.displayName).toBe(fixture.expected.displayName);
      expect(adapter.threadStartMethod).toBe("thread/start");
      expect(adapter.threadResumeMethod).toBe("thread/resume");
      expect(adapter.turnStartMethod).toBe("turn/start");
      expect(adapter.turnSteerMethod).toBe("turn/steer");
      expect(adapter.capabilities).toEqual({
        supportsRename: fixture.expected.supportsRename,
        supportsServiceTier: fixture.expected.supportsServiceTier,
      });
    });

    it("creates initialize params with the declared client info", () => {
      const adapter = fixture.createAdapter();
      expect(adapter.createInitializeParams?.(adapter.clientInfo)).toMatchObject({
        clientInfo: adapter.clientInfo,
      });
    });

    it("creates start, resume, and turn params with stable routing semantics", () => {
      const adapter = fixture.createAdapter();

      const startParams = adapter.createThreadStartParams(
        startRequest,
        fixture.context,
        dynamicTools,
      );
      if (fixture.expected.startRoutingThreadId !== undefined) {
        expect(getStringRecordValue(startParams, "threadId")).toBe(
          fixture.expected.startRoutingThreadId,
        );
      }
      expect(startParams.dynamicTools).toEqual(dynamicTools);

      const resumeWithoutProviderThread = adapter.createThreadResumeParams(
        undefined,
        fixture.context,
        undefined,
        fixture.resumePath,
      );
      expect(getStringRecordValue(resumeWithoutProviderThread, "threadId")).toBe(
        fixture.expected.resumeRoutingThreadId.none,
      );

      const resumeWithProviderThread = adapter.createThreadResumeParams(
        fixture.providerThreadId,
        fixture.context,
        undefined,
        fixture.resumePath,
      );
      expect(getStringRecordValue(resumeWithProviderThread, "threadId")).toBe(
        fixture.expected.resumeRoutingThreadId.active,
      );

      if (fixture.expected.providerThreadIdField) {
        expect(
          resumeWithoutProviderThread[
            fixture.expected.providerThreadIdField.field
          ],
        ).toBe(fixture.expected.providerThreadIdField.noneValue);
        expect(
          resumeWithProviderThread[
            fixture.expected.providerThreadIdField.field
          ],
        ).toBe(fixture.expected.providerThreadIdField.activeValue);
      }

      if (fixture.expected.resumePathField) {
        expect(
          resumeWithProviderThread[fixture.expected.resumePathField.field],
        ).toBe(fixture.expected.resumePathField.value);
      }

      const turnStartParams = adapter.createTurnStartParams(
        fixture.context.threadId,
        fixture.providerThreadId,
        turnInput,
      );
      expect(getStringRecordValue(turnStartParams, "threadId")).toBe(
        fixture.expected.turnStartRoutingThreadId,
      );

      const turnSteerParams = adapter.createTurnSteerParams?.(
        fixture.context.threadId,
        fixture.providerThreadId,
        "turn-1",
        turnInput,
      );
      expect(getStringRecordValue(turnSteerParams ?? {}, "threadId")).toBe(
        expectedTurnSteerRoutingThreadId,
      );
      expect(getStringRecordValue(turnSteerParams ?? {}, "expectedTurnId")).toBe(
        "turn-1",
      );

      if (fixture.expected.providerThreadIdField && turnStartParams) {
        const field = fixture.expected.providerThreadIdField.field;
        expect(turnStartParams[field]).toBe(
          fixture.expected.providerThreadIdField.activeValue,
        );
        expect(turnSteerParams?.[field]).toBe(
          fixture.expected.providerThreadIdField.activeValue,
        );
      }
    });

    it("derives a stable title from text input", () => {
      const adapter = fixture.createAdapter();
      expect(
        adapter.deriveThreadTitle([
          {
            type: "text",
            text: "  Fix the flaky thread restart test with a deterministic seed  ",
          },
        ]),
      ).toBe("Fix the flaky thread restart test with a deterministic seed");
    });

    it("round-trips tool call request and response shapes", () => {
      const adapter = fixture.createAdapter();
      const decoded = adapter.decodeToolCallRequest?.(
        "req-1",
        "item/tool/call",
        {
          threadId: fixture.context.threadId,
          turnId: "turn-1",
          callId: "call-1",
          tool: "bb.test",
          arguments: { query: "status" },
        },
      );

      expect(decoded).toEqual({
        requestId: "req-1",
        threadId: fixture.context.threadId,
        turnId: "turn-1",
        callId: "call-1",
        tool: "bb.test",
        arguments: { query: "status" },
      });

      expect(adapter.decodeToolCallRequest?.("req-1", "thread/start", {})).toBeNull();
      expect(adapter.encodeToolCallResponse?.(SAMPLE_TOOL_RESPONSE)).toEqual({
        success: true,
        contentItems: [
          { type: "inputText", text: "tool ok" },
          { type: "inputImage", imageUrl: "https://example.com/tool.png" },
        ],
      });
    });

    it("returns an inactive-session error that names the thread", () => {
      const adapter = fixture.createAdapter();
      expect(adapter.inactiveSessionErrorMessage(fixture.context.threadId)).toContain(
        fixture.context.threadId,
      );
    });
  });
}
