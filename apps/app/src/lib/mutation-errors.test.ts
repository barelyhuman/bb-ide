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
        showErrorToast: false,
      }),
    ).toEqual({
      errorMessage: "Failed to update thread.",
      showErrorToast: false,
    });
  });

  it("ignores unsupported meta shapes", () => {
    expect(
      getMutationErrorMeta({
        errorMessage: 123,
        showErrorToast: "nope",
      }),
    ).toEqual({});
    expect(getMutationErrorMeta(undefined)).toEqual({});
  });
});

describe("getMutationErrorMessage", () => {
  it("prefers the server contract message for HttpError instances", () => {
    const error = new HttpError({
      body: {
        code: "invalid_request",
        message: "Environment is not ready",
      },
      code: "invalid_request",
      message: "Environment is not ready",
      status: 409,
    });

    expect(
      getMutationErrorMessage({
        error,
        fallbackMessage: "Request failed.",
      }),
    ).toBe("Environment is not ready");
  });

  it("returns a friendly message for transport failures", () => {
    expect(
      getMutationErrorMessage({
        error: new TypeError("Failed to fetch"),
        fallbackMessage: "Request failed.",
      }),
    ).toBe(
      "Could not reach the server. Check that it is running and try again.",
    );
  });

  it("strips the HTTP status prefix when falling back to the HttpError message", () => {
    const error = new HttpError({
      code: "invalid_request",
      message: "Squash merge failed",
      status: 409,
    });

    expect(
      getMutationErrorMessage({
        error,
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

  it("allows non-abort errors", () => {
    expect(shouldShowMutationErrorToast(new Error("boom"))).toBe(true);
  });
});
