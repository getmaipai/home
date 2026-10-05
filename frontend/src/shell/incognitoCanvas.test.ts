import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");
let server: ChildProcess;
let browser: Browser;
let page: Page;
let url: string;
let serverOutput = "";

beforeAll(async () => {
  server = spawn("bun", ["run", "dev", "--host", "127.0.0.1", "--port", "0"], { cwd: join(ROOT, "frontend"), stdio: ["ignore", "pipe", "pipe"] });
  server.stdout?.on("data", (chunk: Buffer) => { serverOutput += chunk.toString(); });
  server.stderr?.on("data", (chunk: Buffer) => { serverOutput += chunk.toString(); });
  for (let attempt = 0; attempt < 100; attempt++) {
    const match = serverOutput.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
    if (match) { url = match[0]; break; }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!url) throw new Error(`Vite did not start: ${serverOutput}`);
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(url, { waitUntil: "domcontentloaded" });
}, 30000);

afterAll(async () => {
  await browser?.close();
  server?.kill("SIGTERM");
});

test.each(["light", "dark"] as const)("Incognito body paints its page token in %s theme", async (theme) => {
  await page.evaluate((selectedTheme) => {
    document.documentElement.classList.remove("light", "dark", "incognito");
    document.documentElement.classList.add(selectedTheme, "incognito");
    document.body.classList.add("style-neutral");
  }, theme);
  const colors = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const tokenProbe = document.createElement("div");
    tokenProbe.style.backgroundColor = "var(--background)";
    document.body.append(tokenProbe);
    const token = getComputedStyle(tokenProbe).backgroundColor;
    tokenProbe.remove();
    return { background: body.backgroundColor, token };
  });
  expect(colors.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(colors.background).toBe(colors.token);
}, 10000);
