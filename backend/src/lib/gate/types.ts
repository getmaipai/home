import type { Role } from "@/middleware/auth";
import type { AgeBand } from "@/lib/ageBand";

export type Approver = "none" | "self" | "parent" | "never";
export type Provenance = "person" | "untrusted";
export type DenyReason =
  | "min_band"
  | "grant_denied"
  | "crisis_state"
  | "temporary_mode"
  | "anonymous_speaker"
  | "never_for_band"
  | "tainted_action"
  | "needs_parent_unavailable";

export interface GateAudit {
  capabilities: string[];
  band: AgeBand;
  provenance: Provenance;
}

export type GateDecision =
  | { kind: "allow"; audit: GateAudit }
  | { kind: "allow_with_limits"; limits: string[]; audit: GateAudit }
  | { kind: "ask_self"; prompt: string; audit: GateAudit }
  | { kind: "ask_parent"; summary: string; audit: GateAudit }
  | { kind: "deny"; reason: DenyReason; audit: GateAudit };

export interface GateRequest {
  who: { personId: string; role: Role; band: AgeBand; anonymous?: boolean };
  what: {
    capabilities: string[];
    parameters?: Record<string, string>;
    summary?: string;
    consequential?: boolean;
    minRole?: string;
    denied?: boolean;
  };
  context?: {
    crisis?: boolean;
    temporary?: boolean;
    incognito?: boolean;
    incognitoBlocked?: boolean;
    provenance?: Provenance;
  };
}
