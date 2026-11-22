import { i18n } from "@lingui/core";
import { useContext, useEffect, useState } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@maipai/ui/src/dashboard/components/ui/dialog";
import { CHAT_SHORTCUTS, registerChatShortcuts } from "@/shell/pages/chatShortcuts";
import { ChatAvailabilityContext } from "@/apps/chat/useChatAvailability";
import { ChatColumnControlContext } from "@/apps/chat/chatColumnControl";

/** The one keyboard reference. Chat mounts it bare; Code (CODE-UI-03) passes its own "new" action and the words for it, so the keys and the dialog are the same. */
export function ChatShortcutReference({ onNew, newLabel, description }: { onNew?: () => void; newLabel?: string; description?: string } = {}) {
  const aui = useAui();
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const availability = useContext(ChatAvailabilityContext);
  const [open, setOpen] = useState(false);
  const chatColumn = useContext(ChatColumnControlContext);

  useEffect(() => {
    return registerChatShortcuts({ aui, isRunning, unavailable: availability === "unavailable", setReferenceOpen: setOpen, toggleSidebar: chatColumn?.toggle, onNew });
  }, [aui, availability, isRunning, chatColumn, onNew]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{i18n._({ id: "Keyboard shortcuts", message: "Keyboard shortcuts" })}</DialogTitle>
          <DialogDescription>{description ?? i18n._({ id: "Shortcuts for chat and navigation.", message: "Shortcuts for chat and navigation." })}</DialogDescription>
        </DialogHeader>
        <dl className="flex flex-col gap-3 text-sm">
          {CHAT_SHORTCUTS.map(([label, shortcut]) => (
            <div className="flex items-center justify-between gap-6" key={label}>
              <dt>{newLabel && label === "New chat" ? newLabel : label}</dt>
              <dd className="font-mono text-muted-foreground">{shortcut}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
