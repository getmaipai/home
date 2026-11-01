// TIER-HOME-05: Home's calls to the Max chat lease (GET, POST and DELETE /api/ai/chat-lease). Data only; nothing here draws.
import { requestJson } from "@/lib/api";

export interface ChatLeaseView {
  state: "off" | "starting" | "held" | "releasing";
  held_by_you: boolean;
  pinned: boolean;
  /** False for a teen, a child, a guest and an adult without a Max grant: the composer shows no control. */
  can_use: boolean;
  releases_in_seconds: number | null;
  /** Measured on this computer (median of recent runs), in seconds: how long Max takes to load and to self-test. */
  estimates?: { max_load_s: number; self_test_s: number };
}

export const chatLeaseApi = {
  get: () => requestJson<ChatLeaseView>("/api/ai/chat-lease"),
  /** The swap loads the big model, which takes a minute or more; the route answers when it is held or refused. */
  take: () => requestJson<ChatLeaseView>("/api/ai/chat-lease", { method: "POST", headers: { "content-type": "application/json" }, body: "{}", timeoutMs: 300_000 }),
  release: () => requestJson<ChatLeaseView>("/api/ai/chat-lease", { method: "DELETE", timeoutMs: 300_000 }),
};
