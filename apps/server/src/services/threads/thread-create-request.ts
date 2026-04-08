import type { PromptInput, ThreadType } from "@bb/domain";
import type {
  CreateThreadRequest,
  EnvironmentArgs,
  ThreadCreateOrigin,
} from "@bb/server-contract";

export interface ThreadCreateServiceRequest {
  automationId: string | null;
  environment: EnvironmentArgs;
  input: PromptInput[];
  model?: CreateThreadRequest["model"];
  origin: ThreadCreateOrigin | null;
  parentThreadId?: string;
  projectId: string;
  providerId: string;
  reasoningLevel?: CreateThreadRequest["reasoningLevel"];
  sandboxMode?: CreateThreadRequest["sandboxMode"];
  serviceTier?: CreateThreadRequest["serviceTier"];
  title?: string;
  type: ThreadType;
}
