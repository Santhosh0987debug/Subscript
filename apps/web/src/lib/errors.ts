import { ApiClientError } from "@/lib/api";

export function getErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  if (error instanceof ApiClientError) {
    return error.message;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallback;
}

export function getFieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiClientError)) {
    return {};
  }

  return error.details.reduce<Record<string, string>>((fields, issue) => {
    if (!(issue.path in fields)) {
      fields[issue.path] = issue.message;
    }

    return fields;
  }, {});
}

export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 401;
}
