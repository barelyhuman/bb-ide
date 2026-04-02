import { renderTemplate } from "@bb/templates";
import type { AppDeps } from "../types.js";
import { Type } from "@mariozechner/pi-ai";
import { inferenceComplete } from "./inference.js";

const commitMessageSchema = Type.Object({
  message: Type.String({ minLength: 1 }),
});

interface GenerateCommitMessageArgs {
  diffDescription: string;
  shortstat: string;
  files: string;
  patch: string;
}

const COMMIT_MESSAGE_TIMEOUT_MS = 10_000;

export async function generateCommitMessage(
  deps: Pick<AppDeps, "config" | "logger">,
  args: GenerateCommitMessageArgs,
): Promise<string | null> {
  try {
    const prompt = renderTemplate("generateCommitMessage", {
      diffDescription: args.diffDescription,
      shortstat: args.shortstat,
      files: args.files,
      patch: args.patch,
    });

    const result = await inferenceComplete(deps, {
      prompt,
      schema: commitMessageSchema,
      timeoutMs: COMMIT_MESSAGE_TIMEOUT_MS,
    });

    return result?.message ?? null;
  } catch (error) {
    deps.logger.warn({ err: error }, "Failed to generate commit message");
    return null;
  }
}
