import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, type Roster } from "@/lib/api";
import { IncognitoProvider } from "@/shell/incognitoContext";
import { writeIncognitoCache } from "@/shell/incognitoCache";
import { WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";
import { CompanionComposerMentions } from "@/apps/chat/companionComposerMentions";

const person = { id: "person-1", display_name: "Person", role: "adult" } as Roster;
function mount(children: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><IncognitoProvider><WakeWordPersonContext.Provider value={person}>{children}</WakeWordPersonContext.Provider></IncognitoProvider></QueryClientProvider>);
}
beforeEach(() => { try { localStorage.setItem("maipai.incognito-explanation-seen", "true"); } catch { /* ignore */ } });
afterEach(() => { cleanup(); mock.restore(); writeIncognitoCache(false); });

describe("Incognito: the composer offers no companion or cast mentions", () => {
  test("the composer reads no companion, cast or settings list for @ mentions while Incognito is on", async () => {
    writeIncognitoCache(true);
    const companions = spyOn(api, "companions").mockResolvedValue({ allowed: true, default_id: "a", companions: [{ id: "b", name: "Rivet", status: "ready", is_default: false }], discover: [] } as never);
    const cast = spyOn(api, "cast").mockResolvedValue({ cast: [] } as never);
    const settings = spyOn(api, "settingsValues").mockResolvedValue([] as never);
    mount(<CompanionComposerMentions><span>composer</span></CompanionComposerMentions>);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(companions).not.toHaveBeenCalled();
    expect(cast).not.toHaveBeenCalled();
    expect(settings).not.toHaveBeenCalled();
  });
});
