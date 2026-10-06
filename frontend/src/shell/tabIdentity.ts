import { createContext, createElement, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useLocation } from "react-router-dom";
import { useStatusSummary } from "@/shell/StatusIndicator";
import { readIncognitoCache } from "@/next/incognitoCache";
import { useSessionLocked } from "@/shell/sessionLockContext";

export type TabStatus = { level: "online" | "degraded" | "offline" | "maintenance"; text: string };
export type TabIdentity = { title: string };
export type TabIdentityInput = {
  pageName: string;
  chatTitle?: string;
  temporary?: boolean;
  ageBand?: "child" | "teen" | "adult";
  locked?: boolean;
  status?: TabStatus;
};

function cleanItem(value: string): string {
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
  if (clean.length <= 40) return clean;
  return `${clean.slice(0, 39).trimEnd()}…`;
}

export function buildTabIdentity(input: TabIdentityInput): TabIdentity {
  if (input.locked) return { title: "MaiPai Home" };
  if (input.temporary) return { title: "Private chat - MaiPai Home" };

  let item = input.pageName;
  if (input.pageName === "Chat") {
    item = input.ageBand === "child" ? "Chat" : (input.chatTitle || "New chat");
  }
  item = cleanItem(item);
  if (!item) return { title: "MaiPai Home" };

  let prefix = "";
  if (input.ageBand !== "child") {
    if (input.status?.level === "offline") prefix = "Down - ";
    else if (input.status?.level === "degraded") prefix = input.status.text === "Chat paused" ? "Paused - " : "Attention - ";
  }
  return { title: `${prefix}${item} - MaiPai Home` };
}

type TabItem = { pageName: string; chatTitle?: string; owner: symbol };
const TabItemContext = createContext<{ item: TabItem | null; setItem: Dispatch<SetStateAction<TabItem | null>> } | null>(null);
const TabOptionsContext = createContext<{ temporary: boolean; locked: boolean; ageBand?: TabIdentityInput["ageBand"] }>({ temporary: false, locked: false });

export function TabIdentityProvider({ children, temporary, locked, ageBand }: { children: ReactNode; temporary: boolean; locked: boolean; ageBand?: TabIdentityInput["ageBand"] }) {
  const [item, setItem] = useState<TabItem | null>(null);
  const itemValue = useMemo(() => ({ item, setItem }), [item]);
  const options = useMemo(() => ({ temporary, locked, ageBand }), [temporary, locked, ageBand]);
  return createElement(TabOptionsContext.Provider, { value: options },
    createElement(TabItemContext.Provider, { value: itemValue }, createElement(TabIdentityWriter), children));
}

function TabIdentityWriter() {
  useTabIdentity();
  return null;
}

/** Pages publish only a page name and, for chat, its already chosen title. */
export function useTabItem(pageName: string, chatTitle?: string) {
  const context = useContext(TabItemContext);
  const setItem = context?.setItem;
  const options = useContext(TabOptionsContext);
  const locked = useSessionLocked();
  const owner = useRef(Symbol("tab-item"));
  useEffect(() => {
    const previous = document.title;
    const ownerToken = owner.current;
    const item = { pageName, chatTitle, owner: ownerToken };
    if (setItem) setItem(item);
    else {
      const identity = buildTabIdentity({ pageName, chatTitle, ...options, temporary: options.temporary || readIncognitoCache(), locked: options.locked || locked });
      if (document.title !== identity.title) document.title = identity.title;
    }
    return () => {
      if (setItem) setItem((current) => current?.owner === ownerToken ? null : current);
      else if (document.title !== previous) document.title = previous;
    };
  }, [pageName, chatTitle, setItem, options, locked]);
}

const ROUTE_NAMES: Record<string, string> = {
  "/": "Home", "/chat": "Chat", "/people": "Family", "/settings": "Settings",
  "/storage": "Storage", "/engines": "Engines", "/performance": "Performance",
  "/updates": "Updates", "/repairs": "Repairs", "/status": "Status",
  "/backups": "Backups", "/voices": "Voices", "/commands": "Commands",
  "/devices": "Devices", "/privacy": "Privacy", "/users": "Users",
  "/models": "AI models", "/files": "Library", "/dev/ui": "Chat showcase",
  "/sign-in": "Sign in",
};

export function useTabIdentity() {
  const location = useLocation();
  const item = useContext(TabItemContext)?.item ?? null;
  const options = useContext(TabOptionsContext);
  const { summary } = useStatusSummary();
  const route = location.pathname.replace(/\/$/, "") || "/";
  const pageName = item?.pageName ?? ROUTE_NAMES[route];
  const chatTitle = item?.pageName === "Chat" ? item.chatTitle : undefined;
  useEffect(() => {
    const identity = buildTabIdentity({ pageName: pageName ?? "", chatTitle, ...options, status: summary });
    if (document.title !== identity.title) document.title = identity.title;
  }, [pageName, chatTitle, options, summary]);
}
