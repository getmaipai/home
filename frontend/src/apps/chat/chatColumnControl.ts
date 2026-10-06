import { createContext } from "react";

/** COLUMN-01: how the rest of the chat page (the command palette, the
 * keyboard shortcuts) drives the history column, instead of finding and
 * clicking its buttons in the DOM. The chat page provides it; a chat
 * thread shown anywhere else has none. */
export type ChatColumnControl = {
  /** Desktop: hide or show the column. Phone: open or close its sheet. */
  toggle: () => void;
  /** Show the column (or its sheet) with thread search open and focused. */
  openSearch: () => void;
};

export const ChatColumnControlContext = createContext<ChatColumnControl | null>(null);
