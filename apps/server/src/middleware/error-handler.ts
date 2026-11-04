import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import type { ApiErrorCode, ApiErrorResponse, ApiFieldIssue } from "@subscript/shared";
import { AppError, type HttpStatusCode } from "../errors/app-error.js";
import { logger } from "../lib/logger.js";

interface BodyParserError extends SyntaxError {
  status: number;
}

function isBodyParserError(error: unknown): error is BodyParserError {
  return (
    error instanceof SyntaxError &&
    "status" in error &&
    error.status === 400
  );
}

function errorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return { value: String(error) };
}

/**
 * Converts every unhandled error into the shared API error envelope.
 * Internal details are logged but never sent to clients.
 */
export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  let status: HttpStatusCode = 500;
  let code: ApiErrorCode = "INTERNAL_ERROR";
  let message = "An unexpected error occurred.";
  let details: ApiFieldIssue[] | undefined;

  if (error instanceof AppError) {
    status = error.statusCode;
    code = error.code;
    message = error.message;
    details = error.details;
  } else if (isBodyParserError(error)) {
    status = 400;
    code = "BAD_REQUEST";
    message = "The request body is not valid JSON.";
  } else if (error instanceof ZodError) {
    status = 400;
    code = "VALIDATION_ERROR";
    message = "The request failed validation.";
  }

  const requestIdValue = String(res.locals.requestId ?? "unknown");

  const context = {
    requestId: requestIdValue,
    method: req.method,
    path: req.path,
    status,
    code,
  };

  if (status >= 500) {
    logger.error("Request failed", { ...context, error: errorDetails(error) });
  } else {
    logger.warn("Request rejected", context);
  }

  const payload: ApiErrorResponse = {
    error: {
      code,
      message,
      requestId: requestIdValue,
      ...(details ? { details } : {}),
    },
  };

  res.status(status).json(payload);
};
