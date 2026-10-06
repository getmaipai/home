import { getEngineStatus } from "@/lib/llmSupervisor";
import { listSidecars } from "@/lib/sidecars";
import { roleHealth, roleHealthEntry, localRoleHealthEntry } from "@/lib/roleHealth";
import { composerNotice } from "@/lib/failureCopy";

// This is the single live health snapshot used by both /api/health and
// status history. Keep its payload aligned with frontend chatAvailability
// and backend statusHistory.componentStatesFrom, which mirror that rule.
export async function collectHealth() {
  const roles = ["chat", "embed", "background", "voice"] as const;
  const [locals, states] = await Promise.all([
    Promise.all(roles.map((role) => localRoleHealthEntry(role))),
    Promise.all(roles.map((role) => roleHealth(role))),
  ]);
  const chat = roleHealthEntry("chat", locals[0]!, states[0]!);
  if (chat.context_per_slot == null) chat.context_message = "I could not read how much the AI can hold, so I am using a safe small window";
  // CHAT-CALM-ERRORS-01d: the one composer line while chat cannot answer.
  const notice = composerNotice(chat.availability ?? "ready");
  if (notice) chat.notice = notice;
  const embed = roleHealthEntry("embed", locals[1]!, states[1]!);
  const background = roleHealthEntry("background", locals[2]!, states[2]!);
  const voice = roleHealthEntry("voice", locals[3]!, states[3]!);
  const sidecars = listSidecars();
  const ok =
    [chat, embed, background, voice].every((e) => e.alive !== false && e.kind !== "failed" && e.kind !== "restarting" && e.kind !== "blocked" && e.kind !== "stalled") &&
    sidecars.every((s) => s.status !== "unhealthy" && s.status !== "crashed");
  return { sidecars, brain: getEngineStatus().kind, voice: "stack", ok, engines: { chat, embed, background, voice }, uptimeSeconds: process.uptime() };
}

export type HealthSnapshot = Awaited<ReturnType<typeof collectHealth>>;
