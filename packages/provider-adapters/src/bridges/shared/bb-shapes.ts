export interface BridgeTokenUsageBreakdown {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface BridgeTokenUsage {
  total: BridgeTokenUsageBreakdown;
  last: BridgeTokenUsageBreakdown;
  modelContextWindow: number | null;
}

export type BridgeItem =
  | { type: "agentMessage"; text: string }
  | {
      type: "commandExecution";
      id: string;
      command?: unknown;
      cwd?: unknown;
      status: "running" | "completed" | "error";
      aggregatedOutput?: string;
      exitCode?: number;
    }
  | {
      type: "filechange";
      id: string;
      changes?: Array<{ path: string; kind: { type: "update" } }>;
      stdout?: string;
      status?: "completed" | "error";
    }
  | {
      type: "webSearch";
      id: string;
      query?: unknown;
      status?: "completed" | "error";
    }
  | {
      type: "custom_tool_call";
      call_id: string;
      name: string;
      input: string;
    }
  | {
      type: "custom_tool_call_output";
      call_id: string;
      output: string;
    };

export type BridgeNotification =
  | {
      jsonrpc: "2.0";
      method: "turn/started";
      params: { threadId: string; turnId: string };
    }
  | {
      jsonrpc: "2.0";
      method: "item/started";
      params: { threadId: string; turnId: string; item: BridgeItem };
    }
  | {
      jsonrpc: "2.0";
      method: "item/completed";
      params: { threadId: string; turnId: string; item: BridgeItem };
    }
  | {
      jsonrpc: "2.0";
      method: "item/agentMessage/delta";
      params: { threadId: string; turnId: string; delta: string };
    }
  | {
      jsonrpc: "2.0";
      method: "thread/tokenUsage/updated";
      params: { threadId: string; turnId: string; tokenUsage: BridgeTokenUsage };
    }
  | {
      jsonrpc: "2.0";
      method: "turn/completed";
      params: {
        threadId: string;
        turnId: string;
        result?: { subtype: string };
        error?: { message: string };
      };
    }
  | {
      jsonrpc: "2.0";
      method: "error";
      params: { threadId: string; message: string };
    }
  | {
      jsonrpc: "2.0";
      method: "thread/started";
      params: { threadId: string; providerThreadId: string };
    };
