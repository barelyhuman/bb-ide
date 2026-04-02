import { renderTemplate } from "@bb/templates";
import {
  getEnvironment,
  getThread,
  updateThread,
} from "@bb/db";
import type { PromptInput } from "@bb/domain";
import type { AppDeps } from "../types.js";
import { Type } from "@mariozechner/pi-ai";
import { inferenceComplete } from "./inference.js";
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

const titleSchema = Type.Object({
  title: Type.Optional(Type.String()),
});

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
    const prompt = renderTemplate("generateThreadMetadata", {
      cleanedPrompt: fallback,
    });

    const parsed = await inferenceComplete(deps, {
      prompt,
      schema: titleSchema,
    });

    if (!parsed?.title || parsed.title.trim().length === 0) {
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
