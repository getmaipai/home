import { errorLine } from "@/lib/hubReachability";

const networkError = "Could not reach Home. Check your connection and try again.";
/** One plain sentence for any failure: Home's own sentence when it sent one, otherwise what to check. */
export const flowErrorText = (error: unknown) => errorLine(error, networkError);
