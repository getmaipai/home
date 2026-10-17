import { OfflineManifest } from "@maipai/spec/gen/ts/offline-manifest.js";
import type { PersonRow } from "@/types";

/** Providers must check the person's access on every call, including artwork and other assets. No network fetch on a keep. */
export interface OfflineProvider {
  kind: string;
  /** Required, so no provider can skip an age or screen-time policy. A person-level refusal checked before every manifest and file (for media: a minor's screen time). Its code reaches the
   * client, which keeps existing copies for any code other than device_revoked. */
  refuse(person: PersonRow): { error: string; code: string } | null;
  manifest(person: PersonRow, id: string): OfflineManifest | null | Promise<OfflineManifest | null>;
  file(person: PersonRow, entryId: string, request: Request): Response | Promise<Response>;
}
const providers = new Map<string, OfflineProvider>();
export function registerOfflineProvider(provider: OfflineProvider): void {
  if (!/^[a-z][a-z0-9_]*$/.test(provider.kind)) throw new Error("This offline kind is invalid. Register a kind using lowercase letters, numbers or underscores.");
  if (typeof provider.refuse !== "function") throw new Error("This offline provider has no refuse check. Give every provider an age and screen-time refusal, even one that always allows.");
  if (providers.has(provider.kind)) throw new Error("This offline kind is already registered. Keep one provider for each kind.");
  providers.set(provider.kind, provider);
}
export function offlineProvider(kind: string): OfflineProvider | undefined {
  return providers.get(kind);
}
