import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export interface EngineHealth {
  brain: string;
  voice: string;
}

// The one poll of /api/health (getEngineStatus().kind on the backend) -
// SensesDock's status pill and the composer's ready-to-send gate both
// read this same state instead of each polling on their own.
export function useEngineHealth(): EngineHealth | undefined {
  const [health, setHealth] = useState<EngineHealth>();
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await api.senses();
        if (active) setHealth(result);
      } catch {
        if (active) setHealth({ brain: "unreachable", voice: "unreachable" });
      }
      if (active) timer = setTimeout(() => void poll(), 10_000);
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  return health;
}

// "starting" is the bug this exists to close (Jesse, 2026-09-06: the
// composer stayed usable while the pill above it read "Starting…" with
// nothing gating it); "stopped" gets the same treatment since sending
// then can only ever fail with the same "isn't answering" error
// (chatModelAdapter.ts). Every other kind (a live backend, "none"/"stub"
// - which start on demand - or a transient "unreachable" health check)
// stays sendable: blocking on a health-check hiccup would be a worse
// regression than the one being fixed.
export function brainBlockReason(kind: string | undefined): string | undefined {
  if (kind === "starting") return "MaiPai's AI is starting up. This can take a moment.";
  if (kind === "stopped") return "MaiPai's AI is stopped. An admin can restart it in Settings → AI models.";
  return undefined;
}
