import type { ThreadMessage } from "@assistant-ui/react";

/** Every text part's text, concatenated - the plain string a message
 * "says", regardless of role. Ignores reasoning/tool/image/file/source
 * parts: none of MaiPai's own messages carry those today. */
export function messageText(message: ThreadMessage | undefined): string {
  if (!message) return "";
  return message.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}
