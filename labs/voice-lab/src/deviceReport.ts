// What the page may write into the lab log about an iPhone run: short plain fields only. No secret, no free text beyond 120 characters, nothing nested.
const KEEP = ["event", "did", "fix", "pass", "ctxState", "ctxRate", "micRate", "echoCancel", "noiseSuppression", "autoGain", "echoCancellation", "autoGainControl", "ios", "secure", "worklet", "micLevel", "micLevelPeak", "toneHeard", "roundTripMs", "outputLatencyMs", "baseLatencyMs", "hidden", "micError"];
export function sanitizeDeviceReport(body: any, ua: string) {
  const out: Record<string, string | number | boolean> = { ua: ua.slice(0, 120) };
  if (body && typeof body === "object") for (const k of KEEP) { const v = body[k]; if (typeof v === "number" && Number.isFinite(v)) out[k] = v; else if (typeof v === "boolean") out[k] = v; else if (typeof v === "string") out[k] = v.slice(0, 120); }
  return out;
}
