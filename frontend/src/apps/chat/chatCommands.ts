export type ChatCommandAction = {
  newChat: () => void;
  focusComposer: () => void;
  stopReply: () => void;
  openPalette: () => void;
  toggleSidebar: () => void;
  focusChatSearch: () => void;
  toggleIncognito: () => void;
  openSettings: () => void;
  scrollToLatest: () => void;
};

export type ChatCommand = {
  id: string;
  name: string;
  group: string;
  shortcut: string;
  onRun: () => void;
};

// This is the sole shortcut and command catalog. The keyboard reference and
// the shipped command palette both read these records.
export const CHAT_COMMAND_SHORTCUTS = [
  { id: "new-chat", name: "New chat", group: "Chat", shortcut: "⌘/Ctrl+⇧O", action: "newChat" },
  { id: "focus-composer", name: "Focus composer", group: "Chat", shortcut: "⇧Esc", action: "focusComposer" },
  { id: "stop-reply", name: "Stop reply", group: "Chat", shortcut: "Esc", action: "stopReply" },
  { id: "command-palette", name: "Command palette", group: "Chat", shortcut: "⌘/Ctrl+K", action: "openPalette" },
  { id: "toggle-sidebar", name: "Toggle sidebar", group: "Chat", shortcut: "⌘/Ctrl+B", action: "toggleSidebar" },
] as const;

const EXTRA_COMMANDS = [
  { id: "search-chats", name: "Search chats", group: "Navigation", shortcut: "", action: "focusChatSearch" },
  { id: "toggle-incognito", name: "Toggle Incognito", group: "Chat", shortcut: "", action: "toggleIncognito" },
  { id: "open-settings", name: "Open settings", group: "Navigation", shortcut: "", action: "openSettings" },
  { id: "scroll-latest", name: "Scroll to latest", group: "Chat", shortcut: "", action: "scrollToLatest" },
] as const;

export function buildChatCommands(
  actions: ChatCommandAction,
  state: { isRunning: boolean; canUseIncognito: boolean; canSearchChats: boolean; canToggleSidebar: boolean; available: boolean; canOpenSettings: boolean; paletteOpen?: boolean },
): ChatCommand[] {
  const definitions = [...CHAT_COMMAND_SHORTCUTS, ...EXTRA_COMMANDS].filter((command) => {
    if (command.id === "stop-reply") return state.isRunning;
    if (command.id === "toggle-incognito") return state.canUseIncognito;
    if (command.id === "search-chats") return state.canSearchChats;
    if (command.id === "toggle-sidebar") return state.canToggleSidebar;
    if (command.id === "new-chat") return state.available;
    if (command.id === "open-settings") return state.canOpenSettings;
    if (command.id === "command-palette") return !state.paletteOpen;
    return true;
  });
  return definitions.map((command) => ({
    id: command.id,
    name: command.name,
    group: command.group,
    shortcut: command.shortcut,
    onRun: actions[command.action],
  }));
}
