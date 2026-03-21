import type {
  AvailableModel,
  BbProviderEvent,
  PromptInput,
  ProviderCapabilities,
  ProviderDynamicTool,
  ProviderExecutionOptions,
  ProviderLaunchConfiguration,
  ProviderThreadContext,
  ProviderToolCallRequest,
  ProviderToolCallResponse,
  SpawnThreadRequest,
} from "@bb/core";

// ---------------------------------------------------------------------------
// ProviderRequest — bb's discriminated union for all outbound requests
// ---------------------------------------------------------------------------

export type ProviderRequest =
  | {
      type: "initialize";
      clientInfo: { name: string; version: string };
    }
  | {
      type: "thread/start";
      threadId: string;
      req: SpawnThreadRequest;
      context: ProviderThreadContext;
      dynamicTools?: ProviderDynamicTool[];
    }
  | {
      type: "thread/resume";
      threadId: string;
      providerThreadId: string | undefined;
      context: ProviderThreadContext;
      options?: ProviderExecutionOptions;
      resumePath?: string;
    }
  | {
      type: "turn/start";
      threadId: string;
      providerThreadId: string | undefined;
      input: PromptInput[];
      options?: ProviderExecutionOptions;
    }
  | {
      type: "turn/steer";
      threadId: string;
      providerThreadId: string | undefined;
      expectedTurnId: string;
      input: PromptInput[];
    }
  | {
      type: "thread/name/set";
      threadId: string;
      providerThreadId: string | undefined;
      title: string;
    };

// ---------------------------------------------------------------------------
// ProviderAdapter — the extension contract
// ---------------------------------------------------------------------------

export interface ProviderAdapter<
  TProviderEvent,
  TProviderCommand,
> {
  id: string;
  displayName: string;
  capabilities: ProviderCapabilities;
  process: { command: string; args: string[] };

  resolveLaunchConfiguration?(
    context: ProviderThreadContext,
  ):
    | ProviderLaunchConfiguration
    | Promise<ProviderLaunchConfiguration | undefined>
    | undefined;

  preflightSessionStart?():
    | string
    | undefined
    | Promise<string | undefined>;

  buildCommand(request: ProviderRequest): TProviderCommand | null;

  translateEvent(event: TProviderEvent): BbProviderEvent[];

  decodeToolCallRequest(args: {
    requestId: string | number;
    method: string;
    params: Record<string, unknown>;
  }): ProviderToolCallRequest | null;

  encodeToolCallResponse(
    response: ProviderToolCallResponse,
  ): ProviderToolCallResponse;

  listModels(): Promise<AvailableModel[]>;
}
