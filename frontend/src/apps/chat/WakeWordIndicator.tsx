import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import type { WakeWordStatus } from "@/apps/chat/useWakeWord";

export function WakeWordIndicator({ status, onTurnOff }: { status: WakeWordStatus; onTurnOff: () => void }) {
  if (status !== "starting" && status !== "listening") return null;
  const listening = status === "listening";
  return (
    <div
      role="status"
      aria-label={listening ? "Wake word is listening" : "Wake word microphone is starting"}
      data-slot="wakeword-indicator"
      className="fixed inset-x-4 bottom-4 z-[60] mx-auto flex max-w-lg items-center justify-between gap-4 rounded-lg border border-destructive bg-background px-4 py-3 text-sm shadow-lg"
    >
      <span className="font-medium">{listening ? "Listening for Hey Jarvis" : "Opening wake word microphone"}</span>
      <Button type="button" variant="destructive" size="sm" aria-label="Turn off wake word listening" onClick={onTurnOff}>
        Turn off
      </Button>
    </div>
  );
}
