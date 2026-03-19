import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateOpenAIResponsesText } from "../openai-responses-model.js";

describe("generateOpenAIResponsesText", () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-api-key";
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
    vi.unstubAllGlobals();
  });

  it("retries without temperature when the model rejects that parameter", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(
        JSON.stringify({
          error: {
            message: "Unsupported parameter: 'temperature' is not supported with this model.",
          },
        }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      ))
      .mockResolvedValueOnce(new Response(
        [
          "event: response.completed",
          "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_123\",\"output_text\":\"{\\\"title\\\":\\\"Fix Login\\\"}\"}}",
          "",
        ].join("\n"),
        {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        },
      ));

    const result = await generateOpenAIResponsesText({
      prompt: "derive a title",
      temperature: 0,
    });

    expect(result.text).toBe("{\"title\":\"Fix Login\"}");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as Record<string, unknown>;

    expect(firstBody.temperature).toBe(0);
    expect(secondBody).not.toHaveProperty("temperature");
  });
});
