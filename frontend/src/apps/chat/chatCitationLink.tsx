import { useContext, useState } from "react";
import type { ComponentProps } from "react";
import { useAuiState } from "@assistant-ui/react";
import { Citation } from "@maipai/ui/src/elements/inline-citation";
import { parseCitationHref } from "@/apps/chat/chatCitations";
import { sourcesFromMessage } from "@/apps/chat/chatSources";
import { ChatAgeBandContext } from "@/apps/chat/chatThreadContexts";

export function ChatCitationLink({ href, children, ...props }: ComponentProps<"a">) {
  const sources = useAuiState((state) => sourcesFromMessage(state.message));
  // MINOR-SEARCH-01h: a child gets source names and excerpts, never a link out; a teen and an adult get the link.
  const band = useContext(ChatAgeBandContext);
  const noLinks = band !== "teen" && band !== "adult";
  const [open, setOpen] = useState(false);
  const index = parseCitationHref(href);
  const source = index ? sources[index - 1] : undefined;
  // SEARCH-ANSWER-07: a marker with no matching source is dropped, never shown as a bare digit.
  if (index && !source) return null;
  if (source) return <Citation index={index! - 1} source={{ domain: source.domain, title: source.title, href: noLinks ? undefined : source.url, detail: source.detail }} open={open} onOpenChange={setOpen} tourId="chat.citation" />;
  if (noLinks) return <span>{children}</span>;
  return <a href={href} title={props.title ?? (href && /^https?:/i.test(href) ? href : undefined)} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" {...props}>{children}</a>;
}
