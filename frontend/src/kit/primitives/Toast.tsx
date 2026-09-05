import { createContext, useCallback, useContext, type ReactNode } from "react";
import { toast } from "sonner";
import { Toaster } from "@/kit/ui/sonner";

interface ToastContextValue {
  push: (text: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** The kit's ONE transient-notice primitive (docs/UI.md: a toast is "a
 * courtesy echo of an action the household member just took themselves,
 * self-dismissing, never blocking"). Built on Sonner (`kit/ui/sonner.tsx`,
 * shadcn's toast registry item - the org's "Toast is deprecated: use
 * Sonner" table entry), not a hand-rolled Radix Toast provider: Sonner
 * already owns queueing, swipe-to-dismiss, and the ARIA live region.
 * `useToast().push(text)` keeps every existing call site unchanged. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const push = useCallback((text: string) => {
    toast(text);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <Toaster />
    </ToastContext.Provider>
  );
}

/** `push(text)` shows one toast for a few seconds, then it's gone -
 * callers never hold a reference or manage its lifecycle themselves. */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast() must be called under <ToastProvider>");
  return ctx;
}
