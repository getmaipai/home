import { useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Button } from "@/kit/ui/button";
import { getIcon } from "@/kit/icons";
import { useChatListenStore } from "./chatListenStore";
import type { EngineHealth } from "./useEngineHealth";
import { cn, FOCUS_RING } from "@/kit/utils";

export type ReplyState = "idle" | "waiting" | "responding" | "ready" | "error";
export type EarState = "idle" | "starting" | "listening" | "error";
type Tone = "quiet" | "good" | "busy" | "bad";
interface Sense { name: string; icon: string; state: string; detail: string; tone: Tone }
const tones: Record<Tone, string> = {
  quiet: "text-muted-foreground",
  good: "text-emerald-600 dark:text-emerald-400",
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

function SenseButton({ sense }: { sense: Sense }) {
  const [open, setOpen] = useState(false);
  const Icon = getIcon(sense.icon);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="icon" type="button" onClick={(event) => { event.preventDefault(); setOpen(true); }} aria-label={`${sense.name}: ${sense.state}`} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
          className={cn("relative flex size-10 items-center justify-center rounded-xl transition-colors hover:bg-muted focus-visible:bg-muted", FOCUS_RING, tones[sense.tone])}>
          <Icon className="size-5" strokeWidth={1.7} aria-hidden="true" />
          <span aria-hidden="true" className={cn("absolute right-1.5 bottom-1.5 size-1.5 rounded-full bg-current ring-2 ring-background", sense.tone === "busy" && "motion-safe:animate-pulse")} />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="bottom" align="end" sideOffset={12} onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()} className="z-50 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-popover p-4 text-popover-foreground shadow-xl">
          <div className="mb-2 flex items-center justify-between gap-4"><span className="font-semibold">{sense.name}</span><span className={cn("text-xs font-medium", tones[sense.tone])}>{sense.state}</span></div>
          <p className="text-sm leading-relaxed text-muted-foreground">{sense.detail}</p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function SensesDock({ health, reply, speaking, speechError, ears, earError }: { health: EngineHealth | undefined; reply: ReplyState; speaking: boolean; speechError: boolean; ears: EarState; earError: string | null }) {
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
  else if (reply === "waiting" || reply === "responding") brain = { ...brain, state: reply === "waiting" ? "Thinking" : "Replying", tone: "busy", detail: reply === "waiting" ? "Waiting for the first response from MaiPai." : "MaiPai is generating your reply." };
  let voice = serviceSense(health?.voice, "Voice", "speech");
  if (speechError || replay.errorId) voice = { ...voice, state: "Playback failed", tone: "bad", detail: "Speech could not be generated or played. Your text reply is still available. Try Listen again or check your voice settings." };
  else if (speaking || replay.playingId) voice = { ...voice, state: "Speaking", tone: "good", detail: "MaiPai is reading a reply aloud." };
  else if (replay.loadingId) voice = { ...voice, state: "Preparing audio", tone: "busy", detail: "Preparing this reply for playback." };
  const listening: Sense = { name: "Ears", icon: "ear", state: ears === "listening" ? "Wake word on" : ears === "error" ? "Mic unavailable" : ears === "starting" ? "Starting" : "Mic off", tone: ears === "error" ? "bad" : ears === "listening" ? "good" : ears === "starting" ? "busy" : "quiet", detail: `${earError && ears === "error" ? earError : ears === "listening" ? 'Listening for “hey jarvis”.' : ears === "starting" ? "Starting the microphone and wake-word detector." : "Enable Wake word below to listen for a wake phrase."} Continued hands-free conversation is not available yet.` };
  return <div role="group" aria-label="MaiPai senses" className="flex shrink-0 items-center gap-1 rounded-2xl border border-border/70 bg-muted/20 p-1 shadow-sm">
    {[brain, voice, { name: "Eyes", icon: "eye", state: "Coming soon", detail: "Vision is not available yet. MaiPai cannot see through a camera or interpret images here.", tone: "quiet" } as Sense, listening].map((sense) => <SenseButton key={sense.name} sense={sense} />)}
  </div>;
}
