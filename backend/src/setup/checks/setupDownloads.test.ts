import { expect, test } from "bun:test";
import { PLAN_ROLES, startSetupDownloads, type SetupDownloadClient } from "./setupDownloads";

test("setup downloads start four jobs concurrently, chat first, and keep going after a failure", async () => {
  const starts: string[] = [];
  let active = 0;
  let maximum = 0;
  const pins = ["chat-starter", "stt-a", "stt-b", "tts-a", "embed"].map((id, index) => ({
    id, role: index === 0 ? "chat" : id.startsWith("stt") ? "stt" : id.startsWith("tts") ? "tts" : "embed", repo: "org/model", license: "Apache-2.0", revision: `rev-${index}`, engine: "engine",
    download: { url: `https://example.invalid/${id}`, sha256: "a".repeat(64), approx_bytes: 1 },
  }));
  const gates: Array<() => void> = [];
  const client: SetupDownloadClient = {
    modelCatalog: async () => ({ models: pins }),
    pullModel: async ({ id }) => {
      starts.push(id);
      active++;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => gates.push(resolve));
      active--;
      if (id === "stt-a") throw new Error("one failure");
      return { job: id };
    },
  };
  const running = startSetupDownloads(client);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(starts).toEqual(["chat-starter", "stt-a", "stt-b", "tts-a"]);
  expect(maximum).toBe(4);
  gates.splice(0).forEach((release) => release());
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(starts).toContain("embed");
  gates.splice(0).forEach((release) => release());
  await running;
  expect(starts).toHaveLength(5);
});


test("setup downloads install each named engine build before pulling models", async () => {
  const order: string[] = [];
  const client: SetupDownloadClient = {
    modelCatalog: async () => ({ models: [
      { id: "a", role: "chat", revision: "r", engine: "llama-server", download: { url: "https://example.invalid/a", sha256: "a".repeat(64) } },
      { id: "b", role: "embed", revision: "r", engine: "llama-server", download: { url: "https://example.invalid/b", sha256: "a".repeat(64) } },
    ] }),
    engineAction: async (name, action) => { order.push(`${action}:${name}`); return {}; },
    pullModel: async ({ id }) => { order.push(`pull:${id}`); return {}; },
  };
  await startSetupDownloads(client);
  expect(order).toEqual(["install:llama-server", "pull:a", "pull:b"]);
});

test("voice roles (speech in, speech out, wake word) are in all three plan levels", () => {
  for (const tier of ["minimal", "moderate", "recommended"]) {
    expect(PLAN_ROLES[tier]).toEqual(expect.arrayContaining(["stt", "tts", "wakeword"]));
  }
});

// INSTALL-DISK-01: the rows the person left turned on decide which files are pulled.
import { selectedPulls } from "./setupDownloads";
import { shippedDiskPlan } from "@/lib/diskPlan";
import type { StackInstallPlan } from "@/lib/stack/client";

const pin = (id: string) => ({ id, role: "chat", url: `https://example.invalid/${id}`, sha256: "a".repeat(64), licence: "MIT", revision: "r", starter: false, installed: false });
function planWith(models: string[], optional: string[]): StackInstallPlan {
  const disk = shippedDiskPlan("p128");
  const rows = disk.rows.map((row) => row.id === "chat" ? { ...row, model_ids: models.slice(0, 1) } : row.id === "image-tools" ? { ...row, model_ids: models.slice(1, 2) } : row.id === "pictures" ? { ...row, model_ids: optional.slice(0, 1) } : row.id === "video" ? { ...row, model_ids: optional.slice(1, 2) } : row);
  return { level: "recommended", tier: "p128", label: "x", memory_gb: 128, memory_source: "unified", models: models.map(pin), total_bytes: 0, remaining_bytes: 0, free_disk_bytes: null, fits_disk: null, disk: { ...disk, rows }, optional_models: optional.map(pin) };
}

test("without a choice, the first-run set is pulled and pictures and videos are not", () => {
  expect(selectedPulls(planWith(["chat-a", "tools-a"], ["klein", "wan"])).map((m) => m.id)).toEqual(["chat-a", "tools-a"]);
});

test("a row left off drops its files; a picture row turned on adds its files", () => {
  const plan = planWith(["chat-a", "tools-a"], ["klein", "wan"]);
  expect(selectedPulls(plan, ["chat", "pictures"]).map((m) => m.id)).toEqual(["chat-a", "klein"]);
  expect(selectedPulls(plan, ["chat", "image-tools", "pictures", "video"]).map((m) => m.id)).toEqual(["chat-a", "tools-a", "klein", "wan"]);
});

test("a model no row names is kept, and installed ones are never pulled again", () => {
  const plan = planWith(["chat-a", "tools-a"], ["klein"]);
  plan.models.push(pin("stray"));
  plan.models[0] = { ...plan.models[0]!, installed: true };
  expect(selectedPulls(plan, ["chat"]).map((m) => m.id)).toEqual(["stray"]);
});

test("the picture engine has no build of its own: only real engines are installed first", async () => {
  const installed: string[] = [];
  const client: SetupDownloadClient = {
    modelCatalog: async () => ({ models: [] }),
    installPlan: async () => ({ ...planWith(["chat-a"], ["klein"]), optional_models: [{ ...pin("klein"), engine: "mflux" }, { ...pin("wan"), engine: "video-gen" }], models: [{ ...pin("chat-a"), engine: "llama-server" }], disk: { ...shippedDiskPlan("p128"), rows: shippedDiskPlan("p128").rows.map((row) => row.id === "pictures" ? { ...row, model_ids: ["klein"] } : row.id === "video" ? { ...row, model_ids: ["wan"] } : row.id === "chat" ? { ...row, model_ids: ["chat-a"] } : row) } }),
    engineAction: async (name) => { installed.push(name); return {}; },
    pullModel: async () => ({}),
  };
  await startSetupDownloads(client, { selected: ["chat", "pictures", "video"] });
  expect(installed.sort()).toEqual(["llama-server", "video-gen"]);
});
