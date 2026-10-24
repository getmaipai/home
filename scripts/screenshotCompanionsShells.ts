import "./runTemp";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { reserveFreePort } from "../backend/tests/fixtures/reserveFreePort";
import { waitForBackendPort } from "./screenshotRuntime";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "data-scratch", "screenshots", "companions-shells");
const DATA = mkdtempSync(join(tmpdir(), "companions-shell-shots-"));
if (!process.argv.includes("--skip-build")) {
  const build = Bun.spawnSync({ cmd: ["bun", "run", "build"], cwd: join(ROOT, "frontend"), stdout: "inherit", stderr: "inherit" });
  if (build.exitCode !== 0) throw new Error("frontend build failed");
}
mkdirSync(OUT, { recursive: true });
const backend = Bun.spawn({ cmd: ["bun", "run", "src/index.ts"], cwd: join(ROOT, "backend"), env: { ...process.env, MAIPAI_TEST_ALLOW_MULTIPLE_HUBS: "1", MAIPAI_MDNS: "off", PORT: "0", MAIPAI_DATA_DIR: DATA, MAIPAI_KIWIX_PORT: String(reserveFreePort()), MAIPAI_WYOMING_PORT: "0" }, stdout: "pipe", stderr: "inherit" });
const json = { "Content-Type": "application/json" };
try {
  const base = `http://localhost:${await waitForBackendPort(backend.stdout as ReadableStream<Uint8Array>)}`;
  const setup = await fetch(`${base}/api/auth/setup`, { method: "POST", headers: json, body: JSON.stringify({ displayName: "Sage", secret: "correcthorsebattery" }) });
  if (!setup.ok) throw new Error(`setup failed: ${setup.status}`);
  const owner = setup.headers.get("set-cookie")!.split(";")[0]!;
  const signed = new Map<string, string>([["Sage", owner]]);
  for (const [displayName, role] of [["Marlow", "adult"], ["Riff", "teen"], ["Sprout", "child"]] as const) {
    const made = await fetch(`${base}/api/people`, { method: "POST", headers: { ...json, Cookie: owner }, body: JSON.stringify({ displayName, role, secret: "0000", ...(role === "child" ? { birthdate: "2018-03-01" } : {}) }) });
    if (!made.ok) throw new Error(`could not seed ${displayName}: ${made.status}`);
    const { id } = await made.json() as { id: string };
    const result = await fetch(`${base}/api/auth/verify-secret`, { method: "POST", headers: json, body: JSON.stringify({ personId: id, secret: "0000" }) });
    signed.set(displayName, result.headers.get("set-cookie")!.split(";")[0]!);
  }
  const me = await fetch(`${base}/api/auth/me`, { headers: { Cookie: owner } }).then((r) => r.json()) as { id: string };
  const toggle = await fetch(`${base}/api/settings`, { method: "PUT", headers: { ...json, Cookie: owner }, body: JSON.stringify({ scope: `person:${me.id}`, key: "companions.preview_shells", value: true }) });
  if (!toggle.ok) throw new Error(`setting failed: ${toggle.status} ${await toggle.text()}`);
  const browser = await chromium.launch();
  try {
    const shots = [
      ["yours", "/companions", "Yours"], ["discover", "/companions", "Discover"],
      ["tasks", "/companions/lively-adult", "Tasks"], ["wizard-one", "/companions/start", "Pick a template"],
      ["wizard-two", "/companions/start", "Name and look"], ["chat-header", "/chat", "Conversation actions"], ["chat-mention", "/chat", "Message input"],
    ] as const;
    const locatorFor = (page: Page, name: typeof shots[number][0], text: string) => {
      if (name === "chat-header") return page.getByRole("button", { name: "Conversation actions" });
      if (name === "chat-mention") return page.getByRole("textbox", { name: "Message input" });
      if (name === "wizard-one" || name === "wizard-two") return page.getByTestId("companion-wizard");
      return page.getByText(text, { exact: false });
    };
    for (const theme of ["light", "dark"] as const) for (const width of [1440, 390] as const) {
      for (const [name, path, text] of shots) {
        const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 960 }, colorScheme: theme });
        await context.addCookies([{ name: "session", value: owner.slice("session=".length), url: base }]);
        const page = await context.newPage(); await page.goto(base + path);
        await locatorFor(page, name, text).first().waitFor({ timeout: 20000 });
        if (name === "discover") {
          await page.getByRole("tab", { name: "Discover" }).click();
          await page.getByRole("tab", { name: "Discover", selected: true }).waitFor();
        }
        if (name === "tasks") {
          await page.getByRole("tab", { name: "Tasks" }).click();
          await page.getByRole("tab", { name: "Tasks", selected: true }).waitFor();
        }
        if (name === "wizard-two") { await page.getByRole("button", { name: "Continue" }).click(); await page.getByLabel("Name").waitFor({ timeout: 20000 }); }
        if (name === "chat-header") {
          const companions = await fetch(`${base}/api/companions`, { headers: { Cookie: owner } }).then((response) => response.json()) as { companions: Array<{ id: string; name: string }>; default_id: string };
          const defaultName = companions.companions.find((card) => card.id === companions.default_id)?.name ?? "MaiPai";
          await page.getByRole("button", { name: defaultName }).click();
        }
        if (name === "chat-mention") {
          const input = page.getByRole("textbox", { name: "Message" });
          await input.click();
          await input.press("@");
          await page.getByText("MaiPai", { exact: true }).first().waitFor({ timeout: 20000 });
        }
        if (name === "yours" && (await page.getByText("Coming soon: add a companion to your set from here.").count())) throw new Error("Yours shows the Discover panel before its tab is selected");
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 0) throw new Error(`${name}/${width}/${theme}: horizontal overflow ${overflow}`);
        await page.screenshot({ path: join(OUT, `${name}-${width}-${theme}.png`), fullPage: true, animations: "disabled" });
        console.log(`${name}/${width}/${theme}: ok`);
        await context.close();
      }
      const mock = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 960 }, colorScheme: theme });
      await mock.goto(`file://${join(ROOT, "docs/design/assets/companions-shared-chat-2026-10-24/launcher.html")}`);
      await mock.getByText("Add Magic Night to the shared calendar, Friday 5 to 11 PM?", { exact: false }).waitFor();
      await mock.screenshot({ path: join(OUT, `mockup-${width}-${theme}.png`), fullPage: true, animations: "disabled" });
      console.log(`mockup/${width}/${theme}: ok`);
      await mock.close();
    }
    const disablePreview = await fetch(`${base}/api/settings`, {
      method: "PUT",
      headers: { ...json, Cookie: owner },
      body: JSON.stringify({ scope: `person:${me.id}`, key: "companions.preview_shells", value: false }),
    });
    if (!disablePreview.ok) throw new Error(`setting off failed: ${disablePreview.status} ${await disablePreview.text()}`);
    for (const who of ["Sage", "Riff"] as const) {
      const context = await browser.newContext();
      await context.addCookies([{ name: "session", value: signed.get(who)!.slice("session=".length), url: base }]);
      const page = await context.newPage();
      await page.goto(base + "/companions");
      const body = await page.locator("body").innerText();
      if (body.includes("Discover") || body.includes("Coming soon")) throw new Error(`${who} saw preview copy while switch was off`);
      await context.close();
    }
  } finally { await browser.close(); }
} finally { backend.kill(); rmSync(DATA, { recursive: true, force: true }); }
