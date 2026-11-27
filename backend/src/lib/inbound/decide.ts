import { isAdultBand } from "@/lib/audience";

// Outside messages are untrusted input, so every decision is tainted, tools are default-deny, and the speaker is a household member only through a numeric-id binding.
export interface Binding {
  externalId: string;
  personId: string;
  band: "child" | "teen" | "adult";
  capabilities: string[];
  revoked?: boolean;
}

export interface Inbound {
  senderId: string;
  isGroup: boolean;
}

export type InboundReason = "bound" | "no-binding" | "group" | "revoked" | "id-mismatch";

export interface InboundDecision {
  speaker: "member" | "unknown";
  personId: string | null;
  band: "child" | "teen" | "adult";
  tools: string[];
  tainted: true;
  reason: InboundReason;
}

const unknownDecision = (reason: Exclude<InboundReason, "bound">): InboundDecision => ({
  speaker: "unknown",
  personId: null,
  band: "child",
  tools: [],
  tainted: true,
  reason,
});

export function decideInbound(bindings: readonly Binding[], inbound: Inbound): InboundDecision {
  if (inbound.isGroup) return unknownDecision("group");
  if (!/^[0-9]+$/.test(inbound.senderId)) return unknownDecision("id-mismatch");

  const matches = bindings.filter((binding) => binding.externalId === inbound.senderId);
  if (matches.length !== 1) return unknownDecision("no-binding");

  const binding = matches[0];
  if (!binding) return unknownDecision("no-binding");
  if (binding.revoked) return unknownDecision("revoked");

  return {
    speaker: "member",
    personId: binding.personId,
    band: binding.band,
    tools: isAdultBand(binding.band) ? [...binding.capabilities] : [],
    tainted: true,
    reason: "bound",
  };
}
