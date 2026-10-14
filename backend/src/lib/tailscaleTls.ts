import type { TsCert } from "@/lib/tailscale";

const listeners: Array<(cert: TsCert) => void> = [];
export function onTsLeafRenewed(listener: (cert: TsCert) => void): void { listeners.push(listener); }
export function notifyTsLeafRenewed(cert: TsCert): void { for (const listener of listeners) listener(cert); }
