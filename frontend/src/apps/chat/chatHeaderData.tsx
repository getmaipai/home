import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/** CHAT-HEADER-01: the shell header's own `headerExtra` slot (ui-v0.5.35,
 * `useHeaderExtra(Component)`) takes a stable COMPONENT reference, mounted
 * by FullLayout's own Header - a sibling of `/next/chat`'s own Outlet
 * content, never a descendant of it. That means `ChatHeaderBar` (the
 * component NextChatPage.tsx hands to `useHeaderExtra`) renders OUTSIDE
 * NextChatPage's own AssistantRuntimeProvider tree, so it can't call
 * `useAui()`/`useAuiState()` directly - there is no runtime in its own
 * ancestry to read.
 *
 * This context bridges the gap: NextRoutesInner (NextRoutes.tsx) provides
 * it, wrapping every `/next/*` page; a small always-mounted component
 * INSIDE NextChatPage's own runtime tree (which does have real access)
 * pushes fresh data into it on every relevant change; `ChatHeaderBar`
 * reads it back out. Plain data and callbacks, never JSX or a component
 * reference - a data context is exactly what the shipped slot's own
 * ComponentType shape doesn't provide for itself, and the alternative
 * (hoisting the whole assistant-ui runtime provider above every /next
 * page just so the header can reach it) would mount a chat runtime on
 * pages that have nothing to do with chat. */
export interface ChatHeaderData {
  title: string;
  onRename: (title: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onStartTemporary: () => void;
  temporaryAllowed: boolean;
  shareAllowed: boolean;
}

const ChatHeaderDataContext = createContext<{
  data: ChatHeaderData | null;
  setData: (data: ChatHeaderData | null) => void;
}>({ data: null, setData: () => {} });

// One page (NextChatPage) writes, one component (ChatHeaderBar) reads -
// a plain useState here is exactly what that needs; NextRoutesInner
// wraps every /next page, but only a chat page ever calls the setter
// below, so a non-chat page's own render is never touched by this.
export function ChatHeaderDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<ChatHeaderData | null>(null);
  return <ChatHeaderDataContext.Provider value={{ data, setData }}>{children}</ChatHeaderDataContext.Provider>;
}

export function useChatHeaderData(): ChatHeaderData | null {
  return useContext(ChatHeaderDataContext).data;
}

/** Sets the header's data for as long as the calling page stays
 * mounted; clears it on unmount.
 *
 * An infinite render loop, found live wiring a real
 * `ChatHeaderDataProvider` around `NextChatPage` in a test for the
 * first time (every prior test rendered the page with no real
 * provider in its ancestry, so `setData` was the context's own
 * default no-op and this never actually ran): `data` is a fresh object
 * literal built on every render of the caller (`ChatHeaderDataBridge`,
 * `NextChatPage.tsx`), never memoized - depending on its reference
 * directly re-runs this effect, and therefore calls `setData`, on
 * every single render. `setData` changes `ChatHeaderDataProvider`'s
 * own state, which re-renders every consumer of this context
 * INCLUDING THE CALLER ITSELF, producing another fresh object and
 * re-triggering the effect again, with nothing to ever settle it.
 * Depending on the actual primitive fields instead - the values that
 * genuinely distinguish one call from the next - breaks the cycle: a
 * ref always holds the latest full object (including its closures)
 * for the one effect run that actually happens on a real change, so
 * `onRename`/`onDelete`/`onStartTemporary` are never stale, but the
 * effect itself stops re-firing on identity churn alone. */
export function useSetChatHeaderData(data: ChatHeaderData | null): void {
  const { setData } = useContext(ChatHeaderDataContext);
  const dataRef = useRef(data);
  dataRef.current = data;
  const title = data?.title;
  const temporaryAllowed = data?.temporaryAllowed;
  const shareAllowed = data?.shareAllowed;
  useEffect(() => {
    setData(dataRef.current);
    return () => setData(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately narrower than `data` itself; see this function's own comment above.
  }, [data === null, title, temporaryAllowed, shareAllowed, setData]);
}
