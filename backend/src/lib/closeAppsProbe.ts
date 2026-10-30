// MEM-SPACE-12: the setup wizard's permission test for Close apps. One harmless app is opened and asked to quit through the Mac app helper;
// if it quits, the helper can close apps and the wizard may offer Automatic. Anything else leaves the feature Off.
import { askHelper } from "@/lib/appHelperClient";

/** Calculator holds no documents, so quitting it loses nothing. */
export const HARMLESS_TEST_APP = "com.apple.calculator";
export type ProbeResult = "ok" | "no_helper" | "not_allowed";

type Ask = typeof askHelper;
const running = async (ask: Ask): Promise<boolean | null> => {
  const reply = await ask({ op: "list" });
  if (!reply || reply.ok !== true || !Array.isArray(reply.apps)) return null;
  return reply.apps.some((app) => (app as { bundleId?: string }).bundleId === HARMLESS_TEST_APP);
};

export async function probeCloseApps(ask: Ask = askHelper, pauseMs = 500): Promise<ProbeResult> {
  let isRunning = await running(ask);
  if (isRunning === null) return "no_helper";
  if (!isRunning) {
    await ask({ op: "reopen", bundleId: HARMLESS_TEST_APP });
    for (let i = 0; i < 10 && !isRunning; i++) {
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
      isRunning = await running(ask);
    }
    if (!isRunning) return "not_allowed";
  }
  const reply = await ask({ op: "quit", bundleId: HARMLESS_TEST_APP, waitSeconds: 10 }, undefined, 15_000);
  return reply?.ok === true && reply.outcome === "quit" ? "ok" : "not_allowed";
}
