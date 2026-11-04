import type { ApiErrorCode, ApiFieldIssue } from "@subscript/shared";

export type HttpStatusCode =
  | 400
  | 401
  | 403
  | 404
  | 409
  | 422
  | 429
  | 500
  | 503;

/**
 * An expected application error whose message is safe to expose to API clients.
 */
export class AppError extends Error {
  readonly statusCode: HttpStatusCode;
  readonly code: ApiErrorCode;
  readonly details: ApiFieldIssue[] | undefined;

  constructor(
    statusCode: HttpStatusCode,
    code: ApiErrorCode,
    message: string,
    details?: ApiFieldIssue[],
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
