import type { Role } from "@/middleware/auth";
import type { AgeBand } from "@/lib/ageBand";

export type Approver = "none" | "self" | "parent" | "never";
export type DenyReason = "min_band" | "grant_denied" | "crisis_state" | "temporary_mode" | "anonymous_speaker" | "never_for_band";
export type GateDecision =
  | { kind: "allow"; audit: { capabilities: string[]; band: AgeBand } }
  | { kind: "ask_self"; prompt: string; audit: { capabilities: string[]; band: AgeBand } }
  | { kind: "ask_parent"; summary: string; audit: { capabilities: string[]; band: AgeBand } }
  | { kind: "deny"; reason: DenyReason; audit: { capabilities: string[]; band: AgeBand } };

export interface GateRequest {
  who: { personId: string; role: Role; band: AgeBand; anonymous?: boolean };
  what: { capabilities: string[]; summary?: string; consequential?: boolean; minRole?: string; denied?: boolean };
  context?: { crisis?: boolean; temporary?: boolean };
}
