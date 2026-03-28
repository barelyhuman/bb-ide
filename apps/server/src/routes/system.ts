import { hostDaemonCommandResultSchemaByType } from "@bb/host-daemon-contract";
import { typedRoutes, type PublicApiSchema } from "@bb/server-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { COMMAND_TIMEOUT_MS } from "../constants.js";
import { ApiError } from "../errors.js";
import { requireEnvironment, requireDefaultConnectedHostId } from "../services/entity-lookup.js";
import { queueCommandAndWait } from "../services/command-wait.js";
import { transcribeVoiceInput } from "../services/voice-transcription.js";

function resolveHostId(deps: AppDeps, query: Record<string, string | undefined>): string {
  if (query.environmentId) {
    return requireEnvironment(deps.db, query.environmentId).hostId;
  }
  if (query.hostId) {
    return query.hostId;
  }
  return requireDefaultConnectedHostId(deps.db);
}

export function registerSystemRoutes(app: Hono, deps: AppDeps): void {
  const { get, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  get("/system/config", (context) =>
    context.json({
      hostDaemonPort: deps.config.hostDaemonPort,
      voiceTranscriptionEnabled: !!deps.config.openAiApiKey,
    }),
  );

  get("/system/providers", async (context) => {
    const hostId = resolveHostId(deps, context.req.query());
    const rawResult = await queueCommandAndWait(deps, {
      hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: { type: "provider.list" },
    });
    return context.json(
      hostDaemonCommandResultSchemaByType["provider.list"].parse(rawResult).providers,
    );
  });

  get("/system/models", async (context) => {
    const hostId = resolveHostId(deps, context.req.query());
    const providerId = context.req.query("providerId");
    if (providerId) {
      const rawResult = await queueCommandAndWait(deps, {
        hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "provider.list_models",
          providerId,
        },
      });
      return context.json(
        hostDaemonCommandResultSchemaByType["provider.list_models"].parse(rawResult).models,
      );
    }

    const providers = hostDaemonCommandResultSchemaByType["provider.list"].parse(
      await queueCommandAndWait(deps, {
        hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: { type: "provider.list" },
      }),
    ).providers;
    const models = await Promise.all(
      providers.map(async (provider) =>
        hostDaemonCommandResultSchemaByType["provider.list_models"].parse(
          await queueCommandAndWait(deps, {
            hostId,
            timeoutMs: COMMAND_TIMEOUT_MS,
            command: {
              type: "provider.list_models",
              providerId: provider.id,
            },
          }),
        ).models,
      ),
    );
    return context.json(models.flat());
  });

  post("/system/voice-transcription", async (context) => {
    if (!deps.config.openAiApiKey) {
      throw new ApiError(501, "not_configured", "Voice transcription requires OPENAI_API_KEY to be configured");
    }
    const formData = await context.req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new Error("Audio file is required");
    }
    return context.json({
      text: await transcribeVoiceInput({
        file,
        openAiApiKey: deps.config.openAiApiKey,
        prompt:
          typeof formData.get("prompt") === "string"
            ? String(formData.get("prompt"))
            : undefined,
      }),
    });
  });
}
