import { recordStatusSample } from "@/lib/statusHistory";
import { StatusComponent } from "@maipai/spec/gen/ts/status-component.js";

export type ServiceOutcome = "success" | "timeout" | "server_error" | "limited" | "error";
export type ServiceSample = { at: number; outcome: ServiceOutcome; errorClass: string | null };
export type ServiceHealthDetail = { last_success_at: string | null; last_error_class: string | null };

const WINDOW_MS = 60 * 60 * 1000;
const IDLE_MS = 6 * 60 * 60 * 1000;
const samples = new Map<string, ServiceSample[]>();
const details = new Map<string, ServiceHealthDetail>();
let lastInternetAt = 0;
const timeoutByMinute = new Map<number, Set<string>>();

function serviceId(host: string): string {
  const value = host.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return value || "unknown";
}

export function classifyServiceOutcome(error: unknown, status?: number): { outcome: ServiceOutcome; errorClass: string | null } {
  if (status === 429) return { outcome: "limited", errorClass: "http_429" };
  if (status !== undefined && status >= 500) return { outcome: "server_error", errorClass: `http_${status}` };
  if (status !== undefined && status >= 400) return { outcome: "error", errorClass: `http_${status}` };
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/timed out|timeout|abort/i.test(message) || name === "AbortError") return { outcome: "timeout", errorClass: "timeout" };
  if (/captcha|login_required|sign.?in|confirm you.re not a bot/i.test(message)) return { outcome: "limited", errorClass: "access_wall" };
  return { outcome: "error", errorClass: name };
}

function derive(rows: ServiceSample[], now = Date.now()): "operational" | "degraded" | "outage" | null {
  const recent = rows.filter((row) => now - row.at <= WINDOW_MS);
  if (!rows.length || now - rows.at(-1)!.at > IDLE_MS) return null;
  if (!recent.length) return "degraded";
  if (recent.at(-1)!.outcome === "limited") return "degraded";
  const failures = recent.filter((row) => row.outcome === "timeout" || row.outcome === "server_error");
  if (failures.length >= 3 && failures.slice(-3).every((row) => row.outcome === "timeout" || row.outcome === "server_error")) return "outage";
  if (recent.some((row) => row.outcome !== "success")) return "degraded";
  return "operational";
}

export async function recordServiceOutcome(host: string, result: { ok: boolean; status?: number; error?: unknown }, now = new Date()): Promise<void> {
  const id = serviceId(host);
  const component = `service:${id}`;
  if (!StatusComponent.safeParse(component).success) return;
  const classified = result.ok ? { outcome: "success" as const, errorClass: null } : classifyServiceOutcome(result.error, result.status);
  const rows = samples.get(id) ?? [];
  rows.push({ at: now.getTime(), ...classified });
  const bounded = rows.filter((row) => now.getTime() - row.at <= IDLE_MS).slice(-100);
  samples.set(id, bounded);
  if (classified.outcome === "timeout") {
    const minute = Math.floor(now.getTime() / 60_000);
    const hosts = timeoutByMinute.get(minute) ?? new Set<string>();
    hosts.add(id);
    timeoutByMinute.set(minute, hosts);
    for (const key of timeoutByMinute.keys()) if (minute - key > 2) timeoutByMinute.delete(key);
    if (hosts.size >= 3 && (!lastInternetAt || now.getTime() - lastInternetAt > 60_000)) {
      lastInternetAt = now.getTime();
      void recordStatusSample(now, "down");
    }
  }
  const previous = details.get(id) ?? { last_success_at: null, last_error_class: null };
  details.set(id, {
    last_success_at: result.ok ? now.toISOString() : previous.last_success_at,
    last_error_class: result.ok ? previous.last_error_class : classified.errorClass,
  });
  void recordStatusSample(now);
}

export function serviceState(component: string, now = Date.now()): "operational" | "degraded" | "outage" | "unknown" {
  if (!component.startsWith("service:")) return "unknown";
  const rows = samples.get(component.slice("service:".length)) ?? [];
  void now;
  return derive(rows, now) ?? "unknown";
}

export function serviceDetail(component: string): ServiceHealthDetail {
  return details.get(component.slice("service:".length)) ?? { last_success_at: null, last_error_class: null };
}

export function knownServiceComponents(): string[] {
  return [...samples.keys()].map((id) => `service:${id}`);
}

export function __resetServiceHealthForTests(): void { samples.clear(); details.clear(); timeoutByMinute.clear(); lastInternetAt = 0; }
