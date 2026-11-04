/**
 * Only in-app absolute paths are accepted so the post-login redirect cannot be
 * pointed at an external origin.
 */
export function getRedirectTarget(state: unknown): string {
  if (typeof state !== "object" || state === null || !("from" in state)) {
    return "/";
  }

  const from = (state as { from?: unknown }).from;

  if (
    typeof from !== "string" ||
    !from.startsWith("/") ||
    from.startsWith("//") ||
    from === "/login" ||
    from === "/register"
  ) {
    return "/";
  }

  return from;
}
