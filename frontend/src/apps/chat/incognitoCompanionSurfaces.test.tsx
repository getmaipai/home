import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, type Roster } from "@/lib/api";
import { IncognitoProvider } from "@/shell/incognitoContext";
import { writeIncognitoCache } from "@/shell/incognitoCache";
import { WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";
import { useCompanionAvatar, useCompanionStills, useReplyCompanionClips } from "@/apps/chat/useCompanionAvatar";
import { selectedSpeakerFromCache } from "@/apps/chat/selectedSpeaker";

const person = { id: "person-1", display_name: "Person", role: "adult" } as Roster;
const avatarFor = { avatar: { name: "Marlow Companion", portrait: "/marlow.png", states: { idle: { loop: true, urls: { h264: null, av1: null, still: "/marlow-idle.png" } } } } };

function Probe() {
  const one = useCompanionAvatar("companion-1");
  const stills = useCompanionStills(["companion-1"]);
  const clips = useReplyCompanionClips(["companion-1"]);
  return <output data-testid="out">{JSON.stringify({ name: one.avatar?.name ?? null, clips: one.clips, still: stills["companion-1"] ?? null, reply: clips["companion-1"] ?? null })}</output>;
}

function mount(children: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><IncognitoProvider><WakeWordPersonContext.Provider value={person}>{children}</WakeWordPersonContext.Provider></IncognitoProvider></QueryClientProvider>);
}

beforeEach(() => { try { localStorage.setItem("maipai.incognito-explanation-seen", "true"); } catch { /* ignore */ } });
afterEach(() => { cleanup(); mock.restore(); writeIncognitoCache(false); });

describe("Incognito: the chat's companion faces and names are generic, with no history", () => {
  test("with Incognito off the selected companion's avatar loads", async () => {
    writeIncognitoCache(false);
    spyOn(api, "companionAvatar").mockResolvedValue(avatarFor as never);
    const view = mount(<Probe />);
    await waitFor(() => expect(view.getByTestId("out").textContent).toContain("Marlow Companion"));
  });

  test("with Incognito on no companion avatar is requested for the header, the stills or the reply faces", async () => {
    writeIncognitoCache(true);
    const avatar = spyOn(api, "companionAvatar").mockResolvedValue(avatarFor as never);
    const view = mount(<Probe />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(avatar).not.toHaveBeenCalled();
    expect(JSON.parse(view.getByTestId("out").textContent ?? "{}")).toEqual({ name: null, clips: null, still: null, reply: null });
  });

  test("the cached speaker for a first reply is never the person's selected companion while Incognito is on", () => {
    const qc = new QueryClient();
    qc.setQueryData(["companions"], { default_id: "sage", companions: [{ id: "sage", name: "Sage" }, { id: "rivet", name: "Rivet" }] });
    qc.setQueryData(["settingsValues", "person:p1"], [{ key: "persona.active_id", value: "rivet" }]);
    expect(selectedSpeakerFromCache(qc, "p1", undefined, undefined)?.companion_id).toBe("rivet");
    expect(selectedSpeakerFromCache(qc, "p1", undefined, undefined, true)).toBeUndefined();
  });
});
