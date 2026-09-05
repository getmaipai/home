import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import * as RadixToast from "@radix-ui/react-toast";
import { cn } from "@/kit/utils";

interface ToastItem {
  id: string;
  text: string;
}

interface ToastContextValue {
  push: (text: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** The kit's ONE transient-notice primitive (docs/MODALS.md: "a passing
 * status update is a Toast, never a Dialog" - the standard this closes
 * the gap on). Never blocks interaction and never asks a question; a
 * toast that needs a response is a Dialog instead, wrongly built as a
 * toast. Auto-dismisses (Radix's own `duration`), announced once via its
 * built-in ARIA live region - no separate announcer needed. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((text: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setItems((prev) => [...prev, { id, text }]);
  }, []);

  function remove(id: string) {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <ToastContext.Provider value={{ push }}>
      <RadixToast.Provider duration={6000} swipeDirection="right">
        {children}
        {items.map((item) => (
          <RadixToast.Root
            key={item.id}
            onOpenChange={(open) => {
              if (!open) remove(item.id);
            }}
            className={cn(
              "rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-base text-[hsl(var(--card-foreground))] shadow-lg",
            )}
          >
            <RadixToast.Description>{item.text}</RadixToast.Description>
          </RadixToast.Root>
        ))}
        <RadixToast.Viewport className="fixed bottom-4 right-4 z-50 flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2 outline-none" />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
}

/** `push(text)` shows one toast for ~6s, then it's gone - callers never
 * hold a reference or manage its lifecycle themselves. */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast() must be called under <ToastProvider>");
  return ctx;
}
