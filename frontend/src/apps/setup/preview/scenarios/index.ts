import type { SetupState } from "@maipai/spec/gen/ts/setup-state.js";
import type { Scenario, CheckRow } from "./types";

const now = "2026-10-14T12:00:00.000Z";
const ids = ["welcome", "engine_location", "storage", "checks", "plan", "away", "owner", "face", "profile", "hello", "backup_key", "done"] as const;
function freshState(): SetupState {
  return { id: "preview-setup", source: "wizard", steps: ids.map((id) => ({ id, status: "pending", at: now })), phase: "computers", engine: { where: "this_computer", hardware: {} }, away: "later", plan: { option: "recommended", tier: "minimal", roles: [] }, checks: [], started_at: now, completed_at: null, hlc: "1791979200000:0:abcdef" };
}
const green = (id: string, title: string): CheckRow => ({ id, title, state: "green", text: "Ready." });
const checks: CheckRow[] = [green("engine", "AI engine"), green("memory", "Memory"), green("disk", "Disk space"), green("network", "Network"), green("nvidia", "NVIDIA memory"), green("clock", "System clock"), green("lan", "Home network"), green("web-search", "Web search"), green("storage", "Storage"), green("tailnet", "Away access"), green("certificate", "Secure address"), green("packages", "Starter apps")];
function base(id: string, label: string): Scenario {
  return { id, label, state: freshState(), checks, searchCandidate: null, tailscale: { state: "not_installed", dnsName: null, ips: [], installed: false, signedIn: false, httpsEnabled: false, machineName: null, enabled: false, url: null }, certificate: { certificate: "-----BEGIN CERTIFICATE-----\nPREVIEW\n-----END CERTIFICATE-----" }, backup: { hubName: "MaiPai Home", hubInstanceId: "preview-hub", backupKeyHex: "demo-preview-key", generatedAt: now } };
}
const scenarios: Scenario[] = [];
function add(s: Scenario) { scenarios.push(s); }

add(base("happy-local", "Happy path — this computer"));
const remote = base("remote-tailnet", "Engine link asks to allow Tailscale");
remote.checks = remote.checks.map((row) => row.id === "tailnet" ? { ...row, state: "amber", text: "The engine link uses a Tailscale address. Allow Home to use it?", action: "allow_tailnet", actionLabel: "Allow Tailscale", actionRoute: "setup" } : row);
add(remote);
for (const [id, label, rowId, title, text] of [
  ["nvidia-fallback", "NVIDIA fallback", "nvidia", "NVIDIA system memory", "Some model layers may use slower system memory."],
  ["clock-off", "Clock warning", "clock", "System clock", "The system clock may be out of sync."],
  ["lan-blocked", "LAN access blocked", "lan", "Home network", "Other devices may not be able to reach Home."],
  ["search-amber", "Web search unavailable", "web-search", "Web search", "Home's private search is unavailable. Offline answers still work."],
] as const) {
  const s = base(id, label);
  s.checks = s.checks.map((row) => row.id === rowId ? { ...row, title, text, state: "amber" } : row);
  add(s);
}
const engineDown = base("engine-down", "AI engine unavailable");
engineDown.checks = engineDown.checks.map((row) => row.id === "engine" ? { ...row, state: "red", title: "AI engine", text: "The AI engine did not start.", action: "restart_engine", actionLabel: "Repair" } : row);
add(engineDown);
for (const [id, label, progress] of [
  ["slow-download", "Slow download — 50 Mbit/s", { bytesPerSecond: 6_250_000, state: "running" as const, percent: 34 }],
  ["stall", "Download stalled", { bytesPerSecond: 0, state: "stalled" as const, percent: 12 }],
] as const) { const s = base(id, label); s.progress = progress; add(s); }
const owner = base("owner-exists", "Home already has an owner"); owner.ownerConflict = true; add(owner);
const restore = base("restore", "Restore from backup"); if (!("done" in restore.state)) restore.state.source = "restore"; add(restore);

export const scenarioList = scenarios;
export function getScenario(id: string): Scenario { return scenarios.find((scenario) => scenario.id === id) ?? scenarios[0]!; }
