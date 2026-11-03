// VIDEO-SETTINGS-02: the views that list styles (Pictures, Videos, Models and storage) draw ONE kit lock row for adult-only styles and nothing of them
// until the person unlocks; the lists reload after an unlock; leaving the view relocks. The server redacts (backend/tests/styleLock02.test.ts); this is the rendered tree.
import type { ReactNode } from "react";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { AdultLockProvider } from "@maipai/ui/src/elements/adult-lock";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { PicturesLibrary } from "@/apps/settings/PicturesLibrary";
import { ModelsAndStorageSection } from "@/apps/settings/ModelsAndStorageSection";
import { videosApi, type VideoAdapterRow, type VideoSettings } from "@/lib/videosApi";
import { picturesAdminApi, type AdminAdapter, type AdminOverview } from "@/lib/picturesApi";
import { componentsApi, type ComponentRow } from "@/lib/componentsApi";

afterEach(cleanup);
const TILE = "Locked items. Press to enter your passcode.";
const NAME = "Hidden example";
const WORD = "hxwordlock";

const vstyle = (over: Partial<VideoAdapterRow> = {}): VideoAdapterRow => ({ id: "lora-v", name: "Old Colour Film", classification: "all-ages", enabled: true, needs_confirmation: false, sha256: "a".repeat(64), base_model: "ltx-2.5", trigger_words: [], licence: "Apache-2.0", strength_default: 1, bytes: 1000, source_url: null, added_at: "2026-10-01T00:00:00Z", ...over });
const videoSettings = (unlocked: boolean): VideoSettings => ({
  state: "idle", available: true, reason: null, tier: "p128", model_installed: true, limits: "x", enabled: true, adult_adapters: true, minors: "x",
  adapters: [vstyle(), ...(unlocked ? [vstyle({ id: "lora-h", name: NAME, classification: "adult-only", trigger_words: [WORD] })] : [])], locked_styles: !unlocked,
});
const pstyle = (over: Partial<AdminAdapter> = {}): AdminAdapter => ({ id: "lora-p", name: "Pixel Art", base_model: "flux2-klein-4b", classification: "all-ages", classification_note: null, licence: "Apache-2.0", licence_known: true, source_url: null, bytes: 1000, sha256: "a".repeat(64), trigger_words: [], added_at: "2026-10-01T00:00:00Z", enabled: true, needs_confirmation: false, ...over });
const pictureOverview = (unlocked: boolean): AdminOverview => ({
  stack: "ok", engine: { state: "idle", available: true, reason: null, default_model: "flux2-klein-4b", edit_ready: true, models: [], remaining_bytes: 0 },
  adapters: [pstyle(), ...(unlocked ? [pstyle({ id: "lora-h", name: NAME, classification: "adult-only", trigger_words: [WORD] })] : [])], locked_styles: !unlocked,
  bands: [], adult_adapters: "allowed", quality: "quick", detailed_ready: false,
});
const part = (over: Partial<ComponentRow>): ComponentRow => ({ id: "lora.picture.lora-p", label: "Pixel Art", summary: "", group: "loras", kind: "lora", state: "installed", size_bytes: 1000, download_bytes: 0, full_bytes: 1000, required_free_bytes: 0, plan_need: null, requirement: "optional", requirement_reason: null, last_used_at: null, used_by: [], depends_on: [], job: null, percent: null, failure: null, can_install: false, install_block: null, can_uninstall: true, uninstall_block: null, ...over });
const components = (unlocked: boolean) => ({
  stack: "ok" as const, message: null, tier: "p128", free_disk_bytes: 1e12, disk_margin_bytes: 0, installed_bytes: 1000,
  components: [part({}), ...(unlocked ? [part({ id: "lora.picture.lora-h", label: NAME, summary: WORD })] : [])], locked_styles: !unlocked,
});

// The shell's composition in miniature: the kit provider over the page, a host that resets the queries on unlock and records every relock.
let state = { unlocked: false };
function Page({ children }: { children: ReactNode }) {
  return (
    <AdultLockProvider digits={4} unlock={async () => ({ status: "ok", proof: "proof-1" })} onUnlocked={() => { state.unlocked = true; }} onRelock={() => { state.unlocked = false; }}>
      {children}
    </AdultLockProvider>
  );
}

function mock3() {
  state = { unlocked: false };
  const saved = [{ ...videosApi }, { ...picturesAdminApi }, { ...componentsApi }] as const;
  videosApi.settings = mock(async () => videoSettings(state.unlocked));
  picturesAdminApi.overview = mock(async () => pictureOverview(state.unlocked));
  componentsApi.list = mock(async () => components(state.unlocked));
  componentsApi.licences = mock(async () => ({ stack: "ok" as const, terms_version: "v", acknowledged: { by: "p", at: "t", terms_version: "v" }, needs_prompt: false, licences: [], extras: null }));
  return () => { Object.assign(videosApi, saved[0]); Object.assign(picturesAdminApi, saved[1]); Object.assign(componentsApi, saved[2]); };
}

const views: Array<[string, () => ReactNode, string]> = [
  ["pictures", () => <PicturesLibrary />, "Pixel Art"],
  ["models and storage", () => <ModelsAndStorageSection />, "Pixel Art"],
];

describe.each(views)("%s", (_label, view, openName) => {
  test("locked: one lock row, no name, no trigger word, no Adults only badge anywhere in the tree; unlock shows it (relock on leaving is the shell host's, AdultLockHost.test.tsx)", async () => {
    const restore = mock3();
    const { queryClient, findAllByRole, findByText, container } = renderWithQueryClient(<Page>{view()}</Page>);
    await findByText(openName);
    expect((await findAllByRole("button", { name: TILE })).length).toBe(1);
    expect(document.documentElement.outerHTML).not.toContain(NAME);
    expect(document.documentElement.outerHTML).not.toContain(WORD);
    expect(container.textContent).not.toContain("Adults only");

    fireEvent.click((await findAllByRole("button", { name: TILE }))[0]!);
    await findByText("Enter your passcode");
    const input = document.querySelector('[data-slot="adult-lock-dialog"] input') as HTMLInputElement;
    await act(async () => { fireEvent.change(input, { target: { value: "0000" } }); });
    await act(async () => { await queryClient.resetQueries(); });
    await waitFor(() => expect(container.textContent).toContain(NAME));

    restore();
  });
});
