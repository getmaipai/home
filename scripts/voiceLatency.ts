import { voiceTimingReport } from "../backend/src/lib/voiceTiming";

const requested = Number(process.argv[2] ?? 50);
const limit = Number.isInteger(requested) && requested > 0 ? Math.min(200, requested) : 50;
console.log(voiceTimingReport(limit));
