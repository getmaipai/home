import { useState } from "react";
import type { ComponentProps } from "react";
import { useAuiState } from "@assistant-ui/react";
import { Citation } from "@maipai/ui/src/elements/inline-citation";
import { parseCitationHref } from "@/apps/chat/chatCitations";
import { sourcesFromMessage } from "@/apps/chat/chatSources";

export function ChatCitationLink({ href, children, ...props }: ComponentProps<"a">) {
  const sources = useAuiState((state) => sourcesFromMessage(state.message));
  const [open, setOpen] = useState(false);
  const index = parseCitationHref(href);
  const source = index ? sources[index - 1] : undefined;
  if (index && !source) return <span>{children}</span>;
  if (source) return <Citation index={index! - 1} source={{ domain: source.domain, title: source.title, href: source.url }} open={open} onOpenChange={setOpen} />;
  return <a href={href} title={props.title ?? (href && /^https?:/i.test(href) ? href : undefined)} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" {...props}>{children}</a>;
}
