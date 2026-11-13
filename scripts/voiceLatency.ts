import { voiceTimingReport } from "../backend/src/lib/voiceTiming";
import { formatVoiceTrace, voiceTraces } from "../backend/src/lib/voiceTrace";

import { existsSync, accessSync, constants } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../backend/src/lib/paths";
const file = join(dataDir, "local-app", "voice-timing.json");
if (existsSync(file)) { try { accessSync(file, constants.R_OK); } catch { console.error(`voice:latency: ${file} exists but this account cannot read it (an older hub wrote it private). It becomes readable after the next spoken turn on a hub that has this fix.`); process.exit(1); } }
const requested = Number(process.argv[2] ?? 50);
const limit = Number.isInteger(requested) && requested > 0 ? Math.min(200, requested) : 50;
// VOICE-TRACE-01: `bun run voice:latency --trace` prints the owner's live voice traces (names and numbers only) from local-app/voice-trace.json.
if (process.argv.includes("--trace")) {
  const traces = voiceTraces();
  console.log(traces.length ? traces.map((trace) => formatVoiceTrace(trace)).join("\n\n") : "no voice traces yet: open the chat page with ?voicetrace=10 as the owner, start a call, and speak");
} else console.log(voiceTimingReport(limit));
