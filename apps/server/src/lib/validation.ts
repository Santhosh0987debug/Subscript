import type { ZodType } from "zod";
import { AppError } from "../errors/app-error.js";

function validationError(message: string, issues: { path: PropertyKey[]; message: string }[]) {
  return new AppError(
    400,
    "VALIDATION_ERROR",
    message,
    issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    })),
  );
}

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);

  if (!result.success) {
    throw validationError("The request failed validation.", result.error.issues);
  }

  return result.data;
}

export function parseParams<T>(schema: ZodType<T>, params: unknown): T {
  const result = schema.safeParse(params);

  if (!result.success) {
    throw validationError("The request parameters are invalid.", result.error.issues);
  }

  return result.data;
}
