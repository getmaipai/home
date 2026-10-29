import { ApiError } from "@/lib/api";

const networkError = "Could not reach Home. Check your connection and try again.";
/** One plain sentence for any failure: Home's own sentence when it sent one, otherwise what to check. */
export const flowErrorText = (error: unknown) => error instanceof ApiError ? error.message : networkError;
