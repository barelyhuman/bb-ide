import { renderTemplate } from "@bb/templates";
import { getThread, updateThread } from "@bb/db";
import type { ServerDeps } from "./deps.js";

export async function generateTitle(
  deps: ServerDeps,
  threadId: string,
  input: Array<{ type: string; text?: string; [key: string]: unknown }>,
): Promise<void> {
  const { db, hub, logger, inferenceModel } = deps;

  // Extract clean prompt text from input
  const cleanedPrompt = input
    .filter((i) => i.type === "text" && i.text)
    .map((i) => i.text)
    .join("\n")
    .slice(0, 2000);

  if (!cleanedPrompt) return;

  try {
    const prompt = renderTemplate("generateThreadMetadata", { cleanedPrompt });

    // Parse provider/model from BB_INFERENCE_MODEL
    const slashIndex = inferenceModel.indexOf("/");
    if (slashIndex === -1) {
      logger.warn({ inferenceModel }, "invalid BB_INFERENCE_MODEL format, expected provider/model");
      return;
    }
    const provider = inferenceModel.slice(0, slashIndex);
    const modelId = inferenceModel.slice(slashIndex + 1);

    const { getModel, completeSimple } = await import("@mariozechner/pi-ai");

    const model = getModel(provider as "openai", modelId as "gpt-4o-mini");
    const response = await completeSimple(model, {
      messages: [{
        role: "user" as const,
        content: [{ type: "text" as const, text: prompt }],
        timestamp: Date.now(),
      }],
    });

    const text = response.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("");

    const parsed = JSON.parse(text) as { title?: string; branchName?: string };
    if (parsed.title) {
      const thread = getThread(db, threadId);
      if (thread) {
        updateThread(db, hub, threadId, { title: parsed.title });

        // Also notify daemon about the rename if thread has an environment
        if (thread.environmentId) {
          const { getEnvironment, queueCommand, getActiveSession } = await import("@bb/db");
          const env = getEnvironment(db, thread.environmentId);
          if (env) {
            const session = getActiveSession(db, env.hostId);
            queueCommand(db, hub, {
              hostId: env.hostId,
              sessionId: session?.id ?? null,
              type: "thread.rename",
              payload: JSON.stringify({
                type: "thread.rename",
                environmentId: env.id,
                threadId: thread.id,
                title: parsed.title,
              }),
            });
            hub.notifyCommand(env.hostId);
          }
        }
      }
    }
  } catch (err) {
    logger.warn({ err, threadId }, "title generation failed");
  }
}
