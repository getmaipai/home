import { useEffect, useState, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Button } from "@/kit/ui/button";
import { getIcon } from "@/kit/icons";
import { useChatListenStore } from "./chatListenStore";
import type { EngineHealth } from "./useEngineHealth";
import { cn } from "@/kit/utils";

export type ReplyState = "idle" | "waiting" | "responding" | "ready" | "error";
export type EarState = "idle" | "starting" | "listening" | "error";
// "active" vs. "busy" (Jesse, 2026-09-07): pulsing amber reads as a
// warning even when nothing is wrong - the model actively generating a
// reply is the normal, healthy case, not a caution state. "active" (blue,
// still pulsing) is for exactly that; "busy" (amber, still pulsing) stays
// for the states that genuinely warrant a second look - a cold model load
// or a reply running unusually long.
type Tone = "quiet" | "good" | "active" | "busy" | "bad";
interface Sense { name: string; icon: string; state: string; detail: string; tone: Tone }
const tones: Record<Tone, string> = {
  quiet: "text-muted-foreground",
  good: "text-emerald-600 dark:text-emerald-400",
  active: "text-blue-600 dark:text-blue-400",
  busy: "text-amber-600 dark:text-amber-400",
  bad: "text-red-600 dark:text-red-400",
};

export function serviceSense(kind: string | undefined, name: string, icon: string): Sense {
  if (!kind) return { name, icon, state: "Checking", detail: "Checking the hub’s status…", tone: "quiet" };
  if (kind === "unreachable") return { name, icon, state: "Unreachable", detail: "Cannot check the hub. Check your connection; status will refresh automatically.", tone: "bad" };
  if (kind === "stopped") return { name, icon, state: "Stopped", detail: "The AI is stopped. Restart it in Settings → AI models.", tone: "bad" };
  if (kind === "starting") return { name, icon, state: "Starting", detail: "The model is loading. This can take a moment.", tone: "busy" };
  if (kind === "none" || kind === "stub") return { name, icon, state: kind === "stub" ? "Demo mode" : "Standby", detail: kind === "stub" ? "A demo service is selected, not a live model." : "The service has not started yet. It starts when needed.", tone: "quiet" };
  return { name, icon, state: "Loaded", detail: "The service is loaded. Its response will be checked when you use it.", tone: "good" };
}

export function SensesDock({ health, reply, speaking, speechError, ears, earError, children }: { health: EngineHealth | undefined; reply: ReplyState; speaking: boolean; speechError: boolean; ears: EarState; earError: string | null; children?: ReactNode }) {
  const [slow, setSlow] = useState(false);
  const replay = useChatListenStore();
  useEffect(() => {
    setSlow(false);
    if (reply !== "waiting" && reply !== "responding") return;
    const timer = setTimeout(() => setSlow(true), 45_000);
    return () => clearTimeout(timer);
  }, [reply]);
  let brain = serviceSense(health?.brain, "Brain", "brain");
  if (reply === "error") brain = { ...brain, state: "Reply failed", tone: "bad", detail: "MaiPai could not finish your reply. Try again. If it keeps happening, check Settings → AI models. The model or its connection may need attention." };
  else if (slow) brain = { ...brain, state: "Taking longer", tone: "busy", detail: "This reply has been running for over 45 seconds. The model may be busy or the connection may be stalled. You can stop the reply and try again." };
  else if (reply === "waiting" || reply === "responding") brain = { ...brain, state: reply === "waiting" ? "Thinking" : "Replying", tone: "active", detail: reply === "waiting" ? "Waiting for the first response from MaiPai." : "MaiPai is generating your reply." };
  let voice = serviceSense(health?.voice, "Mouth", "speech");
  if (speechError || replay.errorId) voice = { ...voice, state: "Playback failed", tone: "bad", detail: "Speech could not be generated or played. Your text reply is still available. Try Listen again or check your voice settings." };
  else if (speaking || replay.playingId) voice = { ...voice, state: "Speaking", tone: "good", detail: "MaiPai is reading a reply aloud." };
  else if (replay.loadingId) voice = { ...voice, state: "Preparing audio", tone: "active", detail: "Preparing this reply for playback." };
  const listening: Sense = { name: "Ears", icon: "ear", state: ears === "listening" ? "Wake word on" : ears === "error" ? "Mic unavailable" : ears === "starting" ? "Starting" : "Mic off", tone: ears === "error" ? "bad" : ears === "listening" ? "good" : ears === "starting" ? "busy" : "quiet", detail: `${earError && ears === "error" ? earError : ears === "listening" ? 'Listening for “hey jarvis”.' : ears === "starting" ? "Starting the microphone and wake-word detector." : "Enable Wake word below to listen for a wake phrase."} Continued hands-free conversation is not available yet.` };
  const label = brain.tone === "bad" || brain.tone === "busy" ? brain.state : speaking || replay.playingId ? "Speaking" : ears === "listening" ? "Listening" : "Chat status";
  const StatusIcon = getIcon("info");
  return <Popover.Root>
    <Popover.Trigger asChild>
      <Button variant="ghost" size="sm" aria-label={`Chat status: ${brain.state}`} className="gap-2 rounded-full text-xs text-muted-foreground">
        <StatusIcon className={cn("size-4", tones[brain.tone])} />{label}
      </Button>
    </Popover.Trigger>
    <Popover.Portal forceMount>
      <Popover.Content forceMount side="bottom" align="end" sideOffset={8} className="z-50 w-72 max-w-[calc(100vw-2rem)] rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg data-[state=closed]:hidden">
        <h3 className="mb-3 text-sm font-semibold">Chat status</h3>
        <dl className="space-y-3">
          {[brain, voice, listening, { name: "Eyes", icon: "eye", state: "Coming soon", detail: "Vision is not available yet. MaiPai cannot see through a camera or interpret images here.", tone: "quiet" } as Sense].map((sense) => { const Icon = getIcon(sense.icon); return <div key={sense.name}>
            <dt className="flex justify-between gap-3 text-sm"><span className="flex items-center gap-2"><Icon className={cn("size-4", tones[sense.tone])} />{sense.name}</span><span className={tones[sense.tone]}>{sense.state}</span></dt>
            <dd className="mt-1 text-xs text-muted-foreground">{sense.detail}</dd>
          </div>; })}
        </dl>
        <div className="mt-4 border-t pt-3">{children}</div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
