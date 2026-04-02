import { complete, getModel, validateToolCall } from "@mariozechner/pi-ai";
import type { Static, TSchema, Tool } from "@mariozechner/pi-ai";
import type { AppDeps } from "../types.js";

export interface InferenceModelInfo {
  provider: string;
  modelId: string;
}

export function parseInferenceModel(model: string): InferenceModelInfo {
  const slashIndex = model.indexOf("/");
  if (slashIndex === -1) {
    throw new Error(`Invalid inference model: ${model}`);
  }
  return {
    provider: model.slice(0, slashIndex),
    modelId: model.slice(slashIndex + 1),
  };
}

export function getInferenceModel(
  deps: Pick<AppDeps, "config" | "logger">,
): ReturnType<typeof getModel> | null {
  const modelInfo = parseInferenceModel(deps.config.inferenceModel);
  if (modelInfo.provider === "openai" && !deps.config.openAiApiKey) {
    return null;
  }
  // @ts-expect-error — pi-ai overloads getModel per provider; our provider string is dynamic
  const model = getModel(modelInfo.provider, modelInfo.modelId);
  if (!model) {
    deps.logger.warn(
      { provider: modelInfo.provider },
      "Unsupported inference provider",
    );
    return null;
  }
  return model;
}

const RESULT_TOOL_NAME = "result";

interface InferenceCompleteArgs<T extends TSchema> {
  prompt: string;
  schema: T;
  timeoutMs?: number;
}

/**
 * Send a prompt to the configured inference model and return structured
 * output validated via a tool call. The model is given a single tool whose
 * parameters match the provided TypeBox schema; the tool call arguments
 * are validated against the schema and returned. Returns `null` if the
 * model is not configured or does not produce a valid tool call.
 */
export async function inferenceComplete<T extends TSchema>(
  deps: Pick<AppDeps, "config" | "logger">,
  args: InferenceCompleteArgs<T>,
): Promise<Static<T> | null> {
  const model = getInferenceModel(deps);
  if (!model) {
    return null;
  }

  const tools: Tool<T>[] = [
    {
      name: RESULT_TOOL_NAME,
      description: "Return the result as structured JSON.",
      parameters: args.schema,
    },
  ];

  const completionPromise = complete(model, {
    messages: [
      {
        role: "user",
        content: args.prompt,
        timestamp: Date.now(),
      },
    ],
    tools,
  });

  const response = args.timeoutMs
    ? await Promise.race([
        completionPromise,
        new Promise<never>((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Inference request timed out")),
            args.timeoutMs,
          );
          timer.unref();
        }),
      ])
    : await completionPromise;

  const toolCall = response.content.find(
    (item) => item.type === "toolCall" && item.name === RESULT_TOOL_NAME,
  );
  if (!toolCall || toolCall.type !== "toolCall") {
    return null;
  }

  // validateToolCall validates arguments against the TypeBox schema and
  // returns the validated data. Its return type is `any` so the cast is needed.
  return validateToolCall(tools, toolCall) as Static<T>;
}
