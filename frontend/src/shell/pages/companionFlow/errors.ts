import { i18n } from "@lingui/core";
import { errorLine } from "@/lib/hubReachability";

const networkError = () => i18n._({ id: "Could not reach Home. Check your connection and try again.", message: "Could not reach Home. Check your connection and try again." });
/** One plain sentence for any failure: Home's own sentence when it sent one, otherwise what to check. */
export const flowErrorText = (error: unknown) => errorLine(error, networkError());
