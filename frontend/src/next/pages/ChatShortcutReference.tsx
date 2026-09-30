import { useContext, useEffect, useState } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@maipai/ui/src/dashboard/components/ui/dialog";
import { CHAT_SHORTCUTS, registerChatShortcuts } from "@/next/pages/chatShortcuts";
import { ChatAvailabilityContext } from "@/apps/chat/useChatAvailability";

export function ChatShortcutReference() {
  const aui = useAui();
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const availability = useContext(ChatAvailabilityContext);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    return registerChatShortcuts({ aui, isRunning, unavailable: availability === "unavailable", setReferenceOpen: setOpen });
  }, [aui, availability, isRunning]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Shortcuts for chat and navigation.</DialogDescription>
        </DialogHeader>
        <dl className="flex flex-col gap-3 text-sm">
          {CHAT_SHORTCUTS.map(([label, shortcut]) => (
            <div className="flex items-center justify-between gap-6" key={label}>
              <dt>{label}</dt>
              <dd className="font-mono text-muted-foreground">{shortcut}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
