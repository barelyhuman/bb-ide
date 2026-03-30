import { complete, getModel } from "@mariozechner/pi-ai";
import { renderTemplate } from "@bb/templates";
import {
  getEnvironment,
  getThread,
  updateThread,
} from "@bb/db";
import type { PromptInput } from "@bb/domain";
import type { AppDeps } from "../types.js";
import { queueThreadRenameCommand } from "./thread-commands.js";
import { appendThreadTitleUpdatedEvent } from "./thread-events.js";

export function deriveTitleFallback(input: PromptInput[]): string | null {
  const text = input
    .filter((part) => part.type === "text")
    .map((part) => part.text.trim())
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
  if (text.length === 0) {
    return null;
  }
  return text.length <= 80 ? text : `${text.slice(0, 77)}...`;
}

function parseInferenceModel(model: string) {
  const slashIndex = model.indexOf("/");
  if (slashIndex === -1) {
    throw new Error(`Invalid inference model: ${model}`);
  }
  return {
    provider: model.slice(0, slashIndex),
    modelId: model.slice(slashIndex + 1),
  };
}

function extractAssistantText(message: Awaited<ReturnType<typeof complete>>): string {
  return message.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

function parseGeneratedTitle(text: string): { branchName?: string; title?: string } {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  return {
    title: typeof parsed.title === "string" ? parsed.title : undefined,
    branchName: typeof parsed.branchName === "string" ? parsed.branchName : undefined,
  };
}

export async function generateThreadTitle(
  deps: Pick<AppDeps, "config" | "db" | "hub" | "logger">,
  args: {
    input: PromptInput[];
    threadId: string;
  },
): Promise<void> {
  const fallback = deriveTitleFallback(args.input);
  if (!fallback) {
    return;
  }

  const thread = getThread(deps.db, args.threadId);
  if (!thread || thread.title) {
    return;
  }

  try {
    const modelInfo = parseInferenceModel(deps.config.inferenceModel);
    if (modelInfo.provider === "openai" && !deps.config.openAiApiKey) {
      return;
    }
    // @ts-expect-error — pi-ai overloads getModel per provider; our provider string is dynamic
    const model = getModel(modelInfo.provider, modelInfo.modelId);
    if (!model) {
      deps.logger.warn({ provider: modelInfo.provider }, "Unsupported inference provider");
      return;
    }
    const prompt = renderTemplate("generateThreadMetadata", {
      cleanedPrompt: fallback,
    });
    const response = await complete(model, {
      messages: [
        {
          role: "user",
          content: prompt,
          timestamp: Date.now(),
        },
      ],
    });
    const parsed = parseGeneratedTitle(extractAssistantText(response));
    if (!parsed.title || parsed.title.trim().length === 0) {
      return;
    }

    const currentThread = getThread(deps.db, args.threadId);
    if (!currentThread || currentThread.title) {
      return;
    }

    updateThread(deps.db, deps.hub, args.threadId, {
      title: parsed.title,
    });
    appendThreadTitleUpdatedEvent(deps, {
      threadId: args.threadId,
      previousTitle: currentThread.title,
      nextTitle: parsed.title,
    });

    const titledThread = getThread(deps.db, args.threadId);
    const environment =
      titledThread?.environmentId ? getEnvironment(deps.db, titledThread.environmentId) : null;
    if (!titledThread || !environment || titledThread.status === "created" || titledThread.status === "provisioning") {
      return;
    }

    queueThreadRenameCommand(deps, {
      environment: {
        id: environment.id,
        hostId: environment.hostId,
      },
      threadId: titledThread.id,
      title: parsed.title,
    });
  } catch (error) {
    deps.logger.warn({ err: error, threadId: args.threadId }, "Failed to generate thread title");
  }
}
