import { createContext, useContext, type ReactNode } from "react";

const AmbientHeaderContext = createContext<ReactNode>(null);

export const AmbientHeaderProvider = AmbientHeaderContext.Provider;
export function useAmbientHeader() { return useContext(AmbientHeaderContext); }
