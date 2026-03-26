import { Hono } from "hono";
import { getEnvironment } from "@bb/db";
import type { ServerDeps } from "../deps.js";
import { ApiError } from "../errors.js";
import { queueCommandAndWait } from "../command-wait.js";

export function createSystemRoutes(deps: ServerDeps) {
  const app = new Hono();

  app.get("/config", (c) => {
    return c.json({ hostDaemonPort: deps.hostDaemonPort });
  });

  app.get("/models", async (c) => {
    const providerId = c.req.query("providerId");
    const hostId = c.req.query("hostId");
    const environmentId = c.req.query("environmentId");

    // Resolve which host to query
    let targetHostId = hostId;
    if (!targetHostId && environmentId) {
      const env = getEnvironment(deps.db, environmentId);
      if (env) targetHostId = env.hostId;
    }

    if (!targetHostId) {
      // No host specified — return empty
      return c.json([]);
    }

    const command: Record<string, unknown> = {
      type: "provider.list_models",
      providerId: providerId ?? "default",
    };
    if (environmentId) command.environmentId = environmentId;

    const result = await queueCommandAndWait({
      db: deps.db,
      hub: deps.hub,
      hostId: targetHostId,
      command: command as { type: "provider.list_models"; [key: string]: unknown },
    });

    if (!result.ok) {
      throw new ApiError(502, result.errorCode ?? "command_failed", result.errorMessage ?? "Failed to list models");
    }

    const data = result.result as { models: unknown[] };
    return c.json(data.models);
  });

  app.get("/providers", async (c) => {
    const hostId = c.req.query("hostId");
    const environmentId = c.req.query("environmentId");

    let targetHostId = hostId;
    if (!targetHostId && environmentId) {
      const env = getEnvironment(deps.db, environmentId);
      if (env) targetHostId = env.hostId;
    }

    if (!targetHostId) {
      return c.json([]);
    }

    const result = await queueCommandAndWait({
      db: deps.db,
      hub: deps.hub,
      hostId: targetHostId,
      command: { type: "provider.list" as const },
    });

    if (!result.ok) {
      throw new ApiError(502, result.errorCode ?? "command_failed", result.errorMessage ?? "Failed to list providers");
    }

    const data = result.result as { providers: unknown[] };
    return c.json(data.providers);
  });

  app.post("/voice-transcription", async (c) => {
    if (!deps.openaiApiKey) {
      throw new ApiError(501, "unsupported_operation", "Voice transcription requires OPENAI_API_KEY");
    }

    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    if (!file) throw new ApiError(400, "invalid_request", "No audio file uploaded");

    if (file.size > 25 * 1024 * 1024) {
      throw new ApiError(400, "invalid_request", "Audio file too large (max 25MB)");
    }

    const prompt = formData.get("prompt") as string | null;

    // Forward to OpenAI Whisper API
    const openaiForm = new FormData();
    openaiForm.append("file", file);
    openaiForm.append("model", "gpt-4o-transcribe");
    if (prompt) openaiForm.append("prompt", prompt);

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${deps.openaiApiKey}`,
      },
      body: openaiForm,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new ApiError(502, "provider_rpc_error", `Transcription failed: ${text}`);
    }

    const data = (await response.json()) as { text: string };
    return c.json({ text: data.text });
  });

  return app;
}
