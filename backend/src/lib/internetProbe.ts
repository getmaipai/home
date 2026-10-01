import { lookup } from "node:dns/promises";
import { createConnection, isIP } from "node:net";
import { getHouseholdSettingValue } from "@/lib/settings";
import { INTERNET_PROBE_ENABLED_KEY, INTERNET_PROBE_DNS_NAME_KEY, INTERNET_PROBE_TCP_ADDRESS_KEY, INTERNET_PROBE_TCP_PORT_KEY } from "@/settings/coreKeys";

export type InternetState = "operational" | "degraded" | "down";
export type InternetProbeSettings = { enabled: boolean; dnsName: string; tcpAddress: string; tcpPort: number };
export type ProbeAdapters = { resolve: (name: string) => Promise<unknown>; connect: (address: string, port: number) => Promise<void> };
let consecutiveFailures = 0;

export function classifyInternetFailures(failures: number): InternetState {
  return failures >= 3 ? "down" : failures > 0 ? "degraded" : "operational";
}

const adapters: ProbeAdapters = {
  resolve: async (name) => lookup(name),
  connect: (address, port) => new Promise((resolve, reject) => {
    const socket = createConnection({ host: address, port });
    socket.once("connect", () => { socket.destroy(); resolve(); });
    socket.once("error", (error) => { socket.destroy(); reject(error); });
    socket.setTimeout(4000, () => { socket.destroy(new Error("connect timeout")); });
  }),
};

function withTimeout<T>(work: Promise<T>, milliseconds: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout`)), milliseconds);
    work.then((value) => { clearTimeout(timer); resolve(value); }, (error: unknown) => { clearTimeout(timer); reject(error); });
  });
}

export async function probeInternet(settings: InternetProbeSettings, injected: ProbeAdapters = adapters): Promise<InternetState | null> {
  if (!settings.enabled) return null;
  const tcp = isIP(settings.tcpAddress) ? injected.connect(settings.tcpAddress, settings.tcpPort) : Promise.reject(new Error("TCP check address must be an IP address"));
  const results = await Promise.allSettled([
    withTimeout(injected.resolve(settings.dnsName), 4_000, "DNS lookup"),
    withTimeout(tcp, 4_000, "TCP connect"),
  ]);
  if (results.every((result) => result.status === "fulfilled")) consecutiveFailures = 0;
  else consecutiveFailures++;
  return classifyInternetFailures(consecutiveFailures);
}

export async function runConfiguredInternetProbe(): Promise<InternetState | null> {
  const settings: InternetProbeSettings = {
    enabled: getHouseholdSettingValue(INTERNET_PROBE_ENABLED_KEY) !== false,
    dnsName: String(getHouseholdSettingValue(INTERNET_PROBE_DNS_NAME_KEY) ?? "example.com"),
    tcpAddress: String(getHouseholdSettingValue(INTERNET_PROBE_TCP_ADDRESS_KEY) ?? "1.1.1.1"),
    tcpPort: Number(getHouseholdSettingValue(INTERNET_PROBE_TCP_PORT_KEY) ?? 443),
  };
  return probeInternet(settings);
}

export function __resetInternetProbeForTests(): void { consecutiveFailures = 0; }
