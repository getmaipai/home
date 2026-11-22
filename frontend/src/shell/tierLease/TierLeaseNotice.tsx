// TIER-LEASE-04: the shared notice line as a component, for a page that has no composer notice slot of its own. It is Chat's one look (LED dot, one short
// sentence, tooltip, links) drawn by ChatComposerNotice; this file adds nothing visual.
import { ChatComposerNotice } from "@/apps/chat/chatThreadSlots";
import { ChatComposerNoticeContext, type ChatComposerNoticeValue } from "@/apps/chat/chatThreadContexts";

export function TierLeaseNotice({ notice }: { notice: ChatComposerNoticeValue | null }) {
  if (!notice) return null;
  return <ChatComposerNoticeContext.Provider value={notice}><ChatComposerNotice /></ChatComposerNoticeContext.Provider>;
}
