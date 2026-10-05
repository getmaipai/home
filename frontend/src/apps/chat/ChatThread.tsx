import { useAssistantToolUI } from "@assistant-ui/react";
import { Thread } from "@maipai/ui/src/elements/thread.aui";
import { MODEL_SELECTOR_SLOT, THREAD_SLOTS, TOOL_BINDINGS, type ToolBinding } from "@/apps/chat/elementBindings";
import { ChatConnectionBanner } from "@/apps/chat/chatConnectionBanner";

// SHARED-THREAD-01: the one thread composition. The chat page and the /dev/ui
// showcase both render this and nothing else for the thread; which Element
// renders what lives in elementBindings.ts. A page passes behaviour props (the
// runtime comes from the AssistantRuntimeProvider around this), never its own
// slot components. Chat-only wiring (providers for the artifact canvas,
// sources panel, ...) wraps this in the page; the contexts default safely.

function ElementBinding({ binding }: { binding: ToolBinding }) {
  useAssistantToolUI({ toolName: binding.toolName, render: binding.render, display: "standalone" });
  return null;
}

export function ChatThread({ temporary, onEditSend, modelPickerAllowed = true }: {
  /** Incognito: the kit's temporary-thread styling. */
  temporary?: boolean;
  /** Called with the superseded turn id when an edited message is sent. */
  onEditSend?: (messageId: string, turnId?: string) => void;
  /** Gate for the composer's model selector (it also hides itself under two models). */
  modelPickerAllowed?: boolean;
}) {
  return (
    <div className="relative min-h-0 flex-1">
      {TOOL_BINDINGS.map((binding) => <ElementBinding key={binding.toolName} binding={binding} />)}
      <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center">
        <ChatConnectionBanner />
      </div>
      <Thread
        temporary={temporary}
        components={{
          ...THREAD_SLOTS,
          onEditSend,
          viewport: {
            turnAnchor: "bottom",
            autoScroll: true,
            scrollToBottomOnRunStart: true,
            scrollToBottomOnInitialize: true,
            scrollToBottomOnThreadSwitch: true,
          },
          ComposerExtra: modelPickerAllowed ? MODEL_SELECTOR_SLOT : undefined,
        }}
      />
    </div>
  );
}
