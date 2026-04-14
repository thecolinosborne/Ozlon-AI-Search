import { toast } from "sonner";

/**
 * Extract a human-readable message from an unknown error.
 */
export function getErrorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return fallback;
}

/**
 * Standard error handler: logs to console and optionally shows a toast.
 *
 * Usage:
 *   catch (error) { handleError(error, "Failed to save profile"); }
 *   catch (error) { handleError(error, "Load failed", { silent: true }); }  // log only
 */
export function handleError(
  error: unknown,
  fallback = "Something went wrong",
  options?: { silent?: boolean; tag?: string },
): string {
  const message = getErrorMessage(error, fallback);
  const prefix = options?.tag ? `[${options.tag}] ` : "";

  console.error(`${prefix}${fallback}:`, error);

  if (!options?.silent) {
    toast.error(message);
  }

  return message;
}
