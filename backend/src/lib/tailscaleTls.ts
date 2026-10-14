import type { TsCert } from "@/lib/tailscale";

const listeners: Array<(cert: TsCert) => void> = [];
export function onTsLeafRenewed(listener: (cert: TsCert) => void): () => void {
  listeners.push(listener);
  return () => { const index = listeners.indexOf(listener); if (index >= 0) listeners.splice(index, 1); };
}
export function notifyTsLeafRenewed(cert: TsCert): void { for (const listener of listeners) listener(cert); }
