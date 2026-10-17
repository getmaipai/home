// Runs the health checks once against a Stack from a scratch Home. Read-only: no picture check, no writes to the Stack.
// Needs MAIPAI_DATA_DIR set to a scratch directory. Prints pass or fail per check, never reply text.
import { setHouseholdSettingValue } from "@/lib/settings";
import { runSuite } from "@/lib/canary/runner";
import { realDeps } from "@/lib/canary/probes";
import { ORDER } from "@/lib/canary/schedule";

if (!process.env.MAIPAI_DATA_DIR || /\/Library\/Application Support|\/\.maipai\//.test(process.env.MAIPAI_DATA_DIR)) throw new Error("Set MAIPAI_DATA_DIR to a scratch directory.");
const url = process.env.CANARY_STACK_URL ?? "http://127.0.0.1:8770";
setHouseholdSettingValue("engines.stack.url", url);
const only = ORDER.filter((id) => id !== "image_tiny");
const out = await runSuite(realDeps, { reason: "manual", only });
for (const r of out) console.log(`${r.status.toUpperCase().padEnd(7)} ${r.id.padEnd(20)} ${String(r.durationMs).padStart(6)} ms  first token ${r.firstTokenMs ?? "-"}  ${r.note ?? ""}`);
process.exit(0);
