import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export interface ApiErrorBody {
  code: string;
  message: string;
  retryable?: boolean;
  details?: unknown;
}

export class ApiError extends HTTPException {
  readonly code: string;
  readonly retryable: boolean;
  readonly details: unknown;

  constructor(
    status: ContentfulStatusCode,
    code: string,
    message: string,
    options?: { retryable?: boolean; details?: unknown },
  ) {
    super(status, { message });
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.details = options?.details;
  }

  toJSON(): ApiErrorBody {
    const body: ApiErrorBody = {
      code: this.code,
      message: this.message,
    };
    if (this.retryable) body.retryable = true;
    if (this.details !== undefined) body.details = this.details;
    return body;
  }
}
