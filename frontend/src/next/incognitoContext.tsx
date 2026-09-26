import { createContext, useContext, type ReactNode } from "react";
import { useIncognito } from "@/next/useIncognito";

export const INCOGNITO_DISCARDED_EVENT = "maipai:incognito-discarded";

type IncognitoContextValue = {
  on: boolean;
  setOn: (on: boolean) => void;
};

const IncognitoContext = createContext<IncognitoContextValue>({ on: false, setOn: () => {} });

export function IncognitoProvider({ children }: { children: ReactNode }) {
  const [on, setOn] = useIncognito();
  return <IncognitoContext.Provider value={{ on, setOn }}>{children}</IncognitoContext.Provider>;
}

export function useIncognitoContext(): IncognitoContextValue {
  return useContext(IncognitoContext);
}
