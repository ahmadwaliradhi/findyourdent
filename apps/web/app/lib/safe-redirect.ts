/** Same-site path or "/", so a redirectTo parameter can never send the browser elsewhere. */
export function safeRedirect(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return "/";
  }
  return value;
}
