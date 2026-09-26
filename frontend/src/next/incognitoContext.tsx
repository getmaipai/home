import { useCallback, useEffect, useState, createContext, useContext, type ReactNode } from "react";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@maipai/ui/src/dashboard/components/ui/dialog";
import { useIncognito } from "@/next/useIncognito";

export const INCOGNITO_DISCARDED_EVENT = "maipai:incognito-discarded";
const EXPLANATION_SEEN_KEY = "maipai.incognito-explanation-seen";

function hasSeenExplanation(): boolean {
  try {
    return localStorage.getItem(EXPLANATION_SEEN_KEY) === "true";
  } catch {
    return false;
  }
}

function markExplanationSeen(): void {
  try {
    localStorage.setItem(EXPLANATION_SEEN_KEY, "true");
  } catch {
    // If storage is blocked, this tab still dismisses the explanation.
  }
}

type IncognitoContextValue = {
  on: boolean;
  setOn: (on: boolean) => void;
};

const IncognitoContext = createContext<IncognitoContextValue>({ on: false, setOn: () => {} });

export function IncognitoProvider({ children }: { children: ReactNode }) {
  const [on, setIncognito] = useIncognito();
  const [explanationOpen, setExplanationOpen] = useState(() => on && !hasSeenExplanation());

  const setOn = useCallback((next: boolean) => {
    if (next && !hasSeenExplanation()) setExplanationOpen(true);
    setIncognito(next);
  }, [setIncognito]);

  useEffect(() => {
    document.documentElement.classList.toggle("incognito", on);
    return () => document.documentElement.classList.remove("incognito");
  }, [on]);

  const closeExplanation = () => {
    markExplanationSeen();
    setExplanationOpen(false);
  };

  return (
    <IncognitoContext.Provider value={{ on, setOn }}>
      {children}
      <Dialog open={explanationOpen} onOpenChange={(open) => (open ? setExplanationOpen(true) : closeExplanation())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>What Incognito does</DialogTitle>
            <DialogDescription>
              Incognito conversations are not saved to memory, and MaiPai sets aside its usual personalization while you chat. They stay in a separate list until you turn Incognito off, then they are discarded.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" onClick={closeExplanation}>Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </IncognitoContext.Provider>
  );
}

export function useIncognitoContext(): IncognitoContextValue {
  return useContext(IncognitoContext);
}
