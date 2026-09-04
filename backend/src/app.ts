import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { auth } from "@/routes/auth";
import { peopleRoutes } from "@/routes/people";
import { safetyRoutes } from "@/routes/safety";
import { memoryRoutes } from "@/routes/memory";
import { settingsRoutes } from "@/routes/settings";
import { skillsRoutes } from "@/routes/skills";
import { schedulerRoutes } from "@/routes/scheduler";
import { llmRoutes } from "@/routes/llm";
import { turnRoutes } from "@/routes/turn";
import { conversationsRoutes } from "@/routes/conversations";
import { backupsRoutes } from "@/routes/backups";
import type { AppEnv } from "@/types";

export const app = new Hono<AppEnv>();

app.get("/api/health", (c) => c.json({ status: "ok" }));

app.route("/api/auth", auth);
app.route("/api/people", peopleRoutes);
app.route("/api/safety", safetyRoutes);
app.route("/api/memory", memoryRoutes);
app.route("/api/settings", settingsRoutes);
app.route("/api/skills", skillsRoutes);
app.route("/api/scheduler", schedulerRoutes);
app.route("/api/llm", llmRoutes);
app.route("/api/turn", turnRoutes);
app.route("/api/conversations", conversationsRoutes);
app.route("/api/backups", backupsRoutes);

// Serving the built frontend from this same process (docs/dev.md, the
// shell/kit/Chat slice): a self-hosted single-process hub, no reverse
// proxy required for local use. Mounted last, after every /api/* route,
// so it can never shadow one. Dev mode uses the Vite dev server's own
// proxy instead (frontend/vite.config.ts), so this repo works with or
// without dist/ - including gaining it after the process already
// started (a deploy script that boots the backend before `bun run
// build` finishes the frontend): both handlers below check the
// filesystem per request rather than gating on an existsSync() read
// once at import time, which a code review (2026-09-04) found would
// otherwise 404 forever once the frontend was actually ready.
const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, "..", "..", "frontend", "dist");
const indexPath = join(distDir, "index.html");

app.use("/*", serveStatic({ root: distDir }));

// SPA fallback: any GET that isn't an API route and didn't match a
// static file is a client-side route (none exist yet with one page, but
// this is the real fallback shape rather than a 404 the moment a second
// page and a router land). index.html's content is cached after the
// first successful read rather than re-read from disk on every request:
// it never changes between builds, and a fresh deploy restarts this
// process anyway (getmaipai/.github/CLAUDE.md > Releases).
let cachedIndexHtml: string | null = null;
app.get("*", async (c) => {
  if (c.req.path.startsWith("/api/")) return c.notFound();
  if (cachedIndexHtml === null) {
    if (!existsSync(indexPath)) return c.notFound();
    cachedIndexHtml = await Bun.file(indexPath).text();
  }
  return c.html(cachedIndexHtml);
});
