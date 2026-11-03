import type { ApiErrorCode } from "@subscript/shared";

export type HttpStatusCode = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503;

/**
 * An expected application error whose message is safe to expose to API clients.
 */
export class AppError extends Error {
  readonly statusCode: HttpStatusCode;
  readonly code: ApiErrorCode;

  constructor(statusCode: HttpStatusCode, code: ApiErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
  }
}
