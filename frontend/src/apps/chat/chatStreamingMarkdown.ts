import { citeMarkers } from "@/apps/chat/chatCitations";

export interface ChatMarkdownPreprocessContext {
  streaming: boolean;
}

/** Keep a trailing partial numeric citation hidden until its marker resolves. */
export function holdCitationTail(text: string): string {
  const unfinishedCitation = /\[(?:\d*)$/.exec(text);
  if (unfinishedCitation?.index !== undefined) return text.slice(0, unfinishedCitation.index);
  return text;
}

/** Map citations and withhold only an unresolved citation tail. */
export function streamingMarkdown(text: string): string {
  return citeMarkers(holdCitationTail(text));
}

/** Repair only the transient rendered copy; assistant-ui retains the original part text. */
export function preprocessChatMarkdown(text: string, { streaming }: ChatMarkdownPreprocessContext): string {
  return streaming ? streamingMarkdown(text) : citeMarkers(text);
}
