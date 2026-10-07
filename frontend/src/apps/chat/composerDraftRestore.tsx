import { useContext, useEffect, useRef, useState } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { DraftConversationContext, TemporaryChatContext } from "@/apps/chat/chatThreadContexts";
import { DRAFT_DELAY_MS, discardDraft, readDraft, saveDraft, type ChatDraft } from "@/apps/chat/draftStore";

/** Owns draft persistence for ComposerInputOverride; the slot renders the
 * returned props on the kit's DraftRestore Element beside its input. */
export function useComposerDraftRestore() {
  const aui = useAui();
  const text = useAuiState((s) => s.composer.text);
  const id = useContext(DraftConversationContext);
  const temporary = useContext(TemporaryChatContext).on;
  const hadText = useRef(false);
  const [savedDraft, setSavedDraft] = useState<ChatDraft | null>(() => temporary ? null : readDraft(id));

  useEffect(() => setSavedDraft(temporary ? null : readDraft(id)), [id, temporary]);

  useEffect(() => {
    if (temporary || !id) return;
    if (!text) {
      if (hadText.current) discardDraft(id);
      return;
    }
    hadText.current = true;
    const timer = setTimeout(() => { saveDraft(id, text); setSavedDraft(null); }, DRAFT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [id, temporary, text]);

  if (temporary || text || !savedDraft) return null;
  return {
    draft: savedDraft.text,
    savedAt: savedDraft.savedAt,
    onRestore: () => {
      aui.composer.setText(savedDraft.text);
      setSavedDraft(null);
    },
    onDiscard: () => {
      discardDraft(id);
      setSavedDraft(null);
    },
  };
}
