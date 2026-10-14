import { chromium } from "../../node_modules/playwright/index.mjs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const output = resolve(".setup-preview-captures");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
const cases = [["happy-local", 1], ["happy-local", 4], ["happy-local", 5], ["happy-local", 10], ["engine-down", 4], ["slow-download", 9]];
const screens = { 1: "Welcome to MaiPai Home", 4: "Checking your computers", 5: "Here's the plan for your Home", 9: "Hello", 10: "Your Home is ready" };
for (const width of [1440, 390]) for (const theme of ["light", "dark"]) for (const [scenario, screen] of cases) {
  const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme: theme });
  const requests = [];
  page.on("request", (request) => requests.push(new URL(request.url()).origin));
  await page.goto(`http://127.0.0.1:5173/setup?scenario=${scenario}`, { waitUntil: "networkidle" });
  await page.evaluate((index) => window.dispatchEvent(new CustomEvent("setup-preview-jump", { detail: index - 1 })), screen);
  await page.getByText(screens[screen], { exact: true }).waitFor({ state: "visible", timeoutMs: 5000 });
  await page.screenshot({ path: resolve(output, `${scenario}-screen-${screen}-${width}-${theme}.png`), fullPage: true });
  const outside = requests.filter((origin) => origin !== "http://127.0.0.1:5173");
  if (outside.length) throw new Error(`Outbound requests observed: ${outside.join(", ")}`);
  await page.close();
}
await browser.close();
