import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanElements } from "./elementsAdoption";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "elements-adoption-"));
  roots.push(root);
  const kit = join(root, "frontend/node_modules/@maipai/ui");
  await mkdir(join(kit, "src/elements"), { recursive: true });
  await mkdir(join(root, "frontend/src/apps/chat"), { recursive: true });
  await mkdir(join(root, "frontend/src/dev"), { recursive: true });
  await writeFile(join(kit, "package.json"), JSON.stringify({ version: "1.2.3" }));
  await writeFile(join(kit, "src/elements/chat-panel.tsx"), "export {};");
  await writeFile(join(kit, "src/elements/chart.tsx"), "export {};");
  await writeFile(join(root, "frontend/src/dev/elements-plan.json"), JSON.stringify({ items: [
    { file: "chat-panel.tsx", name: "chat-panel", group: "chat", verdict: "wire-now" },
    { file: "chart.tsx", name: "chart", group: "chart", verdict: "later" },
  ] }));
  return root;
}

describe("elements adoption scanner", () => {
  test("an Element imported by chat source counts as in use", async () => {
    const root = await fixture();
    await writeFile(join(root, "frontend/src/apps/chat/thread.tsx"), 'import "@maipai/ui/src/elements/chat-panel";');
    const { output } = await scanElements({ root });
    expect(output.items.find((item) => item.file === "chat-panel.tsx")?.implemented).toBe(true);
  });

  test("an import from a test file or the dev folder does not count", async () => {
    const root = await fixture();
    await writeFile(join(root, "frontend/src/apps/chat/thread.test.tsx"), 'import "@maipai/ui/src/elements/chat-panel";');
    await writeFile(join(root, "frontend/src/dev/show.tsx"), 'import "@maipai/ui/src/elements/chart";');
    const { output } = await scanElements({ root });
    expect(output.items.every((item) => !item.implemented)).toBe(true);
  });

  test("the committed adoption json matches a fresh scan", async () => {
    const { output } = await scanElements();
    const committed = JSON.parse(await readFile(join(import.meta.dir, "../frontend/src/dev/elements-adoption.json"), "utf8"));
    const actual = { kitTag: committed.kitTag, items: committed.items };
    const expected = { kitTag: output.kitTag, items: output.items };
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error("elements-adoption.json is stale; run bun run elements:scan");
    }
    expect(actual).toEqual(expected);
  });

  test("no item stays unassessed after a scan with the plan", async () => {
    const { output, planOnly } = await scanElements();
    expect(planOnly).toEqual([]);
    expect(output.items.every((item) => item.verdict !== "unassessed")).toBe(true);
  });
});
