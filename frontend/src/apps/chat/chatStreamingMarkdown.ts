import remend from "remend";
import { citeMarkers } from "@/apps/chat/chatCitations";

export interface ChatMarkdownPreprocessContext {
  streaming: boolean;
}

/** Keep incomplete block markers, citations and link labels out of the visible prefix. */
export function holdTail(text: string): string {
  const unfinishedCitation = /\[(?:\d*)$/.exec(text);
  if (unfinishedCitation?.index !== undefined) return text.slice(0, unfinishedCitation.index);

  const unfinishedLinkText = /\[([^\]]*)\]?$/.exec(text);
  if (unfinishedLinkText?.index !== undefined && unfinishedLinkText[1] && !/^\d+$/.test(unfinishedLinkText[1])) {
    return text.slice(0, unfinishedLinkText.index);
  }

  const incompleteBlockPrefix = /(?:^|\n)[\t ]{0,3}(?:#{1,6}[\t ]*|(?:[-+*]|\d+(?:[.)])?)[\t ]*(?:[*_~`]{0,3})?)$/.exec(text);
  if (incompleteBlockPrefix?.index !== undefined) return text.slice(0, incompleteBlockPrefix.index);

  const markerTail = /[*_~`]{1,3}$/.exec(text);
  if (markerTail?.index !== undefined) return text.slice(0, markerTail.index);
  return text;
}

/** Complete transient inline Markdown without changing stored message text. */
export function streamingMarkdown(text: string): string {
  return citeMarkers(remend(holdTail(text), { links: false, linkMode: "text-only" }));
}

/** Repair only the transient rendered copy; assistant-ui retains the original part text. */
export function preprocessChatMarkdown(text: string, { streaming }: ChatMarkdownPreprocessContext): string {
  return streaming ? streamingMarkdown(text) : citeMarkers(text);
}
