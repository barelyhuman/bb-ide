import { describe, expect, it } from "vitest";
import { HttpError } from "./api";
import {
  getMutationErrorMessage,
  getMutationErrorMeta,
  shouldShowMutationErrorToast,
} from "./mutation-errors";

describe("getMutationErrorMeta", () => {
  it("reads supported fields from mutation meta", () => {
    expect(
      getMutationErrorMeta({
        errorMessage: " Failed to update thread. ",
        lifecycleOperation: "send_message",
        showErrorToast: false,
      }),
    ).toEqual({
      errorMessage: "Failed to update thread.",
      lifecycleOperation: "send_message",
      showErrorToast: false,
    });
  });

  it("ignores unsupported meta shapes", () => {
    expect(
      getMutationErrorMeta({
        errorMessage: 123,
        lifecycleOperation: "nope",
        showErrorToast: "nope",
      }),
    ).toEqual({});
    expect(getMutationErrorMeta(undefined)).toEqual({});
  });

  it("uses lifecycle error descriptions before raw server messages", () => {
    const lifecycleError = new HttpError({
      body: {
        code: "thread_not_writable",
        message: "Thread is not active",
        details: {
          archivedAt: null,
          reason: "not_started",
          stopRequestedAt: null,
          threadStatus: "provisioning",
        },
      },
      code: "thread_not_writable",
      message: "Thread is not active",
      status: 409,
    });

    expect(
      getMutationErrorMessage({
        error: lifecycleError,
        fallbackMessage: "Failed to send message.",
        lifecycleOperation: "send_message",
      }),
    ).toBe("Failed to send message. The thread is still starting.");
  });
});

describe("getMutationErrorMessage", () => {
  it("uses explicit server messages before falling back to normalized transport messages", () => {
    const contractError = new HttpError({
      body: {
        code: "invalid_request",
        message: "Environment unavailable",
      },
      code: "invalid_request",
      message: "Environment unavailable",
      status: 409,
    });

    expect(
      getMutationErrorMessage({
        error: contractError,
        fallbackMessage: "Request failed.",
      }),
    ).toBe("Environment unavailable");
    expect(
      getMutationErrorMessage({
        error: new TypeError("Failed to fetch"),
        fallbackMessage: "Request failed.",
      }),
    ).toBe(
      "Could not reach the server. Check that it is running and try again.",
    );

    const fallbackHttpError = new HttpError({
      code: "invalid_request",
      message: "Squash merge failed",
      status: 409,
    });

    expect(
      getMutationErrorMessage({
        error: fallbackHttpError,
        fallbackMessage: "Request failed.",
      }),
    ).toBe("Squash merge failed");
  });
});

describe("shouldShowMutationErrorToast", () => {
  it("suppresses abort-like errors", () => {
    expect(
      shouldShowMutationErrorToast(
        new DOMException("The operation was aborted.", "AbortError"),
      ),
    ).toBe(false);
    expect(shouldShowMutationErrorToast({ name: "AbortError" })).toBe(false);
  });

});
