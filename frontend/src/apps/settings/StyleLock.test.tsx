// VIDEO-SETTINGS-02, kept by VIDEO-SETTINGS-05: Models and storage lists no style at all (the Styles tab is the one list), so an adult-only style's name, its
// trigger words and the Adults only badge never reach this view even when the Stack still sends the file, and no lock row stands in for it. The lock itself lives on the
// Styles tab (styles/StylesTab.test.tsx). The server redacts (backend/tests/styleLock02.test.ts); this is the rendered tree.
import { afterEach, expect, mock, test } from "bun:test";
import { cleanup } from "@testing-library/react";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { ModelsAndStorageSection } from "@/apps/settings/ModelsAndStorageSection";
import { componentsApi, type ComponentRow } from "@/lib/componentsApi";

afterEach(cleanup);
const NAME = "Hidden example";
const WORD = "hxwordlock";

const part = (over: Partial<ComponentRow>): ComponentRow => ({ id: "lora.picture.lora-p", label: "Pixel Art", summary: "", group: "loras", kind: "lora", state: "installed", size_bytes: 1000, download_bytes: 0, full_bytes: 1000, required_free_bytes: 0, plan_need: null, requirement: "optional", requirement_reason: null, last_used_at: null, used_by: [], depends_on: [], job: null, percent: null, failure: null, can_install: false, install_block: null, can_uninstall: true, uninstall_block: null, ...over });
const model = part({ id: "klein", label: "Picture model", group: "pictures", kind: "model" });

test("Models and storage draws models only: no style row, no name, no trigger word, no lock row, no Styles you added group", async () => {
  const saved = { ...componentsApi };
  componentsApi.list = mock(async () => ({
    stack: "ok" as const, message: null, tier: "p128", free_disk_bytes: 1e12, disk_margin_bytes: 0, installed_bytes: 1000,
    components: [model, part({}), part({ id: "lora.picture.lora-h", label: NAME, summary: WORD })], locked_styles: true,
  }));
  componentsApi.licences = mock(async () => ({ stack: "ok" as const, terms_version: "v", acknowledged: { by: "p", at: "t", terms_version: "v" }, needs_prompt: false, licences: [], extras: null }));
  const { findByText, container, queryAllByRole } = renderWithQueryClient(<ModelsAndStorageSection />);
  await findByText("Picture model");
  const html = document.documentElement.outerHTML;
  for (const text of ["Pixel Art", NAME, WORD, "Styles you added", "Adults only"]) expect(html).not.toContain(text);
  expect(container.textContent).not.toContain("Styles");
  expect(queryAllByRole("button", { name: "Locked items. Press to enter your passcode." }).length).toBe(0);
  Object.assign(componentsApi, saved);
});
