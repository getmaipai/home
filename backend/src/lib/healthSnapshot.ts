import { emptyLengthRetryCount } from "@/lib/reasoningReserve";
import { getEngineStatus } from "@/lib/llmSupervisor";
import { listSidecars } from "@/lib/sidecars";
import { roleHealth, roleHealthEntry, localRoleHealthEntry } from "@/lib/roleHealth";
import { composerNotice, makingNotice, type ChatPauseCause, type MakingCause } from "@/lib/failureCopy";
import { chatPausedByAdmin, chatPauseMessage } from "@/lib/chatPause";

// CHAT-PAUSE-01: a Stack that stays unreachable for a minute is no longer
// "restarting"; the line then sends the person to Repairs.
const RESTART_GRACE_MS = 60_000;
let unreachableSince: number | null = null;
export function __resetChatPauseTrackingForTests(): void { unreachableSince = null; }

// This is the single live health snapshot used by both /api/health and
// status history. Keep its payload aligned with frontend chatAvailability
// and backend statusHistory.componentStatesFrom, which mirror that rule.
export async function collectHealth() {
  const roles = ["chat", "embed", "background", "voice", "image", "video"] as const;
  const [locals, states] = await Promise.all([
    Promise.all(roles.map((role) => localRoleHealthEntry(role))),
    Promise.all(roles.map((role) => roleHealth(role))),
  ]);
  const chat = roleHealthEntry("chat", locals[0]!, states[0]!);
  if (chat.context_per_slot == null) chat.context_message = "I could not read how much the AI can hold, so I am using a safe small window";
  // CHAT-CALM-ERRORS-01d: the one composer line while chat cannot answer.
  let cause: ChatPauseCause | null = chat.cause ?? null;
  if (cause === "restarting") {
    unreachableSince ??= Date.now();
    if (Date.now() - unreachableSince > RESTART_GRACE_MS) cause = "offline";
  } else {
    unreachableSince = null;
  }
  if (chatPausedByAdmin()) {
    chat.availability = "unavailable";
    chat.cause = "paused_by_admin";
    cause = "paused_by_admin";
  }
  const notice = composerNotice(chat.availability ?? "ready", cause, chatPauseMessage());
  if (notice) chat.notice = notice;
  const embed = roleHealthEntry("embed", locals[1]!, states[1]!);
  const background = roleHealthEntry("background", locals[2]!, states[2]!);
  const voice = roleHealthEntry("voice", locals[3]!, states[3]!);
  // ENGINE-STATUS-MEDIA-01: picture and video making. Each row carries its own per-band line (failureCopy.ts's makingNotice). A Stack
  // that has not answered for the same minute chat allows reads "isn't answering" here too. These rows never change `ok`: a computer
  // that cannot make videos is not an outage.
  const [image, video] = (["image", "video"] as const).map((role, index) => {
    const entry = roleHealthEntry(role, locals[4 + index]!, states[4 + index]!);
    let makingCause: MakingCause | null = entry.cause && entry.cause !== "paused_by_admin" ? entry.cause : null;
    if (makingCause === "restarting" && cause === "offline") { entry.availability = "unavailable"; entry.kind = "failed"; entry.alive = false; entry.cause = "offline"; makingCause = "offline"; }
    const line = makingNotice(role, entry.availability ?? "ready", makingCause);
    if (line) entry.notice = line;
    return entry;
  }) as [typeof chat, typeof chat];
  const sidecars = listSidecars();
  const ok =
    [chat, embed, background, voice].every((e) => e.alive !== false && e.kind !== "failed" && e.kind !== "restarting" && e.kind !== "blocked" && e.kind !== "stalled") &&
    sidecars.every((s) => s.status !== "unhealthy" && s.status !== "crashed");
  return { llm: { empty_length_retry: emptyLengthRetryCount() }, sidecars, brain: getEngineStatus().kind, voice: "stack", ok, engines: { chat, embed, background, voice, image, video }, uptimeSeconds: process.uptime() };
}

export type HealthSnapshot = Awaited<ReturnType<typeof collectHealth>>;
