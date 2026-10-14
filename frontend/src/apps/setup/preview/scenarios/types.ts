import type { SetupState } from "@maipai/spec/gen/ts/setup-state.js";

export type CheckRow = { id: string; title: string; state: "green" | "amber" | "red" | "idle"; text: string; action?: string; actionLabel?: string; actionRoute?: "settings" | "setup" };
export type Scenario = {
  id: string;
  label: string;
  state: SetupState | { done: true };
  checks: CheckRow[];
  searchCandidate: string | null;
  tailscale: { state: "not_installed" | "stopped" | "running"; dnsName: string | null; ips: string[]; installed: boolean; signedIn: boolean; httpsEnabled: boolean; machineName: string | null; enabled: boolean; url: string | null };
  certificate: { certificate: string };
  backup: { hubName: string; hubInstanceId: string; backupKeyHex: string; generatedAt: string };
  ownerConflict?: boolean;
  progress?: { bytesPerSecond: number; state: "running" | "stalled" | "failed"; percent: number };
};
