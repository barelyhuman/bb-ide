export interface SerializedError {
  type: string;
  message: string;
  stack?: string;
  code?: string;
  cause?: SerializedError | unknown;
}

export function serializeErrorWithCauses(error: unknown): SerializedError | unknown {
  if (!(error instanceof Error)) {
    return error;
  }

  const serialized: SerializedError = {
    type: error.name,
    message: error.message,
  };

  if (error.stack) {
    serialized.stack = error.stack;
  }

  const code = (error as NodeJS.ErrnoException).code;
  if (typeof code === "string") {
    serialized.code = code;
  }

  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause !== undefined) {
    serialized.cause = serializeErrorWithCauses(cause);
  }

  return serialized;
}
