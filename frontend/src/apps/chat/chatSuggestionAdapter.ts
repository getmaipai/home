import type { SuggestionAdapter } from "@assistant-ui/react";
import { api } from "@/lib/api";

// Composer empty-state prompts (docs/plans/session-b-ui.md step 4:
// "three, from the installed packages' routing examples"): each
// package's manifest can declare routing.examples (spec/schemas/
// manifest.schema.json, "five or more, required at bronze") - real
// example utterances the package's own author wrote to teach the
// router what it handles, so a starter prompt is always something
// MaiPai can actually do rather than an invented placeholder. Static per
// mount, not regenerated per reply (`messages`/`signal` unused): these
// are fixed starters for an EMPTY thread, not a model-generated
// follow-up suggestion (ThreadFollowupSuggestions, thread.aui.tsx,
// covers that separately once a reply exists).
export function createChatSuggestionAdapter(): SuggestionAdapter {
  return {
    async generate() {
      const manifests = await api.plugins().catch(() => []);
      const prompts = manifests
        .map((m) => m.routing?.examples?.[0])
        .filter((example): example is string => typeof example === "string" && example.length > 0)
        .slice(0, 3);
      return prompts.map((prompt) => ({ prompt }));
    },
  };
}
