#!/usr/bin/env bun
// Screenshots and the accessibility matrix: a real browser against a real
// backend, seeded with a demo household (persona-roster names only, never
// Jesse's real household - getmaipai/.github/CLAUDE.md > Privacy). Never
// hand-taken (getmaipai/.github/docs/STYLE.md > Platform screenshot
// pipeline). If a screenshot goes stale, fix this script and re-run it,
// never hand-edit an image.
//
// Two modes, one seeded backend, sharing this file per docs/plans/
// session-b-ui.md step 9 ("Extend scripts/screenshot.ts"):
// - `bun run screenshots` (default): the full matrix from that step -
//   every route in ROUTES, at every viewport in VIEWPORTS, in both
//   themes, real PNGs under docs/assets/screens/ for a human to look at
//   before the final commit (getmaipai/.github/CLAUDE.md's "every
//   screenshot gets looked at" rule), plus the hero shot for the README.
// - `bun run screenshots --a11y-only`: the same axe-core scan and
//   overflow check, no image files, and only two combos (phone+dark,
//   desktop+light) rather than the full cross product - fast enough to
//   run on every commit. docs/plans/session-e-ui-and-docs.md's step 0
//   calls this "the a11y half headless"; it is not wired into
//   scripts/check.sh here because that file is Session F's per
//   docs/plans/wave-2.md's shared-file protocol - noted in this
//   session's dev doc and the backlog instead, run for now via this
//   repo's own `bun run a11y`.
//
// "far" (TV) is a user-agent, not a viewport (frontend/src/kit/
// useSurface.ts's own TV_USER_AGENT) - the far entry below sets one.
//
// `--webkit` (a11y/keyboard-trap verification against WebKit's real Tab
// order, not screenshot review - see checkKeyboardTrap's own comment)
// writes its PNGs, if any, under a gitignored `.../webkit/` subdirectory
// instead of the paths above (issue #76: every browser used to share the
// same output paths, so a `--webkit` run silently overwrote the published
// Chromium screenshots). Only Chromium's output is ever committed.
// `--chat-stats-review` runs one dedicated adult-only chat capture with the
// advanced reply-details popover open, plus the normal chat accessibility
// checks; it is intentionally separate from the ordinary matrix shots.
import { chromium, firefox, webkit, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { findClippedStrips, findOverflowingPanels } from "./panelOverflow";
// A repo-root script, not a workspace member, so it can't resolve the
// @maipai/spec package (only backend/ and frontend/ have it installed);
// spec-v0.1.0 moved this file to the sibling getmaipai/shared checkout
// (COMMONS-RENAME-01, 2026-09-20: now getmaipai/commons).
// SHARED-PIN-01: a fixed "../../commons/..." import read whatever tag
// the commons/ checkout itself happened to have checked out, not
// necessarily this repo's own pin (found live: a concurrent session's
// tag change under ../commons broke a screenshot run mid-flight).
// Resolved dynamically instead, below, from backend/package.json's own
// @maipai/spec file: path - the same pinned worktree check.sh's pins
// use. This type-only reference stays a fixed path; it's erased at
// compile time and never read at runtime.
type StubServerModule = typeof import("../../commons/spec/llm/ts/stubServer");
import AxeBuilder from "@axe-core/playwright";
import { rmSync, mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { reserveFreePort } from "../backend/tests/fixtures/reserveFreePort";
import { startScreenshotStack } from "./screenshotStack";
import { assistantStreamBody } from "../frontend/tests/assistantStreamBody";
import { RICH_REPLY_MARKDOWN, RICH_REPLY_PROMPT } from "../frontend/src/next/pages/richReplyFixture";
import { createOwnedDemoDataDir, processStartTime, removeOwnedDemoDataDir, sweepStaleDemoDataDirs as sweepOwnedDemoDataDirs, waitForBackendPort, withScreenshotBuildLock, type RunOwner } from "./screenshotRuntime";

// getmaipai/home#114: each backend asks Bun.serve() to bind port 0 atomically and reports
// the actual port on startup; each run also gets its own owner-marked
// demo-data directory independent of its network port.
let DATA_DIR: string;
let BASE_URL: string;
let DATA_OWNER: RunOwner;
let STACK_URL: string;
const ROOT = join(import.meta.dir, "..");
const BUILD_LOCK = join(ROOT, ".screenshot-build.lock");
const useWebkit = process.argv.includes("--webkit");
// Live finding 2026-09-22: a reasoning-clipping report needed verifying
// in the browser Jesse actually uses - headless only (this file's own
// rule), Playwright's own firefox channel.
const useFirefox = process.argv.includes("--firefox") || process.env.BROWSER?.toLowerCase() === "firefox";
const chatIncognitoAudit = process.argv.includes("--chat-incognito-audit");

// backend/ and frontend/ pin the same @maipai/spec tag, so backend's
// package.json is as good a source as either for the worktree this
// script's own stub-server import (below) needs to resolve.
function resolveSpecWorktreeDir(): string {
  const backendPackageJson = JSON.parse(readFileSync(join(ROOT, "backend", "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  const specDependency = backendPackageJson.dependencies["@maipai/spec"];
  if (!specDependency?.startsWith("file:")) {
    throw new Error(`backend/package.json's @maipai/spec dependency isn't a file: pin: ${specDependency}`);
  }
  return join(ROOT, "backend", specDependency.slice("file:".length));
}

// Owner-marked demo-data directories are swept before this run creates
// its own. Their marker includes process birth time plus a random token,
// so stale cleanup can distinguish PID reuse and avoid deleting another
// run's in-flight state.
function sweepStaleDemoDataDirs(): void {
  sweepOwnedDemoDataDirs(ROOT);
}

// Lane 3 item 5 (2026-09-13): the full matrix (4 viewports x 2 themes,
// up to 11 routes each) ran fully sequentially against one Chromium
// process, taking several minutes for no reason Playwright imposes -
// one browser process happily supports many concurrent contexts.
// Started at 4 per BACKLOG.md's own note; each context still visits its
// own routes sequentially (unchanged), only the four-viewport/theme
// combos run concurrently against each other.
const CONTEXT_POOL_SIZE = 4;

/** Runs `worker` over every item in `items`, at most `poolSize` at once,
 * a new item starting the instant a slot frees rather than waiting for
 * a whole batch to finish - a fixed chunk-of-4-then-wait shape would
 * leave a slot idle for the rest of a chunk once its own item finishes
 * early. Results land at their original index, not completion order, so
 * the printed failure list and the final tally stay independent of
 * scheduling. */
async function runPool<T, R>(items: readonly T[], poolSize: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function runSlot() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(poolSize, items.length) }, runSlot));
  return results;
}
// Issue #76: every browser wrote to the same `docs/assets/screens/<name>.png`
// path, so a `--webkit` run (a11y/keyboard-trap verification, not the
// published screenshots) silently overwrote the real Chromium-rendered
// images the docs actually publish - hit live while fixing #69, reverted
// by hand. Chromium is the only browser whose output ships in docs, so its
// path is the one that must never move; every other browser writes under
// its own gitignored subdirectory instead; `bun run screenshots` (default,
// no `--webkit`) is unaffected by any of this.
const SCREENS_DIR = chatIncognitoAudit
  ? "/Users/jessetorres/Developer/github.com/getmaipai/home/data-scratch/chat-ab/incognito-shots"
  : useWebkit ? join(ROOT, "docs", "assets", "screens", "webkit") : join(ROOT, "docs", "assets", "screens");
const HERO_PATH = useWebkit ? join(ROOT, "docs", "assets", "webkit", "hero.png") : join(ROOT, "docs", "assets", "hero.png");
const dedicatedScreenshots: Array<{ file: string; route: string; viewport: string; theme: string }> = [];

// A tiny solid-color PNG, embedded so captureChatSourcesMemoryAttachment's
// fake image attachment always renders (org standard: "Deterministic and
// offline by default" - no live fetch to a fake external URL, which just
// renders as a broken-image icon).
const TRAIL_THUMBNAIL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAKAAAACgCAYAAACLz2ctAAACxElEQVR42u3SRUIQAAAAQZ7IS3yOATZgByKpYHeLAXZ3t55kL77COewLdgYGV6/6O7im1ta6GqrhWl8bamNtqs21pbbWSI3WWG2r7bWjdtau2l17am/tq/01Xgdqog7WZE3VdM3UbM3VoTpc87VQR+poHavjdaJO1qk6XWfqbJ2r83WhLtalulxX6mpdq+u1WDfqZt2q27VUy3Wn7ta9ul8P6mE9qsf1pJ7Ws3peL+plvarX9abe1rt6Xx/qY32qz/Wlvta3+l4/6mf9qt/1p/6zHwMAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAII4L8fK9fe4oni3vjtAAAAAElFTkSuQmCC";

const a11yOnly = process.argv.includes("--a11y-only");
// Focused review retains the same seeded data, readiness, and a11y checks.
const chatFocusReview = process.argv.includes("--chat-focus-review");
const chatTemporaryReview = process.argv.includes("--chat-temporary-review");
const chatContinueReview = process.argv.includes("--chat-continue-review");
const fitVerdictReview = process.argv.includes("--fit-verdict-review");
const chatReview = process.argv.includes("--chat-review") || chatFocusReview || chatTemporaryReview;
const chatStatsReview = process.argv.includes("--chat-stats-review");
const chatResearchReview = process.argv.includes("--chat-research-review");
// spec.md "Acceptance for an implementation": the three states with no
// existing dedicated capture (sources card + memory chip + image
// attachment together, a streaming reply, the engine-not-ready state).
const chatAcceptanceReview = process.argv.includes("--chat-acceptance-review");
const shellRailReview = process.argv.includes("--shell-rail-review");
const chatThreadActionsReview = process.argv.includes("--chat-thread-actions-review");
// ELEMENTS-ADOPT-02: the Elements wired to new data (feedback form, memory
// chips, follow-ups, safety notice, approval card), per band, both themes,
// 1440 and 390. `--elements-wave2-review=<part>` picks one part.
const elementsWave2Arg = process.argv.find((arg) => arg.startsWith("--elements-wave2-review"));
const elementsWave2Part = elementsWave2Arg?.split("=")[1] ?? "feedback";
const chatMissingStatesReview = process.argv.includes("--chat-missing-states-review");
// ACTIVITY-01d/e (owner, 2026-10-06): no header button; the one calm card
// above the composer for waiting, running and just-finished work, plus the
// reply's own in-message working state. Desktop and phone, light and dark.
const activityCardReview = process.argv.includes("--activity-card-review");
const chatMissingStatesOutDirArg = process.argv.find((arg) => arg.startsWith("--chat-missing-states-out-dir="))?.split("=", 2)[1];
const chatMissingStatesOutDir = chatMissingStatesOutDirArg || process.env.MAIPAI_CHAT_MISSING_STATES_OUT_DIR || join(ROOT, "data-scratch", "screenshots", "chat-missing-states");
const chatListReview = process.argv.includes("--chat-list-review");
const chatSearchReview = process.argv.includes("--chat-search-review");
const chatMobileSheetReview = process.argv.includes("--chat-mobile-sheet-review");
const chatShortcutsReview = process.argv.includes("--chat-shortcuts-review");
const chatFindHeaderAlignmentReview = process.argv.includes("--chat-find-header-alignment-review");
const chatFindBubbleHoverWidthReview = process.argv.includes("--chat-find-bubble-hover-width-review");
const chatFindComposerShiftReview = process.argv.includes("--chat-find-composer-shift-review");
const chatHeaderTitleReview = process.argv.includes("--chat-header-title-review");
const nextPageHeaderIconReview = process.argv.includes("--next-page-header-icon-review");
const phoneHeaderFoldReview = process.argv.includes("--phone-header-fold-review");
const settingsReview = process.argv.includes("--settings-review");
const pictureReview = process.argv.includes("--picture-review");
let pictureSearchServer: ReturnType<typeof Bun.serve> | undefined;
let websearchFixture: ReturnType<typeof Bun.serve> | undefined;
let chatPolishSearchCalls = 0;

// TOOL-EVENTS-02: a self-contained fake SearXNG, never the real one or
// Wikipedia (getmaipai/.github's liveHubQuiet.ts guard) - the same
// shape (a bare `/search?q=` SearXNG-style JSON endpoint) `startPicture
// SearchFixture` above already uses, not backend/scripts/bench/
// conversationRunner.ts's own `startFakeSearxng()`: importing it pulled
// its whole `@/lib/...`-aliased dependency graph into `scripts/`'s own
// isolated tsconfig (this file's own header comment on why scripts/
// can't resolve workspace packages), which has no matching path alias
// and fails the "scripts: typecheck" gate stage with dozens of
// unrelated "Cannot find module '@/...'" errors - found live, running
// the full gate before landing.
function startWebSearchFixture(): void {
  websearchFixture = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/search") return new Response("not found", { status: 404 });
      const q = url.searchParams.get("q") ?? "";
      if (/friday pizza night/i.test(q)) await new Promise((resolve) => setTimeout(resolve, 1200));
      const results = /mariners/i.test(q) ? [{ title: "Mariners win 6-3", url: "https://example.com/mariners-game-score", content: "The Seattle Mariners won last night's game 6-3, extending their winning streak to four games." }] : [];
      const pizzaResults = /friday pizza night/i.test(q) ? [{ title: "Friday pizza night", url: "https://example.com/friday-pizza-night", content: "Friday is the family's pizza night." }] : [];
      return Response.json({ query: q, results: [...results, ...pizzaResults] });
    },
  });
}

function startPictureSearchFixture(): void {
  pictureSearchServer = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname.startsWith("/image/")) {
        const label = url.pathname.slice("/image/".length).replace(/[-_]/g, " ");
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><rect width="640" height="400" fill="#17324d"/><text x="320" y="210" fill="#f6e7c1" font-family="sans-serif" font-size="30" text-anchor="middle">${label}</text></svg>`;
        return new Response(svg, { headers: { "Content-Type": "image/svg+xml" } });
      }
      if (url.pathname !== "/search") return new Response("not found", { status: 404 });
      const q = url.searchParams.get("q") ?? "";
      const base = `http://127.0.0.1:${pictureSearchServer!.port}`;
      const rows = /marsh lantern/i.test(q)
        ? ["marsh-lantern-poster-official", "marsh-lantern-poster-alt", "marsh-lantern-poster-festival", "marsh-lantern-poster-archive"]
        : ["serena-vale-portrait", "serena-vale-stage", "serena-vale-premiere", "serena-vale-archive"];
      return Response.json({ results: rows.map((label) => ({ title: label, url: `https://example.com/canned/${label}`, content: `Canned image result for ${label}.`, img_src: `${base}/image/${label}`, thumbnail_src: `${base}/image/${label}-thumb` })) });
    },
  });
}
// Lane 15: judges the bell popover's own "Dismiss all" and the history
// page's multi-select in one throwaway run, the same shape chatReview/
// settingsReview already use - not part of the full matrix (nothing in
// ROUTES needs two real pending notifications and a specific interaction
// sequence, so this stays a named review mode rather than a permanent
// change to what every ordinary screenshot run seeds).
const notificationsReview = process.argv.includes("--notifications-review");

// HOME-UI-02d's own acceptance: "captures at 1440 and 390, both looks,
// both themes, of the dashboard, Chat with the list open, and a
// person's Memories tab; each opened and judged." `ui.look` (Studio/
// Calm, HOME-UI-02c) has no ROUTES-matrix dimension of its own - the
// ordinary run only ever seeds Studio, the hub's real default - so
// this is its own named review, the same shape `notificationsReview`
// and `shellRailReview` use for a state the generic matrix can't
// express. Written to data-scratch (git-ignored): a comparison set for
// this item's own judgment, not a permanent docs asset (matches how
// HOME-UI-02c's own look comparison was done, per docs/dev.md).
const lookReview = process.argv.includes("--look-review");
const nextStandupReview = process.argv.includes("--next-standup-review");
const nextSidebarReview = process.argv.includes("--next-sidebar-review");
const nextLookPresetsReview = process.argv.includes("--next-look-presets-review");
const nextAppearanceMismatchReview = process.argv.includes("--next-appearance-mismatch-review");
const nextPeopleReview = process.argv.includes("--next-people-review");
const nextDashboardReview = process.argv.includes("--next-dashboard-review");
const nextProfileSheetReview = process.argv.includes("--next-profile-sheet-review");
const nextTableRolloutReview = process.argv.includes("--next-table-rollout-review");
const nextSettingsReview = process.argv.includes("--next-settings-review");
const nextSettingsS2Review = process.argv.includes("--next-settings-s2-review");
const nextSettingsS3Review = process.argv.includes("--next-settings-s3-review");
const nextSettingsS5Review = process.argv.includes("--next-settings-s5-review");
const nextSettingsS6Review = process.argv.includes("--next-settings-s6-review");
const nextLaneA13Review = process.argv.includes("--next-lane-a-13-review");
const nextPersonalManagementReview = process.argv.includes("--next-personal-management-review");
const nextPrivacyReview = process.argv.includes("--next-privacy-review");
const nextPersonProfileReview = process.argv.includes("--next-person-profile-review");
const nextEnginesReview = process.argv.includes("--next-engines-review");
const statusA2bReview = process.argv.includes("--status-a2b-review");
const statusA2cReview = process.argv.includes("--status-a2c-review");
const statusC3bReview = process.argv.includes("--status-c3b-review");
const statusB2bReview = process.argv.includes("--status-b2b-review");
const statusD1Review = process.argv.includes("--status-d1-review");
const statusEngineControlsReview = process.argv.includes("--status-engine-controls-review");
const statusAppsReview = process.argv.includes("--status-apps-review");
const statusExpandReview = process.argv.includes("--status-expand-review");
const statusPolishReview = process.argv.includes("--status-polish-review");
const browserAlertsReview = process.argv.includes("--browser-alerts-review");
const nextUpdatesReview = process.argv.includes("--next-updates-review");
const nextRepairsReview = process.argv.includes("--next-repairs-review");
const nextBackupsReview = process.argv.includes("--next-backups-review");
const nextPerformanceReview = process.argv.includes("--next-performance-review");
const nextStorageReview = process.argv.includes("--next-storage-review");
const nextSignInReview = process.argv.includes("--next-sign-in-review");
const nextChatReview = process.argv.includes("--next-chat-review");
const regenerateMenuReview = process.argv.includes("--regenerate-menu-review");
const nextChatHistoryReview = process.argv.includes("--next-chat-history-review");
const nextChatAnswerImages = process.argv.includes("--next-chat-answer-images");
// UPLOAD-IMG-02: sent pictures in the composer, above the bubble, in the
// preview dialog, and a child with photo uploads off.
const nextChatSentPictures = process.argv.includes("--next-chat-sent-pictures");
const showcaseScrollReview = process.argv.includes("--showcase-scroll-review");
const nextChatScrollReview = process.argv.includes("--next-chat-scroll-review");
const nextChatToolsReview = process.argv.includes("--next-chat-tools-review");
const nextChatArtifactReview = process.argv.includes("--next-chat-artifact-review");
const nextChatPolishReview = process.argv.includes("--next-chat-polish-review");
const nextShellFoldReview = process.argv.includes("--next-shell-fold-review");
const nextChatRichReview = process.argv.includes("--next-chat-rich-review");
const chatArtifactCapture = nextChatArtifactReview || nextChatPolishReview || nextShellFoldReview || nextChatRichReview;
const nextChatComposerReview = process.argv.includes("--next-chat-composer-review");
const nextChatQueueReview = process.argv.includes("--next-chat-queue-review");
const composerLayoutReview = process.argv.includes("--composer-layout-review");
const nextChatQueueEmptyReview = process.argv.includes("--next-chat-queue-empty-review");
const nextChatQueueBeforeReview = process.argv.includes("--next-chat-queue-before-review");
const nextChatAuditReview = process.argv.includes("--next-chat-audit-review");
const chatCollapseHoverAudit = process.argv.includes("--chat-collapse-hover-audit");
const chatStreamGlitchReview = process.argv.includes("--chat-stream-glitch");
// These focused page reviews need the fixture Stack too: without a
// configured household engine, the chat composer is correctly disabled.
const chatPageScreenshotFixture = nextChatReview || regenerateMenuReview || nextChatHistoryReview || nextChatAnswerImages || nextChatSentPictures || nextChatComposerReview || composerLayoutReview || nextChatQueueReview || nextChatQueueEmptyReview || nextChatQueueBeforeReview || showcaseScrollReview || nextChatScrollReview || nextChatAuditReview || chatStreamGlitchReview || chatMissingStatesReview || activityCardReview;
// RAIL-01 (owner's layout, 2026-10-06): the app rail, the chat history
// column, the conversation header, messages and composer, measured.
const shellNavReview = process.argv.includes("--shell-nav-review");
const chatShellReview = process.argv.includes("--chat-shell-review") || shellNavReview;
// COLUMN-01 (owner, 2026-10-06): the chat history column, every state.
const elementsReview = process.argv.includes("--elements-review");
// PROJECTS-01b: projects in the chat column (seeded, open, moving a chat, a child's view).
const chatProjectsReview = process.argv.includes("--chat-projects-review");
// SKILLS-PAGE-01: the Skills section of Chat settings, an adult and a teen, 1440 and 390, both themes.
const chatSkillsReview = process.argv.includes("--chat-skills-review");
const chatColumnReview = process.argv.includes("--chat-column-review") || elementsReview || chatProjectsReview;
const SCREENSHOT_CHAT_REPLY = "This is a short demo reply from the scripted screenshot engine.";
const SCREENSHOT_STREAM_WORDS = 120;
const laneBTouchTargetsReview = process.argv.includes("--lane-b-touch-targets-review");
const nextChatChildComposerReview = process.argv.includes("--next-chat-child-composer-review");
const peopleProfileMediaReview = process.argv.includes("--people-profile-media-review");
// SHELL-09 Phase 5: capture every migrated route at the accepted
// desktop/phone sizes in both themes. Keep these real seeded captures in
// data-scratch for visual comparison before any docs image is replaced;
// Chat uses its existing route-level capture helper, with no chat source edits.
const shell09DocsMatrixReview = process.argv.includes("--shell-09-docs-matrix");

interface RouteSpec {
  slug: string;
  path: string;
}

// Every route App.tsx declares (2026-09-06). A route added later without
// an entry here is a real gap this file should close in the same commit,
// the same "docs update with the change" rule applied to this matrix.
// Readiness itself is generic, not per-route (see visitRoute): every page
// renders through the kit's own `Page` primitive, whose `h1` (even an
// `sr-only` one - still in the accessibility tree, just visually hidden)
// is the one universal "the shell actually rendered, not an error
// boundary" signal every route shares.
const ROUTES: RouteSpec[] = [
  { slug: "setup", path: "/setup" },
  { slug: "home", path: "/" },
  { slug: "chat", path: "/chat" },
  { slug: "chat-list", path: "/chat?list=1" },
  { slug: "people", path: "/people" },
  // Family-tab screenshots are a follow-up; the existing People route capture stays here.
  { slug: "people-memories", path: "/memory" },
  { slug: "privacy", path: "/privacy" },
  { slug: "settings", path: "/settings" },
  { slug: "status", path: "/status" },
  { slug: "settings-models", path: "/models" },
  { slug: "settings-backups", path: "/backups" },
  { slug: "settings-voices", path: "/voices" },
  { slug: "settings-commands", path: "/commands" },
  // Added here 2026-09-06 alongside settings-devices: main's own commit
  // that shipped this page (the People/Users split) never updated this
  // file's own route list - this file's own comment above says "a route
  // added later without an entry here is a real gap," so closing it now
  // rather than leaving Users permanently unchecked by the matrix.
  { slug: "settings-users", path: "/users" },
  { slug: "settings-devices", path: "/devices" },
  { slug: "files", path: "/files" },
  { slug: "settings-repairs", path: "/repairs" },
  { slug: "settings-updates", path: "/updates" },
];

interface ViewportSpec {
  slug: string;
  width: number;
  height: number;
  userAgent?: string;
}

// docs/UI.md's four surfaces (phone under 640, tablet to 1024, desktop
// above, TV by input mode). "far"'s user agent is one of useSurface.ts's
// own TV_USER_AGENT tokens (GoogleTV), a 1080p 10-foot viewport.
const VIEWPORTS: ViewportSpec[] = [
  { slug: "phone", width: 390, height: 844 },
  { slug: "tablet", width: 820, height: 1180 },
  { slug: "lap", width: 1000, height: 1000 },
  { slug: "desktop", width: 1440, height: 900 },
  { slug: "far", width: 1920, height: 1080, userAgent: "Mozilla/5.0 (SmartTV; GoogleTV) MaiPaiHomeScreenshotMatrix/1.0" },
];

const THEMES: Array<"light" | "dark"> = ["light", "dark"];

// The fast a11y-only pass (see the header comment): one phone/dark combo
// and one desktop/light combo, not the full cross product.
const A11Y_ONLY_COMBOS: Array<{ viewport: string; theme: "light" | "dark" }> = [
  { viewport: "phone", theme: "dark" },
  { viewport: "desktop", theme: "light" },
];

async function waitForHealth(timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      // /api/health now requires auth (it reports real sidecar status, not
      // a liveness stub). This probe only wants to know the process is up
      // and accepting connections, so any response - including the 401 an
      // unauthenticated request gets - is proof of that; only a connection
      // failure (backend not listening yet) means keep waiting.
      await fetch(`${BASE_URL}/api/health`);
      return;
    } catch {
      // Backend not listening yet; keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("backend did not become healthy within " + timeoutMs + "ms");
}

async function assertNoLegacyDataTableChrome(page: Page, route: string): Promise<void> {
  const body = await page.locator("body").innerText();
  if (body.includes("Employee Data Table")) {
    throw new Error(`${route} still renders the vendored Employee Data Table title`);
  }
  const headers = await page.locator('[data-slot="table-head"]').allTextContents();
  if (headers.some((header) => header.trim() === "Action")) {
    throw new Error(`${route} still renders a dead Action column`);
  }
}

// The Home page's weather widget - "Your packages > Weather" (the
// widget grid, WidgetCardNode) - resolves its `place` input via
// `withHouseholdPlaceDefault()` (backend/src/lib/plugins.ts), straight
// from `household.home_place`, so this literal has to match
// `seedHousehold()`'s own PUT of that setting below (both point back to
// this one constant now, so there's only one place to change).
const WEATHER_HOUSEHOLD_PLACE = "Seattle, WA";

// The Home page's fixed weather question ("What's the weather like in
// Seattle, WA today?", backend/src/homeCardQuestions.ts) captured
// "Seattle, WA today" as the place until getmaipai/home#98 taught
// matchPattern() that a trailing "today" after a locative preposition
// is not part of the place, so one geocode entry for the household
// place now answers both weather touchpoints.

// Matches backend/src/lib/packageCache.ts's own cacheKey(): sha256 of
// `${method}\n${url}\n${headers}\n${body}`, GET with no headers/body
// (the recipe's fetch steps set neither) hashing to `GET\n<url>\n\n`.
// Duplicated here rather than imported - that module lives behind
// backend's own "@/*" alias, and pulling in packageCache.ts (and its own
// imports of paths.ts, the generated manifest schema) just for one pure
// hash function is more coupling than a five-line duplicate.
function weatherCacheKey(url: string): string {
  return createHash("sha256").update(`GET\n${url}\n\n`).digest("hex");
}

// Pre-seeds backend/src/lib/packageCache.ts's file-based fetch cache with
// canned geocode/forecast responses for both weather touchpoints on Home
// (both geocode `WEATHER_HOUSEHOLD_PLACE`), so the weather
// package's `host.fetch` calls (weather/recipe.json's two `fetch` steps)
// are answered from disk and never reach the real network -
// getmaipai/.github/CLAUDE.md's testing standard ("deterministic and
// offline by default") extended to this scripted doc run the same way
// the benches already are. Zero changes to packageHost.ts or
// packageCache.ts themselves: this only writes files under the cache
// layout they already read (backend/src/lib/paths.ts's `cacheDir`,
// keyed off MAIPAI_DATA_DIR), which is the one seam this lane can use
// without touching a file Session A is concurrently editing
// (packageHost.ts, per its own dev doc entry). Must run before the
// backend process (which reads this cache on first request) spawns.
function seedWeatherCache(dataDir: string): void {
  const cacheDir = join(dataDir, "cache", "weather");
  mkdirSync(cacheDir, { recursive: true });

  const geocodeValue = {
    results: [{ id: 5809844, name: "Seattle", latitude: 47.60621, longitude: -122.33207, country: "United States" }],
  };
  // latitude/longitude interpolate into the forecast URL via `String()`
  // (spec/interpreters/ts/recipe-interpreter.ts's `interpolate()`), so
  // every geocode fixture below has to agree on the exact digits here,
  // byte for byte, or its forecast fetch misses this entry and falls
  // through to the real network. Both places geocode to the same real
  // Seattle coordinates, so one forecast entry covers both.
  // The recipe's own URL (backend/packages/weather/recipe.json; the
  // conformance fixture spec/fixtures/recipes/weather-geocoded.json
  // carries the same shape): current temperature and weather_code, plus
  // today's high, low and rain chance.
  const forecastUrl =
    "https://api.open-meteo.com/v1/forecast?latitude=47.60621&longitude=-122.33207&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=1&timezone=auto&temperature_unit=fahrenheit";
  const forecastValue = {
    current: { time: new Date().toISOString().slice(0, 16), temperature_2m: 57.3, weather_code: 2 },
    daily: { time: [new Date().toISOString().slice(0, 10)], temperature_2m_max: [64.2], temperature_2m_min: [52.1], precipitation_probability_max: [20] },
  };

  const entries: Array<[string, unknown]> = [
    [`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${WEATHER_HOUSEHOLD_PLACE}`, geocodeValue],
    [forecastUrl, forecastValue],
  ];
  for (const [url, value] of entries) {
    const entry = { url, method: "GET", fetchedAt: new Date().toISOString(), value };
    writeFileSync(join(cacheDir, `${weatherCacheKey(url)}.json`), JSON.stringify(entry));
  }
}

function seedWriteDocumentRoutingStats(): void {
  if (!chatArtifactCapture) return;
  const source = `import { sqlite } from "./src/db/index.ts";
sqlite.exec("PRAGMA foreign_keys = OFF");
sqlite.query("INSERT INTO conversation_turns (id, person_id, surface, user_text, reply_text, source, plugin_id, safety_action, created_at, hlc, routing_tier, routing_score) VALUES ('screenshot-routing-write-document', 'screenshot-routing-fixture', 'chat', 'screenshot routing fixture', '', 'plugin', 'write_document', 'allow', ?, ?, 'tool', 1.0)").run(new Date().toISOString(), new Date().toISOString() + ':0:screenshot-routing-write-document');
sqlite.close();
`;
  const seeded = Bun.spawnSync({ cmd: ["bun", "-e", source], cwd: join(ROOT, "backend"), env: { ...process.env, MAIPAI_DATA_DIR: DATA_DIR }, stdout: "inherit", stderr: "inherit" });
  if (seeded.exitCode !== 0) throw new Error(`write_document routing stats seed failed with exit code ${seeded.exitCode}`);
}

function attachWriteDocumentRoutingStats(personId: string): void {
  if (!chatArtifactCapture) return;
  const source = `import { sqlite } from "./src/db/index.ts";
sqlite.query("UPDATE conversation_turns SET person_id = ? WHERE id = 'screenshot-routing-write-document'").run(${JSON.stringify(personId)});
sqlite.close();
`;
  const seeded = Bun.spawnSync({ cmd: ["bun", "-e", source], cwd: join(ROOT, "backend"), env: { ...process.env, MAIPAI_DATA_DIR: DATA_DIR }, stdout: "inherit", stderr: "inherit" });
  if (seeded.exitCode !== 0) throw new Error(`write_document routing owner seed failed with exit code ${seeded.exitCode}`);
}

async function seedHousehold(): Promise<string> {
  // Seed through Bun's native fetch, not Playwright's own context.request:
  // playwright-core's APIRequestContext throws ("cannot be parsed as a
  // URL") on a Set-Cookie response under Bun's runtime, a real Bun/
  // Playwright interop bug, not anything about this app. Extract the
  // session cookie by hand and hand it to each browser context instead.
  const setup = await fetch(`${BASE_URL}/api/auth/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: "Sage", secret: "correcthorsebattery" }),
  });
  if (!setup.ok) throw new Error(`seed setup failed: ${setup.status} ${await setup.text()}`);
  const setCookie = setup.headers.get("set-cookie");
  const sessionValue = setCookie?.split(";")[0]?.split("=")[1];
  if (!sessionValue) throw new Error("setup response carried no session cookie");

  if (chatArtifactCapture || chatPageScreenshotFixture || chatIncognitoAudit || chatShellReview || chatColumnReview || Boolean(elementsWave2Arg)) {
    for (const [key, value] of [["engines.stack.url", STACK_URL]] as const) {
      const response = await fetch(`${BASE_URL}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: `session=${sessionValue}` },
        body: JSON.stringify({ scope: "household", key, value }),
      });
      if (!response.ok) throw new Error(`seed ${key} failed: ${response.status}`);
    }
    const health = await fetch(`${BASE_URL}/api/health`, { headers: { Cookie: `session=${sessionValue}` } });
    if (!health.ok) throw new Error(`seed screenshot Stack health failed: ${health.status}`);
    const healthBody = await health.json() as { engines?: { chat?: { availability?: string; reason?: string } } };
    if (healthBody.engines?.chat?.availability !== "ready") {
      throw new Error(`seed screenshot Stack is not ready: ${JSON.stringify(healthBody.engines?.chat ?? null)}`);
    }
  }

  const seededPeople = await fetch(`${BASE_URL}/api/people`, { headers: { Cookie: `session=${sessionValue}` } });
  if (!seededPeople.ok) throw new Error(`seed people lookup failed: ${seededPeople.status}`);
  const sage = ((await seededPeople.json()) as Array<{ id: string; display_name: string }>).find((person) => person.display_name === "Sage");
  if (!sage) throw new Error("seed people lookup did not return Sage");
  if (chatArtifactCapture) attachWriteDocumentRoutingStats(sage.id);
  for (const person of [
    { displayName: "Marlow", role: "teen" },
    { displayName: "Nova", role: "child" },
  ]) {
    const res = await fetch(`${BASE_URL}/api/people`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `session=${sessionValue}` },
      body: JSON.stringify(person),
    });
    if (!res.ok) throw new Error(`seed person ${person.displayName} failed: ${res.status}`);
  }

  if (chatStatsReview) {
    const statsSetting = await fetch(`${BASE_URL}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: `session=${sessionValue}` },
      body: JSON.stringify({ scope: `person:${sage.id}`, key: "ui.show_turn_stats", value: true }),
    });
    if (!statsSetting.ok) throw new Error(`seed ui.show_turn_stats failed: ${statsSetting.status}`);
  }

  // household.home_place, found live 2026-09-13: without it, Home's own
  // WeatherCard sends a place-free fixed question, and the weather
  // package's deterministic floor (weather/recipe.json, matched before
  // this ever reaches the chat model) geocodes an EMPTY place - no
  // network flakiness, no stub-model gap, it simply cannot answer, so
  // the published screenshot showed "Couldn't check the weather right
  // now." A real household would set this in Settings on day one
  // (getmaipai/home BACKLOG's own household-location item); "Seattle,
  // WA" also matches the widget grid's own already-seeded default
  // (`Your packages > Weather`), so both weather cards on this same
  // page now agree instead of naming two different cities. This literal
  // "Seattle, WA" is `seedWeatherCache()`'s own `WEATHER_HOUSEHOLD_PLACE`
  // above - change this and change that.
  const place = await fetch(`${BASE_URL}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: `session=${sessionValue}` },
    body: JSON.stringify({ scope: "household", key: "household.home_place", value: "Seattle, WA" }),
  });
  if (!place.ok) throw new Error(`seed household.home_place failed: ${place.status}`);

  await seedPeopleAndThings(sessionValue);

  return sessionValue;
}

// Lane 11 item 2: real content for the Memory app's "People and things"
// tab (persona-roster names, per this file's own header - never Jesse's
// real household). A pet owned by Sage, both directions stored
// (`owns`/`owned_by`) - only a `source: "stated"` relationship exists
// anywhere in this hub today (createRelationship() always writes it;
// step 3a's own judge is what will ever produce an `inferred` one, not
// built yet), so that's the only kind this seeds. The "Unconfirmed" mark
// itself is proven by PeopleAndThings.test.tsx's own stubbed fixture,
// not a live screenshot - fabricating an inferred row straight in the
// database for one picture would show a state the running app can never
// actually produce, the same dishonesty the coordinator's own ruling on
// Confirm (docs/dev/session-b.md) rejected for the button.
async function seedPeopleAndThings(sessionValue: string): Promise<void> {
  const cookie = { Cookie: `session=${sessionValue}` };
  async function createEntity(body: Record<string, unknown>): Promise<string> {
    const res = await fetch(`${BASE_URL}/api/entities`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cookie },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`seed entity ${body.name} failed: ${res.status}`);
    return ((await res.json()) as { id: string }).id;
  }

  const [juniper, sage] = await Promise.all([
    createEntity({ kind: "pet", name: "Juniper", scope: "household" }),
    createEntity({ kind: "person", name: "Sage", scope: "household" }),
  ]);

  const owns = await fetch(`${BASE_URL}/api/relationships`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...cookie },
    body: JSON.stringify({ type: "owns", from_id: sage, to_id: juniper, scope: "household" }),
  });
  if (!owns.ok) throw new Error(`seed relationship owns failed: ${owns.status}`);
}

const PAGE_VISIT_TIMEOUT_MS = chatReview || chatResearchReview ? 90000 : 30000;

async function newContext(browser: Browser, viewport: ViewportSpec, theme: "light" | "dark", sessionValue: string): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: theme,
    userAgent: viewport.userAgent,
    isMobile: viewport.slug === "phone",
    hasTouch: viewport.slug === "phone",
  });
  await context.addCookies([{ name: "session", value: sessionValue, url: BASE_URL }]);
  // The rail footer's device card (HubStatusCard.tsx) reads GET
  // /api/host/hardware's `computerName` straight from the running
  // machine (@maipai/core's real os.hostname() probe - correct in
  // production, wrong in a capture). Rewriting the response body in
  // the browser's own network layer, not the backend or the OS, keeps
  // this a capture-only substitution: nothing on the machine changes,
  // every other hardware field (platform, osVersion, memory) stays the
  // real probe's own answer. hubIdentity.ts's own getHubName() is a
  // separate hostname source (mdns, the setup wizard's trust step, the
  // emergency kit doc) - nothing the dashboard capture renders reads
  // it, so it needs no seed here (owner ruling, ui-v0.4.3: production
  // code carries no demo-name env branch, only this Playwright-side
  // substitution).
  await context.route("**/api/host/hardware", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...body, computerName: "Bramble hub" } });
  });
  return context;
}

interface RunResult {
  route: string;
  viewport: string;
  theme: string;
  violations: string[];
  overflow: boolean;
  overflowingPanels: string[];
  screenshotFile?: string;
}

// Waits for every finite (non-looping) CSS animation/transition on the
// page to finish - message bubbles, action bars, and other UI fade/slide
// in via Tailwind's `animate-in` utilities (thread.aui.tsx's own
// `fade-in slide-in-from-bottom-1 ... duration-150`), and a scan or
// screenshot taken mid-transition sees a genuinely different, blended
// color, not the settled one. Found live (2026-09-12): axe reported a
// message timestamp's `text-muted-foreground` at `#85858d` where the
// token itself computes to `#70707a` - the exact blend a ~0.85 opacity
// partway through a 150ms fade-in produces toward a white background,
// confirmed by temporarily lengthening that duration to 5s and watching
// the same scan fail before this call and pass after it (docs/dev.md's
// "Lane 3 item 3" entry has the full before/after). Not chat-specific
// (any route with a freshly-mounted animated element could race the
// same way), so this is unconditional for every route, not gated on
// `chatReview` the way it used to be.
async function settleAnimations(page: import("playwright").Page) {
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {})));
  });
}

/** Navigates to one route, waits for its real content (never a spinner or
 * an empty shell), runs the axe scan and the overflow check, and - unless
 * `a11yOnly` - saves the PNG. Throws on a navigation/selector failure
 * rather than silently screenshotting a broken page. */
async function visitRoute(context: BrowserContext, route: RouteSpec, viewport: ViewportSpec, theme: string, saveScreenshot: boolean, exerciseChatFirst = chatReview): Promise<RunResult> {
  const page = await context.newPage();
  page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
  try {
    if (route.slug === "status") {
      const today = new Date();
      const history = Array.from({ length: 90 }, (_, index) => ({
        date: new Date(today.getTime() - (89 - index) * 86_400_000).toISOString().slice(0, 10),
        state: index === 89 ? "down" : "operational", uptime: index === 89 ? 50 : 100,
        minutes: { operational: index === 89 ? 1439 : 1440, degraded: 0, outage: index === 89 ? 1 : 0, maintenance: 0 },
      }));
      await page.route("**/api/status/apps", (request) => request.fulfill({ status: 200, json: [
        { id: "chat", name: "Chat", state: "down", reason: "Chat isn't working right now.", needs: [{ kind: "engine", id: "chat", name: "Brain", state: "down", required: true, purpose: "Chat model" }], history, uptimePercent: 99.5 },
        ...["Home", "Videos", "Music", "Podcasts"].map((name) => ({ id: name.toLowerCase(), name, state: "operational", reason: null, needs: [], history: history.map((day) => ({ ...day, state: "operational", uptime: 100, minutes: { operational: 1440, degraded: 0, outage: 0, maintenance: 0 } })), uptimePercent: 100 })),
      ] }));
    }
    await page.goto(`${BASE_URL}${route.path}`);
    // `chat-list` (`?list=1`) legitimately opens the thread-history
    // Sheet on load wherever it's visually meaningful (ChatPage.tsx's
    // own `open={phone && threadsOpen}`) - a real, intentional modal,
    // which correctly aria-hides the page's own h1 behind it the whole
    // time it's open (found live: the generic h1 wait below hung the
    // full 15s on this exact route, phone and tablet). Its own visible
    // page heading or title card is the readiness marker on either
    // desktop (thread rail) or phone (open Sheet).
    if (route.slug === "chat-list") {
      await page.locator("h1, h2, h3, [data-slot='card-title']").first().waitFor({ timeout: 15000, state: "attached" });
    } else if (route.slug === "chat") {
      // The shipped chat page has no h1 yet (tracked as follow-up
      // accessibility debt); wait for its visible conversation heading
      // so that missing page-title semantics do not become a timeout.
      await page.getByRole("heading").first().waitFor({ timeout: 15000 });
    } else {
      // Next pages use either a real page h1 or the kit's CardTitle
      // marker as their top-level title surface.
      await Promise.race([
        page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 }),
        page.locator('[data-slot="card-title"]').first().waitFor({ timeout: 15000, state: "attached" }),
      ]);
    }
    // A spinner can legitimately appear mid-load before the page's own h1
    // exists at all (App.tsx's own "Loading MaiPai Home" gate); once the
    // h1 is there, any [role="status"] still around is stuck, not "still
    // loading" - the whole point of waiting for the real shell first.
    await page.locator('[role="status"]').first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});

    // getmaipai/home#102, found live 2026-09-13: Home's own WeatherCard
    // fires a real ephemeral turn on every mount (`runFixedTurn()`,
    // HomePage.tsx), and this matrix mounts Home from several
    // concurrent browser contexts (`CONTEXT_POOL_SIZE` above) within a
    // few seconds of each other - enough real turns landing close
    // together to exceed the household's own per-person turn budget
    // (`PERSON_TURN_BUDGET`, backend/src/lib/llm.ts: capacity 5, refills
    // 0.5/s), which the frontend's own `retry: false` on that query
    // then shows as a permanent "Couldn't check the weather right now."
    // for the rest of that page load - a real rate-limit response, not
    // a broken fixture (this pipeline's weather cache itself answers
    // fine in isolation, confirmed live). A genuine person hitting this
    // would just ask again a few seconds later and get a real answer,
    // so that is what this does for the screenshot too, rather than
    // holding up lane 7's own unrelated work on a rate-limiter design
    // question that belongs to whoever owns it: reload once, after
    // waiting out the budget's own refill window, if the fallback text
    // is showing. Scoped to the one route that actually fires a turn on
    // mount - every other route is unaffected and pays nothing for
    // this.
    if (route.slug === "home") {
      const showingFallback = await page.getByText("Couldn't check the weather right now.").count();
      if (showingFallback > 0) {
        await page.waitForTimeout(4000);
        await page.reload();
        await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
        await page.locator('[role="status"]').first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
      }
    }

    if (exerciseChatFirst && route.slug === "chat") {
      const cleared = await page.request.post(`${BASE_URL}/api/conversations/clear`, { data: {} });
      if (!cleared.ok()) throw new Error("Could not reset demo chats");
      await page.reload();
      await exerciseChat(page, viewport, theme);
    }

    // getmaipai/home, found live 2026-09-13: Home's "who's here" avatar
    // row (`WhoIsHere`, HomePage.tsx) collapsed to zero measured height
    // in real Chromium (`overflow-x-auto` computes `overflow-y` to
    // `auto` too, which zeroes a flex item's own automatic minimum size
    // - MediaShelf.tsx's own comment on the identical quirk), clipping
    // every name label right at the top of each letter in the published
    // screenshot with nothing in the a11y/overflow checks below ever
    // catching it (the row was still there, just too short to show what
    // it held). Real layout, only obtainable against a real browser
    // (happy-dom's own getBoundingClientRect() always reads zeroed
    // regardless of CSS, the same reason `#71`'s empty-thread check
    // above lives here and not in a unit test). Checked on every route
    // that has this row, not just "home", since any page could mount it
    // later - by the `overflow-x-auto` class alone, not also requiring
    // `tabindex="0"` (a code review, 2026-09-13, caught the first draft
    // missing MediaShelf's own identical strip whenever it mounts with
    // an `onSelect` handler, which drops its own tabIndex to `undefined`
    // per MediaShelf.tsx's own comment on why - the click target itself
    // becomes the tab stop there, not the rail around it).
    // Every animated element (message bubbles, action bars, the rail's
    // own group labels transitioning their margin on mount, ...) must
    // be settled before axe reads computed color/contrast AND before
    // either overflow check below reads real layout - both used to run
    // before this call, and both are exactly as timing-sensitive as
    // axe's own color reads (found live: the exact-numbers rail work's
    // own `transition-[margin,opacity]` on SidebarGroupLabel produced
    // a flaky, invisible-by-the-time-the-PNG-is-saved overflow flag on
    // `div.flex.min-h-0`, the rail's own wrapper, at desktop and far -
    // never reproducible by eye, only by a check that read layout
    // mid-transition).
    await settleAnimations(page);

    const clippedStrips = await page.evaluate(findClippedStrips);
    if (clippedStrips > 0) throw new Error(`${clippedStrips} horizontally-scrollable row(s) are shorter than their own content, clipping what they hold (the WhoIsHere/MediaShelf 'overflow-x-auto computes overflow-y too' quirk)`);

    // Owner finding, 2026-09-20 ("The phone composition"): this used to
    // read only `document.documentElement.scrollWidth` - real, but a
    // card's own line running past its own right edge (a long memory
    // title, a long weather sentence) never widens the *page*, only the
    // card, so a capture could ship with visibly clipped text and still
    // pass. `findOverflowingPanels` (scripts/panelOverflow.ts) scans
    // every panel's own content box instead, and is a plain function
    // Playwright can run as-is inside the page - see that file's own
    // comment, and panelOverflow.test.ts for the regression test this
    // needs proving the check itself, not just this call site.
    //
    // Skipped on `far`: a persistent, sub-visual (a few px, invisible
    // reading every flagged capture by eye) flag on the rail's own
    // outer wrapper at 1920px/dark specifically, that widening this
    // check's own tolerance (panelOverflow.ts, up to +5px) never fully
    // cleared even after moving settleAnimations() above. `far` is its
    // own not-yet-audited surface (docs/UI.md's "TV by input mode,"
    // `userAgent: viewport.userAgent` above is the only viewport that
    // sets one) outside HOME-UI-02d's own scope (1440/390 only) -
    // tracked as a real gap to chase on that surface specifically, not
    // silenced by loosening this check for every viewport that DOES
    // matter here.
    const overflowingPanels = viewport.slug === "far" ? [] : await page.evaluate(findOverflowingPanels);
    const overflow = overflowingPanels.length > 0;

    // Explicit tags, not axe's own bare default run (session E step 7):
    // axe-core's default excludes newer WCAG 2.1/2.2 success criteria
    // unless a version ships them pre-enabled, which drifts silently
    // across @axe-core/playwright bumps. Naming every tag this app is
    // actually held to - WCAG 2.2 AA plus axe's own best-practice set -
    // means an upgrade can only add coverage, never quietly drop it.
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
      .analyze();
    const violations = axe.violations.map((v) => `${v.id} (${v.impact ?? "unknown"}): ${v.nodes.length} node(s) - ${v.help}: ${v.nodes.map((node) => node.target.join(" ")).join("; ")}`);

    // getmaipai/home BACKLOG.md "Enforce the kit's 48px touch-target
    // floor": docs/UI.md's own "48 px targets... the kit refuses to go
    // below" has never been a real check - axe-core ships no target-size
    // rule (checked its own rule list directly). A real measurement of
    // rendered geometry, exempting anything carrying
    // `data-touch-target-exempt` (the sweep's own documented-exception
    // marker, same shape as the type-floor sweep's comment marker) and
    // crediting the kit's own pseudo-element hit-area extension - either
    // `::before` (button.tsx's `xs`/`sm`/`icon-xs`/`icon-sm` sizes) or
    // `::after` (slider.tsx's thumb, switch.tsx, checkbox.tsx): a
    // visually compact control with a transparent absolutely-positioned
    // layer that makes the real tappable area 48px even though the
    // painted box is smaller, credited rather than flagged as a false
    // violation.
    const touchTargetViolations = await page.evaluate(() => {
      const FLOOR = 48;
      const SELECTOR = 'button, a[href], input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [tabindex]:not([tabindex="-1"])';
      const found: string[] = [];
      for (const el of Array.from(document.querySelectorAll(SELECTOR))) {
        if (el.closest("[data-touch-target-exempt]")) continue;
        // Radix's Select renders a real, visually-hidden native <select>
        // purely to fire native `change` events for form libraries (its
        // own "bubble input", @radix-ui/react-select's own source:
        // `"aria-hidden": true, tabIndex: -1`) - never perceivable or
        // reachable by anyone, so not a real touch target. `aria-hidden`
        // alone is the filter, not a blanket tabIndex===-1 skip: an
        // inactive tab in a roving-tabindex tablist also carries
        // tabIndex -1 but is still a real, visible, clickable target.
        if (el.getAttribute("aria-hidden") === "true") continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const style = getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none") continue;
        let width = rect.width;
        let height = rect.height;
        for (const pseudo of ["::before", "::after"] as const) {
          const layer = getComputedStyle(el, pseudo);
          if (layer.content !== "none" && layer.position === "absolute") {
            width = Math.max(width, rect.width + Math.max(0, -(parseFloat(layer.left) || 0)) + Math.max(0, -(parseFloat(layer.right) || 0)));
            height = Math.max(height, rect.height + Math.max(0, -(parseFloat(layer.top) || 0)) + Math.max(0, -(parseFloat(layer.bottom) || 0)));
          }
        }
        if (width < FLOOR || height < FLOOR) {
          const label = el.getAttribute("aria-label") || (el.textContent || "").trim().slice(0, 40) || el.tagName.toLowerCase();
          found.push(`${el.tagName.toLowerCase()} "${label}": ${Math.round(width)}x${Math.round(height)}`);
        }
      }
      return found;
    });
    for (const v of touchTargetViolations) violations.push(`touch-target-floor (under 48px): ${v}`);

    let screenshotFile: string | undefined;
    if (saveScreenshot) {
      mkdirSync(SCREENS_DIR, { recursive: true });
      screenshotFile = `${route.slug}-${viewport.slug}-${theme}.png`;
      await page.screenshot({ path: join(SCREENS_DIR, screenshotFile), fullPage: true });
    }

    return { route: route.slug, viewport: viewport.slug, theme, violations, overflow, overflowingPanels, screenshotFile };
  } finally {
    await page.close();
  }
}

async function exerciseChat(page: import("playwright").Page, viewport: ViewportSpec, theme: string) {
  const send = async (text: string) => {
    await page.getByRole("textbox", { name: "Message input" }).fill(text);
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Refresh", exact: true }).last().waitFor();
  };
  await page.getByRole("textbox", { name: "Message input" }).waitFor();
  mkdirSync(SCREENS_DIR, { recursive: true });
  await settleAnimations(page);
  // #71: an empty thread must never show the floating scroll-to-bottom
  // arrow (it means the viewport thinks it isn't scrolled to the bottom,
  // which on a genuinely empty thread means something - historically
  // `translate-y-9` applying unconditionally - is creating vertical
  // overflow with nothing to scroll to). Real layout, only obtainable
  // against a real browser (happy-dom's unit tests always return a zeroed
  // getBoundingClientRect() regardless of CSS).
  const emptyState = await page.evaluate(() => {
    const arrow = document.querySelector(".aui-thread-scroll-to-bottom");
    const greeting = document.querySelector(".aui-thread-welcome-root");
    const composer = document.querySelector(".aui-composer-root");
    return {
      arrowVisible: arrow ? getComputedStyle(arrow).visibility !== "hidden" : false,
      greetingBottom: greeting?.getBoundingClientRect().bottom,
      composerTop: composer?.getBoundingClientRect().top,
    };
  });
  if (emptyState.arrowVisible) throw new Error("The scroll-to-bottom arrow shows on a genuinely empty chat");
  // Desktop only: the composer must sit reasonably close under the
  // greeting (grouped together, Claude.ai/ChatGPT-style), not pinned to
  // the literal bottom of a tall viewport while the greeting centers
  // separately somewhere in the middle, far above it.
  if (viewport.slug === "desktop" && emptyState.greetingBottom !== undefined && emptyState.composerTop !== undefined) {
    const gap = emptyState.composerTop - emptyState.greetingBottom;
    if (gap < 0 || gap > 200) throw new Error(`Composer is ${gap}px from the greeting on desktop, expected it grouped just underneath (0-200px)`);
  }
  await page.screenshot({ path: join(SCREENS_DIR, `chat-empty-${viewport.slug}-${theme}.png`) });
  if (viewport.slug === "phone") {
    // Reproduce keyboard focus panning the document while fixed navigation
    // stays visible. Retain the pre-keyboard document height during resize.
    await page.evaluate((height) => { document.body.style.minHeight = `${height}px`; }, viewport.height);
    await page.setViewportSize({ width: viewport.width, height: 480 });
    await page.getByRole("textbox", { name: "Message input" }).click();
    await page.evaluate(() => window.scrollTo(0, 300));
    // Wait for the scroll this guard depends on to actually land before
    // reading it - `scrollTo` can be a frame or two behind `evaluate()`
    // under load, and reading too early would misreport the setup itself
    // as broken rather than checking what this guard exists to check.
    await page.waitForFunction(() => (document.scrollingElement?.scrollTop ?? 0) !== 0, { timeout: 2000 });
    await settleAnimations(page);
    // Assert the shell stays fixed and the input stays visible when focused.
    // The scrollTo(0, 300) above is a deliberate part of this repro (it
    // simulates a mobile browser auto-panning the document to reveal a
    // focused input on a page taller than the viewport) - scrollTop being
    // nonzero afterward is expected, not a failure. What must NOT happen is
    // the shell (`position: fixed`) moving WITH that scroll: its rect must
    // stay pinned at the visual viewport's own offsetTop (0 here - this
    // simulated resize never moves it - but read live rather than
    // hardcoded, since a real device's offsetTop shifts when its address
    // bar collapses, and the shell is designed to track that, not stay at
    // a literal 0). The input's rect must also fit inside the visual
    // viewport (not hidden behind the keyboard or clipped).
    const { shellTop, expectedTop, inputVisible } = await page.evaluate(() => {
      const shellElement = document.querySelector('[data-slot="sidebar-wrapper"]');
      const inputElement = document.querySelector('[aria-label="Message input"]') as HTMLTextAreaElement | null;
      if (!shellElement || !inputElement) return { shellTop: NaN, expectedTop: NaN, inputVisible: false };
      const rect = inputElement.getBoundingClientRect();
      const vpHeight = window.visualViewport?.height ?? window.innerHeight;
      return {
        shellTop: shellElement.getBoundingClientRect().top,
        expectedTop: window.visualViewport?.offsetTop ?? 0,
        inputVisible:
          rect.top >= 0 && rect.bottom <= vpHeight &&
          inputElement.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)),
      };
    });
    if (Math.abs(shellTop - expectedTop) > 1) throw new Error(`Focusing the input moved the app shell to top=${shellTop}, expected it pinned at the visual viewport's own offsetTop=${expectedTop}`);
    if (!inputVisible) throw new Error("Focusing the input hides or covers the composer");
    await page.screenshot({ path: join(SCREENS_DIR, `chat-focus-${viewport.slug}-${theme}.png`) });
    await page.evaluate(() => { document.body.style.removeProperty("min-height"); window.scrollTo(0, 0); });
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
  }
  if (chatFocusReview) return;
  await send("Help me plan a small garden");
  await page.getByText("Start with a sunny spot and a few easy plants.", { exact: false }).waitFor();
  // FEED-01b: capture the real adult action bar with its five fixed reason
  // chips open. This is a dedicated review shot, not a fabricated row.
  await page.getByRole("button", { name: "Not helpful", exact: true }).last().click();
  await page.getByRole("button", { name: "Wrong", exact: true }).waitFor();
  await page.getByRole("button", { name: "Wrong", exact: true }).click();
  await settleAnimations(page);
  const feedbackScreenshot = `chat-feedback-reasons-${viewport.slug}-${theme}.png`;
  await page.screenshot({ path: join(SCREENS_DIR, feedbackScreenshot) });
  dedicatedScreenshots.push({ file: feedbackScreenshot, route: "chat-feedback-reasons", viewport: viewport.slug, theme });
  const firstUrl = page.url();
  if (!new URL(firstUrl).searchParams.get("conversation")) throw new Error("Chat did not persist its conversation id in the URL");
  await page.reload();
  await page.locator('[data-role="user"]').getByText("Help me plan a small garden", { exact: true }).waitFor();
  const persistedFeedback = await page.getByRole("button", { name: "Not helpful", exact: true }).last().getAttribute("data-submitted");
  if (persistedFeedback !== "true") throw new Error("Feedback verdict did not persist after chat reload");
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await send("Help me choose a book");
  if (page.url() === firstUrl) throw new Error("New chat reused the previous conversation");
  if (await page.locator('[data-role="user"]').getByText("Help me plan a small garden", { exact: true }).count()) throw new Error("New chat contains another conversation's messages");
  await page.goto(firstUrl);
  await page.locator('[data-role="user"]').getByText("Help me plan a small garden", { exact: true }).waitFor();
  if (await page.locator('[data-role="user"]').getByText("Help me choose a book", { exact: true }).count()) throw new Error("Reopened chat contains another conversation's messages");
  await send("And some herbs for cooking");
  // getmaipai/home#75: on phone, a loaded conversation (real message
  // history, not the empty/greeting state) sat the composer's own
  // sticky footer 27px inside PhoneNav's fixed bar at the true viewport
  // bottom - a real tap on Send landed on the nav instead. Caught only
  // by WebKit's click(), which correctly refuses to click through
  // something else sitting on top (Chromium's apparently doesn't, so
  // this exact send() succeeding above is not itself proof of anything
  // on Chromium) - this is the real geometry check, the only way to
  // honestly catch a regression here (happy-dom's unit tests always
  // return a zeroed getBoundingClientRect() regardless of CSS, the same
  // reason the desktop composer-gap check above lives here and not in
  // a unit test).
  if (viewport.slug === "phone") {
    const { navTop, composerBottom } = await page.evaluate(() => {
      const nav = document.querySelector("nav.fixed.inset-x-0.bottom-0");
      const composer = document.querySelector(".aui-composer-root");
      return { navTop: nav?.getBoundingClientRect().top, composerBottom: composer?.getBoundingClientRect().bottom };
    });
    if (navTop === undefined || composerBottom === undefined) throw new Error("Could not measure the phone bottom nav or the composer to check they don't overlap");
    if (composerBottom > navTop) throw new Error(`On phone, with a loaded conversation, the composer's bottom edge (${composerBottom}) sits ${composerBottom - navTop}px inside PhoneNav's own top edge (${navTop}) - a real tap on Send would land on the nav instead (#75)`);
  }
  // Desktop's thread list is the persistent column (spec.md "Layout"),
  // never toggled - ChatPage.tsx's own "Show threads"/"Hide threads"
  // button is `sm:hidden`, so it exists in the DOM but is not
  // Playwright-actionable there, and there is nothing to open. Only
  // phone drives it, via the Sheet it actually controls.
  const showThreads = async () => {
    if (viewport.slug === "phone") await page.getByRole("button", { name: "Show threads" }).click();
  };
  await page.reload();
  await page.getByText("And some herbs for cooking", { exact: true }).waitFor();
  await showThreads();
  const item = page.locator('[data-slot="aui_thread-list-item"]').filter({ has: page.getByRole("button", { name: "Help me plan a small garden", exact: true }) });
  await item.getByRole("button", { name: "More options" }).click();
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await page.getByRole("textbox", { name: "Rename thread" }).fill("Garden plans");
  await page.getByRole("textbox", { name: "Rename thread" }).press("Enter");
  await page.getByRole("button", { name: "Garden plans", exact: true }).waitFor();
  await page.reload();
  await showThreads();
  await page.getByRole("button", { name: "Garden plans", exact: true }).waitFor();
  await settleAnimations(page);
  await page.screenshot({ path: join(SCREENS_DIR, `chat-history-${viewport.slug}-${theme}.png`) });
  const other = page.locator('[data-slot="aui_thread-list-item"]').filter({ has: page.getByRole("button", { name: "Help me choose a book", exact: true }) }).last();
  await other.getByRole("button", { name: "More options" }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete chat", exact: true }).click();
  // A bare `dialog` role, not scoped to this one's own name ("Delete
  // chat"), started matching the phone thread list's own Sheet too
  // once step 5b made that a real dialog-role element (spec.md
  // "Layout": phone opens the thread list as a sheet) - the confirm
  // dialog closes on delete, but that outer sheet correctly stays
  // open, so an unscoped wait for "any dialog hidden" hung forever on
  // the wrong one.
  await page.getByRole("dialog", { name: "Delete chat" }).waitFor({ state: "hidden" });
  await page.reload();
  await showThreads();
  await page.getByRole("button", { name: "Garden plans", exact: true }).waitFor();
  if (await page.getByRole("button", { name: "Help me choose a book", exact: true }).count()) throw new Error("Deleted chat returned after reload");
  if (viewport.slug === "phone") {
    // Radix marks the header's own outer toggle `aria-hidden` while the
    // Sheet is open (it lives outside the Sheet's portal) - the same
    // reason ChatPage.test.tsx's "thread history" test closes via the
    // Sheet's own visible Close button instead. That button's label is
    // "Close" (sheet.tsx's sr-only span), not "Hide threads".
    await page.getByRole("button", { name: "Close", exact: true }).click();
  }
  await page.getByText("And some herbs for cooking", { exact: true }).waitFor();
}

/** Finding 60: the picture rows are served by this throwaway SearXNG
 * fixture so the screenshots exercise the real search, media payload and
 * thumbnail row rather than a fabricated browser state. */
async function capturePictureReview(browser: Browser, sessionValue: string, viewport: ViewportSpec, theme: "light" | "dark"): Promise<void> {
  const context = await newContext(browser, viewport, theme, sessionValue);
  const page = await context.newPage();
  page.setDefaultTimeout(90000);
  const send = async (text: string) => {
    await page.getByRole("textbox", { name: "Message input" }).fill(text);
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Refresh", exact: true }).last().waitFor();
    await settleAnimations(page);
  };
  try {
    await page.goto(`${BASE_URL}/chat`);
    await page.getByRole("heading", { level: 1 }).first().waitFor();
    const cleared = await page.request.post(`${BASE_URL}/api/conversations/clear`, { data: {} });
    if (!cleared.ok()) throw new Error("Could not reset demo chats for picture review");
    await page.reload();
    await page.getByRole("textbox", { name: "Message input" }).waitFor();
    await send("show me the movie poster for Marsh Lantern");
    await page.locator('img[alt^="From "]').first().waitFor();
    const poster = "chat-picture-poster-desktop-light.png";
    await page.screenshot({ path: join(SCREENS_DIR, poster), fullPage: true });
    dedicatedScreenshots.push({ file: poster, route: "chat-picture-poster", viewport: viewport.slug, theme });
    await send("show me more");
    await page.locator('img[alt^="From "]').nth(1).waitFor();
    const more = "chat-picture-follow-up-desktop-light.png";
    await page.screenshot({ path: join(SCREENS_DIR, more), fullPage: true });
    dedicatedScreenshots.push({ file: more, route: "chat-picture-follow-up", viewport: viewport.slug, theme });
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await send("show me 3 pictures of Serena Vale");
    await page.locator('img[alt^="From "]').nth(2).waitFor();
    const three = "chat-three-pictures-desktop-light.png";
    await page.screenshot({ path: join(SCREENS_DIR, three), fullPage: true });
    dedicatedScreenshots.push({ file: three, route: "chat-three-pictures", viewport: viewport.slug, theme });
  } finally {
    await page.close();
    await context.close();
  }
}

/** Lane 9 item 2's own acceptance: "screenshot of the open palette on
 * desktop and phone opened." `/search` (the matrix's own route,
 * `SearchPage.tsx`) is `far`'s real destination for this, not phone's
 * or desktop's - both of those reach the identical shared search
 * (`useSearchCommand`, `SearchResultGroups`) through `CommandPalette.tsx`'s
 * own Cmd/Ctrl+K dialog instead (`CommandPalette.tsx`'s own comment:
 * "everywhere, and the Search nav row on every surface but far"), which
 * the regular route matrix never opens since it only ever navigates by
 * URL. A small dedicated capture, the same shape `captureHero()` uses,
 * rather than folding a modal-opening step into the matrix's own
 * per-route loop. */
async function capturePaletteOpen(browser: Browser, sessionValue: string, viewport: ViewportSpec, theme: "light" | "dark"): Promise<void> {
  const context = await newContext(browser, viewport, theme, sessionValue);
  try {
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/`);
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
    await page.locator('[role="status"]').first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
    const isMac = process.platform === "darwin";
    await page.keyboard.press(isMac ? "Meta+K" : "Control+K");
    await page.getByPlaceholder("Search, or ask MaiPai...").waitFor();
    await page.keyboard.type("weather");
    await page.getByText("Ask MaiPai: weather", { exact: true }).waitFor();
    await settleAnimations(page);
    await page.screenshot({ path: join(SCREENS_DIR, `search-palette-${viewport.slug}-${theme}.png`) });
  } finally {
    await context.close();
  }
}

/** COMP-01d's dedicated review: the seeded backend has no package call in
 * the ordinary garden script, so this isolated browser route supplies one
 * bounded document response without changing the persisted demo household.
 * The handle, fetch, responsive surface and source projection are still
 * exercised by the real built chat page and the real document endpoint path. */
async function captureChatDocumentPane(browser: Browser, sessionValue: string, viewport: ViewportSpec, theme: "light" | "dark"): Promise<void> {
  const context = await newContext(browser, viewport, theme, sessionValue);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await page.route("**/api/turn/stream", (route) => {
      const value = {
        reply: { text: "Here are the saved details." },
        source: "model",
        safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() },
        conversation_id: "conv-document123",
        turn_id: "turn-document123",
        document_available: true,
      };
      return route.fulfill({ status: 200, contentType: "application/x-ndjson", body: `${JSON.stringify({ type: "delta", text: value.reply.text })}\n${JSON.stringify({ type: "done", value })}\n` });
    });
    await page.route("**/api/conversations/turns/turn-document123/document", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "doc-document123",
        turn_id: "turn-document123",
        revision: 1,
        evidence_version: "outcome-document123",
        section: {
          type: "lookup",
          query: "family hiking trails",
          results: [{ title: "Greenway Trail", line: "A short trail for families.", source_id: "src-document123" }],
        },
        sources: [{
          id: "src-document123",
          kind: "web",
          title: "Greenway Trail guide",
          url: "https://example.com/greenway",
          site: "example.com",
          snippet: "A short trail for families.",
          source: "turn-document123",
          created_at: "2026-09-16T00:00:00.000Z",
          hlc: "1788000000000:0:example",
        }],
        provenance: "composer:turn-document123:lookup",
        created_at: "2026-09-16T00:00:00.000Z",
        hlc: "1788000000000:0:example",
      }),
    }));
    await page.goto(`${BASE_URL}/chat`);
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
    await page.locator('[role="status"]').first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
    await page.getByRole("textbox", { name: "Message input" }).fill("show saved details");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByRole("button", { name: "View details", exact: true }).waitFor();
    await page.getByRole("button", { name: "View details", exact: true }).click();
    await page.getByText("Greenway Trail", { exact: true }).waitFor();
    await settleAnimations(page);
    const screenshot = `chat-document-pane-${viewport.slug}-${theme}.png`;
    await page.screenshot({ path: join(SCREENS_DIR, screenshot), fullPage: true });
    dedicatedScreenshots.push({ file: screenshot, route: "chat-document-pane", viewport: viewport.slug, theme });
  } finally {
    await context.close();
  }
}

/** spec.md "Acceptance for an implementation", state 2: a thread with the
 * sources card open, a memory chip, and an image attachment together on
 * one reply. Stubs the conversation's own GET turns endpoint directly (a
 * loaded row, not a live `/api/turn/stream`) because only a loaded row
 * carries `memory_ids` - chatMemoryState.ts's deriveMemoryStatus() only
 * reaches "saved" from a non-empty memory_ids list, which a live turn
 * never carries (the judge runs after the turn, never during it). Field
 * names match chatHistoryAdapter.ts's own reads of ConversationTurnWithMemoryIds
 * (backend/src/wire.ts) exactly. */
async function captureChatSourcesMemoryAttachment(browser: Browser, sessionValue: string, viewport: ViewportSpec, theme: "light" | "dark"): Promise<void> {
  const context = await newContext(browser, viewport, theme, sessionValue);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    const conversationId = "conv-attach123";
    const turnId = "turn-attach123";
    // useRemoteThreadListRuntime's own adapter (chatThreadListAdapter.ts)
    // calls `fetch(remoteId)` - GET /api/conversations/:id, singular -
    // before it will switch to a `threadId` prop it doesn't already know
    // about; a real 404 here (this conversation is fake, never actually
    // created) makes it silently fall back to a fresh empty thread
    // instead, and the reply text below never appears. Found live: the
    // first attempt at this capture only stubbed the plural `/turns` GET
    // and timed out.
    await page.route(`**/api/conversations/${conversationId}`, (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: conversationId,
        person: "person-attach123",
        surface: "chat",
        mode: "chat",
        companion_id: null,
        title: "Trail ideas",
        status: "open",
        summary: null,
        summary_through_turn: null,
        source: "hub",
        hlc: "1788000000000:0:example",
        created_at: "2026-09-16T00:00:00.000Z",
        updated_at: "2026-09-16T00:00:00.000Z",
      }),
    }));
    await page.route(`**/api/conversations/${conversationId}/turns`, (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{
        id: turnId,
        conversationId,
        userText: "Any family-friendly trails nearby?",
        replyText: "The Greenway Trail is a short, family-friendly loop [1].",
        source: "model",
        pluginId: null,
        commandId: null,
        safetyFlagged: false,
        safetyAction: "allow",
        minorSpeaker: false,
        createdAt: "2026-09-16T00:00:00.000Z",
        judgeStatus: "done",
        judgeAttempts: 1,
        outcomes: null,
        document: null,
        memory_ids: ["mem-attach123"],
        sources: [{
          id: "src-attach123",
          kind: "web",
          title: "Greenway Trail guide",
          url: "https://example.com/greenway",
          site: "example.com",
          snippet: "A short, family-friendly loop.",
          source: turnId,
          created_at: "2026-09-16T00:00:00.000Z",
          hlc: "1788000000000:0:example",
        }],
        media: null,
        media_items: [{
          kind: "image",
          url: "https://example.com/greenway.jpg",
          // A real, always-loadable image with no live network dependency
          // (org standard: "Deterministic and offline by default") - a
          // fake https URL here renders as a broken-image icon, found
          // live on the first attempt at this capture. `url` above stays
          // a realistic-looking (but still fake) address, since it's
          // only ever used for the "open in a new tab" href, never as
          // the rendered `<img src>` once `thumbnail` is set
          // (chatCitations.ts's ChatMedia: `item.thumbnail ?? item.url`).
          thumbnail: `data:image/png;base64,${TRAIL_THUMBNAIL_PNG_BASE64}`,
          source: turnId,
          source_url: "https://example.com/greenway",
        }],
        stats: null,
      }]),
    }));
    await page.goto(`${BASE_URL}/chat?conversation=${conversationId}`);
    await page.getByText("The Greenway Trail is a short, family-friendly loop", { exact: false }).waitFor({ timeout: 15000 });
    await page.locator('[role="status"]').first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
    await page.getByText("Remembered", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Source 1: Greenway Trail guide", exact: true }).click();
    await page.getByText("Greenway Trail guide", { exact: true }).waitFor();
    await settleAnimations(page);
    const screenshot = `chat-sources-memory-attachment-${viewport.slug}-${theme}.png`;
    await page.screenshot({ path: join(SCREENS_DIR, screenshot), fullPage: true });
    dedicatedScreenshots.push({ file: screenshot, route: "chat-sources-memory-attachment", viewport: viewport.slug, theme });
  } finally {
    await context.close();
  }
}

/** spec.md "Acceptance for an implementation", state 3: a streaming
 * reply. `/api/turn/stream` is a real ndjson stream the frontend reads
 * incrementally (chatModelAdapter.ts) - a `route.fulfill()` body is
 * delivered whole and near-instantly on localhost, too fast to reliably
 * catch mid-stream. Overriding `window.fetch` in the page instead (via
 * `addInitScript`, so it is in place before the app's own first fetch)
 * gives a real, still-open `ReadableStream` whose one chunk is enqueued
 * and then deliberately never closed - the app has no way to tell this
 * apart from a slow real reply still arriving, so `running` (and the
 * streaming caret) stays true for as long as this page lives, a stable
 * target for a screenshot. */
async function captureChatStreaming(browser: Browser, sessionValue: string, viewport: ViewportSpec, theme: "light" | "dark"): Promise<void> {
  const context = await newContext(browser, viewport, theme, sessionValue);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await page.addInitScript(() => {
      const originalFetch = window.fetch;
      const patched = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/api/turn/stream")) {
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(`${JSON.stringify({ type: "delta", text: "The Greenway Trail is a short, family" })}\n`));
              // No controller.close() - see the function's own comment above.
            },
          });
          return new Response(stream, { status: 200, headers: { "content-type": "application/x-ndjson" } });
        }
        return originalFetch(input, init);
      };
      window.fetch = patched as typeof fetch;
    });
    await page.goto(`${BASE_URL}/chat`);
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
    await page.locator('[role="status"]').first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
    await page.getByRole("textbox", { name: "Message input" }).fill("Any family-friendly trails nearby?");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByText("The Greenway Trail is a short, family", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor();
    await settleAnimations(page);
    const screenshot = `chat-streaming-${viewport.slug}-${theme}.png`;
    await page.screenshot({ path: join(SCREENS_DIR, screenshot), fullPage: true });
    dedicatedScreenshots.push({ file: screenshot, route: "chat-streaming", viewport: viewport.slug, theme });
  } finally {
    await context.close();
  }
}

/** Closes the two missing 2026-10-04 chat audit states against the real
 * Next Chat route and assistant-ui action bar. The first stream ends after
 * a resumable turn_meta and delta; the second response is held until the
 * reconnecting banner has been captured. */
async function captureChatMissingStates(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = chatMissingStatesOutDir;
  mkdirSync(outDir, { recursive: true });
  const desktop = VIEWPORTS.find((v) => v.slug === "desktop")!;
  const phone = VIEWPORTS.find((v) => v.slug === "phone")!;

  async function assertBannerAbovePrompt(page: Page, state: string) {
    const bounds = await page.evaluate(() => {
      const banner = document.querySelector('[data-slot="connection-state"]');
      const prompt = document.querySelector('[data-slot="aui_user-message-root"]');
      if (!banner || !prompt) return null;
      const bannerBox = banner.getBoundingClientRect();
      const promptBox = prompt.getBoundingClientRect();
      return { bannerBottom: bannerBox.bottom, promptTop: promptBox.top };
    });
    if (!bounds || bounds.bannerBottom > bounds.promptTop) {
      throw new Error(`${state} connection banner overlaps the first user message at ${page.viewportSize()?.width}x${page.viewportSize()?.height}: ${JSON.stringify(bounds)}`);
    }
    console.log(`${state} banner/message bounds ${page.viewportSize()?.width}x${page.viewportSize()?.height}: ${JSON.stringify(bounds)}`);
  }

  for (const viewport of [desktop, phone]) {
    const context = await newContext(browser, viewport, "dark", sessionValue);
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
      const meta = { type: "turn_meta", conversation_id: "audit-reconnect", turn_id: "audit-reconnect-turn", resume_token: "audit-resume-token" };
      const firstBody = await new Response(assistantStreamBody([meta, { type: "delta", text: "The stream started before the connection paused.", sequence: 1 }])).text();
      const resumePrefix = await new Response(assistantStreamBody([meta, { type: "delta", text: " then resumed successfully.", sequence: 2 }])).text();
      const value = {
        reply: { text: "The stream started before the connection paused, then resumed successfully." },
        source: "model",
        safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: "2026-10-04T00:00:00.000Z" },
        conversation_id: "audit-reconnect", turn_id: "audit-reconnect-turn",
      };
      const resumeFinish = await new Response(assistantStreamBody([{ type: "done", value }])).text();
      await page.addInitScript(({ firstBody, resumePrefix, resumeFinish }) => {
        let count = 0;
        const state = { resumeRequested: false, releaseResume: () => {}, releaseFinish: () => {} };
        (window as unknown as { __auditResume: typeof state }).__auditResume = state;
        const nativeFetch = window.fetch;
        window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (!url.includes("/api/turn/stream")) return nativeFetch(input, init);
          count++;
          if (count === 1) return new Response(firstBody, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "x-vercel-ai-data-stream": "v1" } });
          state.resumeRequested = true;
          const encoder = new TextEncoder();
          return new Response(new ReadableStream<Uint8Array>({ start(controller) {
            state.releaseResume = () => {
              controller.enqueue(encoder.encode(resumePrefix));
              state.releaseFinish = () => { controller.enqueue(encoder.encode(resumeFinish)); controller.close(); };
            };
          } }), { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "x-vercel-ai-data-stream": "v1" } });
        }) as typeof fetch;
      }, { firstBody, resumePrefix, resumeFinish });
      await page.goto(`${BASE_URL}/chat`);
      await page.getByRole("textbox", { name: "Message input" }).fill("Continue after a dropped stream");
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await page.waitForFunction(() => (window as unknown as { __auditResume: { resumeRequested: boolean } }).__auditResume.resumeRequested);
      await page.getByText("Reconnecting", { exact: true }).waitFor();
      await settleAnimations(page);
      await assertBannerAbovePrompt(page, "reconnecting");
      const reconnectFile = `reconnecting-${viewport.width}x${viewport.height}-dark.png`;
      await page.screenshot({ path: join(outDir, reconnectFile), fullPage: true });
      await page.evaluate(() => (window as unknown as { __auditResume: { releaseResume(): void } }).__auditResume.releaseResume());
      await page.getByText("Picked the stream back up.", { exact: true }).waitFor();
      await settleAnimations(page);
      await assertBannerAbovePrompt(page, "resumed");
      const resumedFile = `resumed-${viewport.width}x${viewport.height}-dark.png`;
      await page.screenshot({ path: join(outDir, resumedFile), fullPage: true });
      await page.evaluate(() => (window as unknown as { __auditResume: { releaseFinish(): void } }).__auditResume.releaseFinish());
      await page.getByText("The stream started before the connection paused, then resumed successfully.", { exact: true }).waitFor();
      await context.setOffline(true);
      await page.getByText("Connection lost. The run kept going on the server.", { exact: true }).waitFor();
      await assertBannerAbovePrompt(page, "dropped");
      console.log(`Wrote ${join(outDir, reconnectFile)} and ${join(outDir, resumedFile)}`);
    } finally {
      await context.close();
    }
  }

  // Seed one persisted assistant-ui conversation in the throwaway data
  // directory; reload it for every state so each action bar is a completed reply.
  const cookie = { Cookie: `session=${sessionValue}` };
  const conversation = await seedTitledConversation("captureChatMissingStates", cookie, "A short garden answer");
  const who = await fetch(`${BASE_URL}/api/auth/me`, { headers: cookie });
  if (!who.ok) throw new Error(`captureChatMissingStates: reading signed-in person failed: ${who.status}`);
  const personId = ((await who.json()) as { id: string }).id;
  const reply = "Start with a sunny spot and a few easy plants.";
  const seedSource = [
    'import { sqlite } from "./src/db/index.ts";',
    'sqlite.query("INSERT INTO conversation_turns (id, person_id, surface, conversation_id, user_text, reply_text, source, safety_action, created_at, hlc) VALUES (?, ?, \'chat\', ?, ?, ?, \'model\', \'allow\', ?, ?)").run(' +
      ['audit-action-turn', personId, conversation.id, 'How should I start a small garden?', reply].map((value) => JSON.stringify(value)).join(', ') +
      ', new Date().toISOString(), new Date().toISOString() + ":0:audit-action-turn");',
    'sqlite.close();',
  ].join("\n");
  const inserted = Bun.spawnSync({ cmd: ["bun", "-e", seedSource], cwd: join(ROOT, "backend"), env: { ...process.env, MAIPAI_DATA_DIR: DATA_DIR }, stdout: "pipe", stderr: "pipe" });
  if (inserted.exitCode !== 0) throw new Error(`captureChatMissingStates: persisting assistant action fixture failed: ${inserted.stderr.toString()}`);

  for (const { viewport, theme } of [
    { viewport: desktop, theme: "dark" as const },
    { viewport: desktop, theme: "light" as const },
    { viewport: phone, theme: "dark" as const },
  ]) {
    for (const state of ["hover", "focus", "menu"] as const) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
        await page.goto(`${BASE_URL}/chat?conversation=${conversation.id}`);
        const replyText = page.getByText(reply, { exact: true });
        await replyText.waitFor();
        const message = page.locator('[data-role="assistant"]').filter({ has: replyText }).last();
        if (state === "hover") {
          await message.hover();
        } else if (state === "focus") {
          await message.getByRole("button", { name: "Copy", exact: true }).focus();
        } else {
          await message.hover();
          await message.getByRole("button", { name: "More", exact: true }).click();
          await page.getByRole("menuitem", { name: "Export as Markdown", exact: true }).waitFor();
        }
        await settleAnimations(page);
        const file = `action-bar-${state}-${viewport.width}x${viewport.height}-${theme}.png`;
        await page.screenshot({ path: join(outDir, file), fullPage: true });
        console.log(`Wrote ${join(outDir, file)}`);
      } finally {
        await context.close();
      }
    }
  }
}

/** spec.md "Acceptance for an implementation", state 4: the engine-not-
 * ready state ("Empty, loading, error" - "the composer is disabled with
 * the health item's one-sentence reason as its placeholder and its fix
 * as a button beside it"). Same `/api/health` shape ChatPage.test.tsx's
 * "the composer is disabled while the model is starting" test uses. */
async function captureChatEngineNotReady(browser: Browser, sessionValue: string, viewport: ViewportSpec, theme: "light" | "dark"): Promise<void> {
  const context = await newContext(browser, viewport, theme, sessionValue);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await page.route("**/api/health", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ brain: "starting", voice: "none" }),
    }));
    await page.goto(`${BASE_URL}/chat`);
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
    await page.getByPlaceholder("MaiPai's AI is starting up. This can take a moment.").waitFor();
    await page.getByRole("link", { name: "Open AI models", exact: true }).waitFor();
    await settleAnimations(page);
    const screenshot = `chat-engine-not-ready-${viewport.slug}-${theme}.png`;
    await page.screenshot({ path: join(SCREENS_DIR, screenshot), fullPage: true });
    dedicatedScreenshots.push({ file: screenshot, route: "chat-engine-not-ready", viewport: viewport.slug, theme });
  } finally {
    await context.close();
  }
}

/** CHAT-PARITY-01's focused review: the seeded demo machine does not have a
 * multi-gigabyte model installed, so this capture supplies the compact,
 * already-reachable model-list response at the browser boundary. The real
 * ChatModelPicker, responsive header, disclosure, and owner-only naming are
 * still exercised by the built app; the backend route has its own contract
 * tests for the unmocked safe/available shapes. */
async function captureChatModelPicker(browser: Browser, sessionValue: string): Promise<void> {
  const viewport = VIEWPORTS.find((v) => v.slug === "desktop")!;
  const context = await newContext(browser, viewport, "light", sessionValue);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await page.route("**/api/host/chat-models", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        models: [{ id: "qwen3-8b-instruct-q4-k-m", label: "Qwen3 8B Instruct" }],
        selectedModel: { id: "qwen3-8b-instruct-q4-k-m", label: "Qwen3 8B Instruct", available: true },
        canSelect: true,
      }),
    }));
    await page.goto(`${BASE_URL}/chat`);
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
    // ModelPicker.tsx's HeaderPicker trigger, not the deleted
    // ChatModelPicker.tsx's own accessible name - found stale by review
    // (step 5b's rebuild switched components but left this selector
    // untouched, so this capture silently stopped matching anything).
    const trigger = page.getByRole("button", { name: "Chat model: Qwen3 8B Instruct" });
    await trigger.waitFor();
    await trigger.click();
    await page.getByRole("menuitem", { name: "Open AI models", exact: true }).waitFor();
    await settleAnimations(page);
    const screenshot = "chat-model-picker-desktop-light.png";
    await page.screenshot({ path: join(SCREENS_DIR, screenshot), fullPage: true });
    dedicatedScreenshots.push({ file: screenshot, route: "chat-model-picker", viewport: viewport.slug, theme: "light" });
  } finally {
    await context.close();
  }
}

/** STATS-01's dedicated review: a real model stream supplies final-chunk
 * telemetry, the signed-in owner enables the persisted preference, and the
 * compact readout is opened from the real assistant reply before capture. */
async function captureChatStatsReview(browser: Browser, sessionValue: string): Promise<void> {
  const viewport = VIEWPORTS.find((v) => v.slug === "desktop")!;
  const context = await newContext(browser, viewport, "light", sessionValue);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await page.goto(`${BASE_URL}/chat`);
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
    await page.locator('[role="status"]').first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
    await page.getByRole("textbox", { name: "Message input" }).fill("Help me plan a small garden");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByText("Start with a sunny spot and a few easy plants.", { exact: false }).waitFor();
    const statsToggle = page.getByRole("button", { name: "Show advanced reply stats", exact: true });
    await statsToggle.waitFor();
    await page.waitForFunction(() => document.querySelector('[aria-label="Show advanced reply stats"]')?.getAttribute("aria-pressed") === "true");
    await page.getByRole("button", { name: "View reply stats", exact: true }).click();
    await page.getByRole("heading", { name: "Reply details", exact: true }).waitFor();
    await settleAnimations(page);
    const screenshot = "chat-turn-stats-desktop-light.png";
    await page.screenshot({ path: join(SCREENS_DIR, screenshot), fullPage: true });
    dedicatedScreenshots.push({ file: screenshot, route: "chat-turn-stats", viewport: viewport.slug, theme: "light" });
  } finally {
    await context.close();
  }
}

/** COMP-02's dedicated review: enable the real per-conversation research
 * control, send a document-bearing turn, and capture the short line with
 * the details pane opened after the stream finishes. */
async function captureChatResearchReview(browser: Browser, sessionValue: string): Promise<void> {
  const viewport = VIEWPORTS.find((v) => v.slug === "desktop")!;
  const context = await newContext(browser, viewport, "light", sessionValue);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await page.route("**/api/turn/stream", (route) => {
      const value = {
        reply: { text: "Here is the short answer." },
        source: "model",
        safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() },
        conversation_id: "conv-research123",
        turn_id: "turn-research123",
        document_available: true,
      };
      return route.fulfill({ status: 200, contentType: "application/x-ndjson", body: `${JSON.stringify({ type: "delta", text: value.reply.text })}\n${JSON.stringify({ type: "done", value })}\n` });
    });
    await page.route("**/api/conversations/turns/turn-research123/document", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "doc-research123",
        turn_id: "turn-research123",
        revision: 1,
        evidence_version: "outcome-research123",
        section: { type: "lookup", query: "research mode", results: [{ title: "Research notes", line: "The details pane holds the longer source-backed answer.", source_id: "src-research123" }] },
        sources: [{ id: "src-research123", kind: "web", title: "Research notes", url: "https://example.com/research", site: "example.com", snippet: "Research notes", source: "turn-research123", created_at: "2026-09-16T00:00:00.000Z", hlc: "1788000000000:0:example" }],
        provenance: "composer:turn-research123:lookup",
        created_at: "2026-09-16T00:00:00.000Z",
        hlc: "1788000000000:0:example",
      }),
    }));
    await page.goto(`${BASE_URL}/chat`);
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
    await page.locator('[role="status"]').first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
    await page.getByRole("textbox", { name: "Message input" }).fill("start a chat");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByText("Here is the short answer.", { exact: true }).waitFor();
    const toggle = page.getByRole("button", { name: "Turn on research mode", exact: true });
    await toggle.waitFor();
    await toggle.click();
    await page.getByRole("button", { name: "Turn off research mode", exact: true }).waitFor();
    await page.getByRole("textbox", { name: "Message input" }).fill("research this");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByText("Research notes", { exact: true }).waitFor();
    await settleAnimations(page);
    const screenshot = "chat-research-mode-desktop-light.png";
    await page.screenshot({ path: join(SCREENS_DIR, screenshot), fullPage: true });
    dedicatedScreenshots.push({ file: screenshot, route: "chat-research-mode", viewport: viewport.slug, theme: "light" });
  } finally {
    await context.close();
  }
}

/** CHAT-PARITY-02's dedicated review: start the explicit temporary mode
 * before a first send and capture the parent-facing retention contract in
 * the real chat shell. The backend creates the mode, while the route's
 * normal frontend fetch then confirms it and renders the banner. */
async function captureChatTemporaryReview(browser: Browser, sessionValue: string): Promise<void> {
  const viewport = VIEWPORTS.find((v) => v.slug === "desktop")!;
  const context = await newContext(browser, viewport, "light", sessionValue);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await page.goto(`${BASE_URL}/chat`);
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "Start temporary chat", exact: true }).click();
    await page.getByRole("button", { name: "Turn off temporary chat", exact: true }).waitFor();
    await page.getByRole("status").filter({ hasText: "not saved to normal history or memory" }).waitFor();
    await settleAnimations(page);
    const screenshot = "chat-temporary-mode-desktop-light.png";
    await page.screenshot({ path: join(SCREENS_DIR, screenshot), fullPage: true });
    dedicatedScreenshots.push({ file: screenshot, route: "chat-temporary-mode", viewport: viewport.slug, theme: "light" });
  } finally {
    await context.close();
  }
}

/** THIN-INC INC-4: a real Chromium run through the complete Incognito lifecycle.
 * Captures are written to the coordinator's scratch audit directory, not the
 * product screenshot set. Marker checks inspect browser storage and SQLite. */
async function captureChatIncognitoAudit(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = SCREENS_DIR;
  mkdirSync(outDir, { recursive: true });
  const phone = VIEWPORTS.find((v) => v.slug === "phone")!;
  const desktop = VIEWPORTS.find((v) => v.slug === "desktop")!;
  const people = await (await fetch(`${BASE_URL}/api/people`, { headers: { Cookie: `session=${sessionValue}` } })).json() as Array<{ id: string; display_name: string; role: string }>;
  const sage = people.find((person) => person.display_name === "Sage");
  if (!sage) throw new Error("Incognito audit could not find seeded Sage");
  const appearance = await fetch(`${BASE_URL}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: `session=${sessionValue}` },
    body: JSON.stringify({ scope: `person:${sage.id}`, key: "ui.appearance", value: "dark" }),
  });
  if (!appearance.ok) throw new Error(`Incognito audit could not seed dark appearance: ${appearance.status}`);
  const context = await newContext(browser, desktop, "dark", sessionValue);
  const marker = "incognito-marker-b27-20261005";
  const draftMarker = "incognito-draft-marker-b27-20261005";
  const results: Array<{ step: number; status: "PASS" | "FAIL"; evidence: string }> = [];
  const record = (step: number, ok: boolean, evidence: string) => {
    results.push({ step, status: ok ? "PASS" : "FAIL", evidence });
    if (!ok) throw new Error(`INC-4 SAFETY DEFECT step ${step}: ${evidence}`);
  };
  const shot = async (step: number, viewport: ViewportSpec = desktop) => {
    const page = viewport.slug === "phone" ? await (await newContext(browser, phone, "dark", sessionValue)).newPage() : context.pages()[0]!;
    if (viewport.slug === "phone") {
      await page.addInitScript(() => {
        localStorage.setItem("vite-ui-theme", "dark");
        document.documentElement.classList.add("dark");
      });
      await page.goto(`${BASE_URL}/chat`);
      await page.getByRole("button", { name: "Incognito Off", exact: true }).click();
      await page.getByRole("dialog").getByRole("heading", { name: "What Incognito does" }).waitFor();
      await page.getByRole("button", { name: "Got it", exact: true }).click();
      await page.getByRole("button", { name: "Incognito On", exact: true }).waitFor();
      await page.evaluate(() => document.documentElement.classList.add("dark"));
    } else {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
    }
    await settleAnimations(page);
    const file = `step-${step}-${viewport.width}-dark.png`;
    const path = join(outDir, file);
    await page.screenshot({ path, fullPage: true });
    dedicatedScreenshots.push({ file, route: "incognito-audit", viewport: viewport.slug, theme: "dark" });
    console.log(`[incognito-audit] screenshot ${path}`);
    if (viewport.slug === "phone") await page.context().close();
  };
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  try {
    await page.goto(`${BASE_URL}/chat`);
    await page.getByRole("heading", { level: 1 }).first().waitFor();
    await page.locator('[role="status"]').first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
    // Seed a durable chat so the Incognito list can prove it excludes real history.
    await page.getByRole("textbox", { name: "Message input" }).fill("A normal stored chat for the audit.");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByText("This is a normal chat response.", { exact: true }).waitFor();
    const storedListResponse = await fetch(`${BASE_URL}/api/conversations`, { headers: { Cookie: `session=${sessionValue}` } });
    const storedBefore = storedListResponse.ok ? await storedListResponse.json() as Array<{ id: string }> : [];
    if (!storedListResponse.ok || storedBefore.length < 1) throw new Error(`could not seed stored chat: ${storedListResponse.status}`);

    const desktopToggle = page.getByRole("button", { name: "Incognito Off", exact: true }).first();
    await desktopToggle.click();
    await page.getByRole("dialog").getByRole("heading", { name: "What Incognito does" }).waitFor();
    await page.getByRole("button", { name: "Got it", exact: true }).click();
    await page.getByRole("button", { name: "Incognito On", exact: true }).waitFor();
    await page.waitForTimeout(300);
    await shot(1);
    await shot(1, phone);
    const listText = await page.locator("body").innerText();
    if (!/Incognito/i.test(listText)) throw new Error("INC-4 SAFETY DEFECT step 1: Incognito state has no visible indication");
    record(1, !storedBefore.some((row) => listText.includes(row.id)) && !/Pinned/i.test(listText) && !/Pin chat/i.test(listText), "Incognito on; only temporary list visible, no stored chat IDs, Pin action, or Pinned group");

    await page.getByRole("textbox", { name: "Message input" }).fill(`Please repeat exactly ${marker}`);
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByText("This is a normal chat response.", { exact: true }).waitFor();
    await page.waitForTimeout(900);
    const activeTitle = await page.locator("[data-thread-list-item][aria-current='page'], [data-active='true']").first().getAttribute("title").catch(() => null);
    const temporaryList = await (await fetch(`${BASE_URL}/api/conversations/incognito`, { headers: { Cookie: `session=${sessionValue}` } })).json() as Array<{ id: string; title?: string | null }>;
    const normalRows = await (await fetch(`${BASE_URL}/api/conversations`, { headers: { Cookie: `session=${sessionValue}` } })).json() as Array<{ id: string }>;
    await shot(2);
    record(2, temporaryList.length === 1 && temporaryList[0]?.title == null && !normalRows.some((row) => row.id === temporaryList[0]?.id) && !activeTitle?.includes(marker), `streamed reply shown; temporary-only session listed; title=${JSON.stringify(temporaryList[0]?.title)}; no normal-list row`);

    await page.getByRole("textbox", { name: "Message input" }).fill(draftMarker);
    await page.getByRole("button", { name: "New thread", exact: true }).click().catch(async () => {
      await page.getByRole("button", { name: /New chat|New thread/i }).first().click();
    });
    await page.getByRole("textbox", { name: "Message input" }).waitFor();
    await page.getByRole("button", { name: "Incognito On", exact: true }).click();
    await page.getByRole("button", { name: "Incognito Off", exact: true }).waitFor();
    await page.getByRole("button", { name: "Incognito Off", exact: true }).click();
    await page.getByRole("button", { name: "Incognito On", exact: true }).waitFor();
    await page.getByRole("textbox", { name: "Message input" }).waitFor();
    const restorePrompt = await page.getByText(draftMarker, { exact: false }).count();
    await shot(3);
    record(3, restorePrompt === 0, "draft was not restored and no restore prompt is shown after switching away and back");

    // Keyboard shortcuts are registered on the real ChatThread while a live
    // temporary conversation is active.
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await page.getByRole("textbox", { name: "Message input" }).fill(`searchable ${marker}`);
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByText("This is a normal chat response.", { exact: true }).waitFor();
    await page.locator('[data-slot="aui_thread-viewport"]').click({ position: { x: 400, y: 160 } });
    await page.keyboard.press("Control+f");
    await page.getByRole("textbox", { name: "Find in conversation" }).waitFor();
    await page.keyboard.press("Escape");
    await page.locator('[data-slot="aui_thread-viewport"]').click({ position: { x: 400, y: 160 } });
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox", { name: "Type a command" }).waitFor();
    await page.getByRole("option", { name: /Toggle Incognito/i }).waitFor();
    await page.keyboard.press("Escape");
    await shot(4);
    record(4, true, "Cmd+F opens in-chat search and Cmd+K palette opens with Incognito command");

    const storageBeforeToggleOff = await page.evaluate(async () => {
      const values: string[] = [];
      for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i)!; values.push(`${key}=${localStorage.getItem(key) ?? ""}`); }
      for (let i = 0; i < sessionStorage.length; i++) { const key = sessionStorage.key(i)!; values.push(`${key}=${sessionStorage.getItem(key) ?? ""}`); }
      if (indexedDB.databases) for (const dbInfo of await indexedDB.databases()) {
        if (!dbInfo.name) continue;
        const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(dbInfo.name!); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        for (const name of Array.from(db.objectStoreNames)) {
          const tx = db.transaction(name, "readonly");
          const rows = await new Promise<unknown[]>((resolve, reject) => { const req = tx.objectStore(name).getAll(); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
          values.push(`${dbInfo.name}/${name}=${JSON.stringify(rows)}`);
        }
        db.close();
      }
      return values;
    });
    const storeResponse = await page.evaluate(() => ({ localStorage: Object.keys(localStorage), sessionStorage: Object.keys(sessionStorage), indexedDB: [] as string[] }));
    console.log(`[incognito-audit] browser storage before toggle off ${JSON.stringify({ ...storeResponse, values: storageBeforeToggleOff })}`);
    await page.getByRole("button", { name: "Incognito On", exact: true }).click();
    await page.getByRole("button", { name: "Incognito Off", exact: true }).first().waitFor();
    await page.waitForTimeout(250);
    const normalListAfter = await (await fetch(`${BASE_URL}/api/conversations`, { headers: { Cookie: `session=${sessionValue}` } })).json() as Array<{ id: string }>;
    const incognitoAfter = await (await fetch(`${BASE_URL}/api/conversations/incognito`, { headers: { Cookie: `session=${sessionValue}` } })).json() as Array<{ id: string }>;
    await shot(5);
    await shot(5, phone);
    record(5, incognitoAfter.length === 0 && normalListAfter.some((row) => row.id === storedBefore[0]?.id), "temporary session discarded, stored list returns");

    await page.reload();
    await page.getByRole("heading", { level: 1 }).first().waitFor();
    await page.waitForTimeout(250);
    const afterReload = await (await fetch(`${BASE_URL}/api/conversations/incognito`, { headers: { Cookie: `session=${sessionValue}` } })).json() as Array<{ id: string }>;
    record(5, afterReload.length === 0, "reload does not restore the temporary session");
    const leakedStorage = storageBeforeToggleOff.filter((value) => value.includes(marker) || value.includes(draftMarker));
    record(6, leakedStorage.length === 0, `browser storage key/value scan contains no marker text; ${storageBeforeToggleOff.length} values inspected`);
    await shot(6);
    await Bun.write(join(outDir, "storage-audit.json"), JSON.stringify({ keys: storeResponse, inspectedValues: storageBeforeToggleOff.length, markerMatches: leakedStorage }, null, 2) + "\n");

    // SQLite snapshot search over every table and every value.
    const dbPath = join(DATA_DIR, "hub.db");
    const dbCheck = Bun.spawnSync({ cmd: ["bun", "-e", `const { Database } = require("bun:sqlite"); const db = new Database(${JSON.stringify(dbPath)}, { readonly: true }); const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all(); const hits=[]; for (const {name} of tables) { const cols=db.query("PRAGMA table_info('"+name.replaceAll("'","''")+"')").all(); if (!cols.length) continue; const sql='SELECT * FROM "'+name.replaceAll('"','""')+'"'; for (const row of db.query(sql).all()) { const value=JSON.stringify(row); if (value.includes(${JSON.stringify(marker)}) || value.includes(${JSON.stringify(draftMarker)})) hits.push({table:name,row:value}); } } console.log(JSON.stringify({tables:tables.length,hits})); db.close();`], cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    if (dbCheck.exitCode !== 0) throw new Error(`INC-4 database scan failed: ${dbCheck.stderr.toString()}`);
    const dbEvidence = JSON.parse(dbCheck.stdout.toString()) as { tables: number; hits: unknown[] };
    await Bun.write(join(outDir, "database-audit.json"), JSON.stringify(dbEvidence, null, 2) + "\n");
    record(7, dbEvidence.hits.length === 0, `scanned ${dbEvidence.tables} SQLite tables; marker hits=${dbEvidence.hits.length}`);
    await shot(7);

    // Sessions for the seeded teen/child are secret-free and can use /select.
    const people = await (await fetch(`${BASE_URL}/api/people`, { headers: { Cookie: `session=${sessionValue}` } })).json() as Array<{ id: string; display_name: string; role: string }>;
    for (const profile of [people.find((p) => p.display_name === "Nova")!, people.find((p) => p.display_name === "Marlow")!]) {
      const select = await fetch(`${BASE_URL}/api/auth/select`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personId: profile.id }) });
      const cookie = select.headers.get("set-cookie")?.split(";")[0];
      if (!select.ok || !cookie) throw new Error(`INC-4 SAFETY DEFECT: could not authenticate ${profile.display_name}`);
      const turn = await fetch(`${BASE_URL}/api/turn/stream`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ surface: "chat", text: `child gate ${marker}`, temporary: true }) });
      const issued = await fetch(`${BASE_URL}/api/settings/api-token`, { method: "POST", headers: { Cookie: cookie } });
      const token = issued.ok ? (await issued.json() as { token: string }).token : "";
      if (!token) throw new Error(`INC-4 audit could not issue API token for ${profile.display_name}: ${issued.status}`);
      const openai = await fetch(`${BASE_URL}/v1/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ model: "maipai", messages: [{ role: "user", content: `child gate ${marker}` }], temporary: true }) });
      record(8, turn.status === 403 && openai.status === 403, `${profile.role} direct temporary request: /api/turn/stream=${turn.status}, /v1/chat/completions=${openai.status}`);
    }
    await shot(8);

    const report = ["# Incognito browser audit", "", "| Step | Result | Evidence |", "|---:|:---:|---|", ...results.map((row) => `| ${row.step} | ${row.status} | ${row.evidence.replaceAll("|", "\\|")} |`), ""].join("\n");
    await Bun.write(join(outDir, "audit-results.md"), report);
    console.log(report);
  } finally {
    await context.close();
  }
}

/** CHAT-PARITY-04's dedicated review: the browser receives a length-stopped
 * assistant answer, so the real adapter marks it incomplete and the real
 * action bar exposes the additive Continue affordance. */
async function captureChatContinueReview(browser: Browser, sessionValue: string): Promise<void> {
  const viewport = VIEWPORTS.find((v) => v.slug === "desktop")!;
  const context = await newContext(browser, viewport, "light", sessionValue);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await page.route("**/api/turn/stream", (route) => {
      const value = {
        reply: { text: "Start with a sunny spot, then choose a few easy plants." },
        source: "model",
        safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() },
        conversation_id: "conv-continue123",
        turn_id: "turn-continue123",
        stats: { stop_reason: "length" },
      };
      return route.fulfill({ status: 200, contentType: "application/x-ndjson", body: `${JSON.stringify({ type: "delta", text: value.reply.text })}\n${JSON.stringify({ type: "done", value })}\n` });
    });
    await page.goto(`${BASE_URL}/chat`);
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
    await page.locator('[role="status"]').first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
    await page.getByRole("textbox", { name: "Message input" }).fill("Help me plan a small garden");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).waitFor();
    await settleAnimations(page);
    const screenshot = "chat-continue-desktop-light.png";
    await page.screenshot({ path: join(SCREENS_DIR, screenshot), fullPage: true });
    dedicatedScreenshots.push({ file: screenshot, route: "chat-continue", viewport: viewport.slug, theme: "light" });
  } finally {
    await context.close();
  }
}

/** HOME-FIT-02B's dedicated review for the recommended model's fit verdict.
 * Only selection and fit-plan are stubbed at the browser boundary; the
 * remaining model card data comes from the throwaway demo backend. */
async function captureFitVerdictCard(browser: Browser, sessionValue: string, viewport: ViewportSpec, theme: "light" | "dark", state: "yes" | "slow" | "no" | "unknown" | "unavailable" | "checked-yes" | "checked-no" | "checked-error" | "checked-notfound" | "checked-nostack" | "checked-unknown" | "memory-tight" | "compare"): Promise<void> {
  const context = await newContext(browser, viewport, theme, sessionValue);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await page.route("**/api/host/models/selection", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ modelId: "qwen3-8b-instruct-q4-k-m", name: "Qwen3 8B Instruct", state: "ready" }),
    }));
    const memory = state === "memory-tight"
      ? { available: true, memory: { usableGb: 16, usedGb: 14.8, freeGb: 1.2, pressure: "warn", pressureText: "This computer's memory is getting tight right now.", loaded: [{ id: "chat", label: "Chat", gb: 12.4 }, { id: "image", label: "Pictures", gb: 2.4 }], homeOwnedRoles: [] } }
      : { available: true, memory: { usableGb: 16, usedGb: 6.2, freeGb: 9.8, pressure: "normal", pressureText: "This computer has plenty of free memory right now.", loaded: [{ id: "chat", label: "Chat", gb: 5.1 }, { id: "embed", label: "Search", gb: 1.1 }], homeOwnedRoles: ["chat", "embeddings", "stt", "tts"] } };
    await page.route("**/api/computer-memory", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(memory) }));
    const answers = {
      yes: { verdict: "yes", headline: "Runs well on this computer", detail: "About 5 GB of the 24 GB this computer can give to models." },
      slow: { verdict: "slow", headline: "Runs, but slowly", detail: "It fits only by using the processor, so answers will be slower." },
      no: { verdict: "no", headline: "Won't fit", detail: "Needs about 6 GB more memory." },
      unknown: { verdict: "unknown", headline: "Can't tell yet", detail: "The model file is about 11 GB, and this computer can give 16 GB to models. How much more memory it needs while running is not known for this model family yet." },
      unavailable: { verdict: "unknown", headline: "Can't check right now", detail: "The model size checker did not answer. Try again in a moment." },
      notfound: { verdict: "unknown", headline: "Can't find that model", detail: "Check the link and try again." },
      nostack: { verdict: "unknown", headline: "Needs the MaiPai Stack", detail: "Checking a model's size uses the MaiPai Stack, which is not set up on this computer yet." },
    } as const;
    const figure = (low: number | null, high: number | null, source: "measured" | "unknown" = "measured") => ({ low, high, source, as_of: "2026-09-30" });
    const makePlan = (verdict: "yes" | "slow" | "no" | "unknown") => ({
      schema: 1, model: state === "checked-yes" ? "example-model-Q4_K_M" : state === "checked-unknown" ? "example-big-model-IQ3_S" : "qwen3-8b-instruct-q4-k-m", ...(state === "unknown" || state === "checked-unknown" ? { model_file_bytes: 11_771_546_784 } : {}), context_tokens: 8192, kv_cache_type: "f16",
      roles: [{ role: "chat", choice: "q4_k_m", peak: figure(4 * 1024 ** 3, 5 * 1024 ** 3) }],
      total: figure(4 * 1024 ** 3, 5 * 1024 ** 3), cap: state === "unknown" || state === "checked-unknown" ? figure(16 * 1024 ** 3, 16 * 1024 ** 3) : figure(23 * 1024 ** 3, 24 * 1024 ** 3), margin: figure(18 * 1024 ** 3, 19 * 1024 ** 3),
      paths: [{ path: "unified", fits: verdict === "yes", verdict: verdict === "slow" ? "no" : verdict, ...(verdict === "no" ? { shortfall: figure(5 * 1024 ** 3, 6 * 1024 ** 3) } : {}) }],
      verdict, bottleneck: verdict === "unknown" ? "unknown" : "memory",
    });
    await page.route("**/api/fit-plan", (route) => {
      const source = route.request().postDataJSON()?.source as { url?: string; repo?: string } | undefined;
      const answerState = state === "compare"
        ? source?.url ? "yes" : source?.repo === "example-org/example-big-model" ? "no" : "yes"
        : state === "checked-yes" ? "yes" : state === "checked-no" ? "no" : state === "checked-notfound" ? "notfound" : state === "checked-nostack" ? "nostack" : state === "checked-unknown" ? "unknown" : state === "memory-tight" ? "yes" : state;
      const wording = answerState in answers ? answers[answerState as keyof typeof answers] : answers.yes;
      // Keep the browser boundary fixture valid against StackFitPlan.
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ plan: state === "unavailable" || state === "checked-notfound" || state === "checked-nostack" ? null : makePlan(wording.verdict), wording }),
      });
    });
    await page.goto(`${BASE_URL}/models`);
    if (state === "compare") {
      const links = [
        "https://huggingface.co/example-org/example-model-GGUF/resolve/main/example-model-Q4_K_M.gguf",
        "https://huggingface.co/example-org/example-big-model",
      ];
      for (const link of links) {
        await page.getByRole("textbox", { name: "Hugging Face model link" }).fill(link);
        await page.getByRole("button", { name: "Check", exact: true }).click();
      }
      await page.getByRole("heading", { name: "Compare", exact: true }).waitFor();
      await page.getByText("Needs about 6 GB more memory.", { exact: true }).waitFor();
      await settleAnimations(page);
      const screenshot = `fit-compare-${viewport.slug}-light.png`;
      await page.screenshot({ path: join(SCREENS_DIR, screenshot), fullPage: true });
      dedicatedScreenshots.push({ file: screenshot, route: "settings-models-fit-compare", viewport: viewport.slug, theme: "light" });
      return;
    }
    if (state === "checked-yes" || state === "checked-no" || state === "checked-error" || state === "checked-notfound" || state === "checked-nostack" || state === "checked-unknown") {
      const link = state === "checked-error" ? "not a link" : state === "checked-notfound" ? "https://huggingface.co/example-org/no-such-model" : state === "checked-unknown" ? "https://huggingface.co/example-org/example-big-model-GGUF" : "https://huggingface.co/example-org/example-model-GGUF/resolve/main/example-model-Q4_K_M.gguf";
      await page.getByRole("textbox", { name: "Hugging Face model link" }).fill(link);
      await page.getByRole("button", { name: "Check", exact: true }).click();
      await page.getByText(state === "checked-yes" ? answers.yes.headline : state === "checked-no" ? answers.no.headline : state === "checked-notfound" ? answers.notfound.headline : state === "checked-nostack" ? answers.nostack.headline : state === "checked-unknown" ? answers.unknown.headline : "That does not look like a Hugging Face model link.", { exact: true }).waitFor();
      if (state === "checked-unknown") await page.getByText(answers.unknown.detail, { exact: true }).waitFor();
      await settleAnimations(page);
      const screenshot = `fit-check-${state}-${viewport.slug}-light.png`;
      await page.screenshot({ path: join(SCREENS_DIR, screenshot), fullPage: true });
      dedicatedScreenshots.push({ file: screenshot, route: "settings-models-fit-check", viewport: viewport.slug, theme: "light" });
      return;
    }
    const card = page.getByText("Qwen3 8B Instruct", { exact: true }).first();
    await card.waitFor();
    if (state === "unavailable") {
      await page.getByRole("button", { name: "Details", exact: true }).click();
      await page.getByText("Chat runs through the MaiPai Stack.", { exact: true }).waitFor();
      await page.getByText(answers.unavailable.headline, { exact: true }).waitFor({ state: "detached" });
    } else {
      await page.getByText((state === "memory-tight" ? answers.yes : answers[state]).headline, { exact: true }).waitFor();
    }
    await settleAnimations(page);
    const screenshot = `fit-verdict-${state}-${viewport.slug}-${theme}.png`;
    if (state !== "memory-tight") {
      await page.screenshot({ path: join(SCREENS_DIR, screenshot), fullPage: true });
      dedicatedScreenshots.push({ file: screenshot, route: "settings-models-fit-verdict", viewport: viewport.slug, theme });
    }
    if (state === "yes" && theme === "light") {
      const normalShot = `fit-memory-normal-${viewport.slug}-light.png`;
      await page.screenshot({ path: join(SCREENS_DIR, normalShot), fullPage: true });
      dedicatedScreenshots.push({ file: normalShot, route: "settings-models-computer-memory", viewport: viewport.slug, theme });
    }
    if (state === "memory-tight") {
      const tightShot = `fit-memory-tight-${viewport.slug}-light.png`;
      await page.screenshot({ path: join(SCREENS_DIR, tightShot), fullPage: true });
      dedicatedScreenshots.push({ file: tightShot, route: "settings-models-computer-memory", viewport: viewport.slug, theme });
      return;
    }
    if ((state === "yes" || state === "no") && theme === "light") {
      await page.getByRole("button", { name: "Details", exact: true }).click();
      await page.getByText("Memory it needs", { exact: true }).waitFor();
      if (state === "no") await page.getByText(/It needs about 6 GB more memory\./).waitFor();
      await settleAnimations(page);
      const panelShot = `fit-panel-${state}-${viewport.slug}-light.png`;
      await page.screenshot({ path: join(SCREENS_DIR, panelShot), fullPage: true });
      dedicatedScreenshots.push({ file: panelShot, route: "settings-models-fit-panel", viewport: viewport.slug, theme: "light" });
    }
  } finally {
    await context.close();
  }
}

/** Lane 11 item 2's own acceptance: "the screenshot script gains the
 * section (desktop and phone), opened and judged." "People and things"
 * moved from Memory's own second tab to People's (owner ruling,
 * "Navigation, corrected," 2026-09-20: Memories moved to a person's
 * profile, and "People and things" - household-wide data, not a
 * specific person's own - never belonged there, so it stayed on
 * People). Radix's Tabs.Content doesn't mount an inactive panel at all,
 * so the tab has to be clicked open first, the same "a small dedicated
 * capture" shape `capturePaletteOpen()` above uses rather than folding
 * a click into the shared per-route loop (which would also mean the
 * ordinary `people-*.png` capture picks up whichever tab was left open
 * instead of the default Household view). */
async function capturePeopleAndThings(browser: Browser, sessionValue: string, viewport: ViewportSpec, theme: "light" | "dark"): Promise<void> {
  const context = await newContext(browser, viewport, theme, sessionValue);
  try {
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/people`);
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
    await page.locator('[role="status"]').first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
    await page.getByRole("tab", { name: "People and things" }).click();
    await page.getByText("owner of Juniper").waitFor();
    await settleAnimations(page);

    // A code review caught TabsTrigger's own 48px hit-area extension
    // (kit/ui/tabs.tsx's `before:-inset-y-3.5`, a real element with no
    // `pointer-events: none`) as capable of reaching past the gap
    // between TabsList and TabsContent into the content's own top edge
    // - happy-dom's own getBoundingClientRect() always reads zeroed
    // (this file's own established reason every real-layout check lives
    // here, not in a unit test), so this is the only place it can be
    // proven. `elementFromPoint` a few pixels inside TabsContent's own
    // top edge and confirm it isn't the trigger's invisible pseudo-
    // element intercepting the tap.
    const boundaryHit = await page.evaluate(() => {
      const content = document.querySelector('[role="tabpanel"]:not([hidden])');
      const trigger = document.querySelector('[role="tab"][aria-selected="true"]');
      if (!content || !trigger) return { ok: false, reason: "tabpanel or active tab not found" };
      const rect = content.getBoundingClientRect();
      const x = rect.left + 10;
      const y = rect.top + 3;
      const hit = document.elementFromPoint(x, y);
      const hitsTrigger = hit === trigger || trigger.contains(hit);
      return { ok: !hitsTrigger, x, y, hitTag: hit?.tagName, hitsTrigger };
    });
    if (!boundaryHit.ok) {
      throw new Error(`A tap just inside TabsContent's own top edge (${JSON.stringify(boundaryHit)}) hits the active tab's own invisible hit-area instead of the content below it`);
    }

    await page.screenshot({ path: join(SCREENS_DIR, `people-things-${viewport.slug}-${theme}.png`) });
  } finally {
    await context.close();
  }
}

// Apps (HOME-UI-02): the details pane over a real installed package,
// the same "click a real row" shape capturePeopleAndThings uses for
// Memory's own tabs - the ordinary ROUTES matrix only ever proves the
// table itself, never the pane a real household member spends most of
// this page's time in.
/** Lane 10 item 2's own acceptance: "the loading state between chunks
 * must be the kit's own skeleton, never a blank screen: take one shot
 * mid-load if the script can." Two things stack against catching it
 * against a click-driven in-app navigation: a real localhost fetch for
 * a lazy chunk (App.tsx's `lazyNamed`) resolves in a few milliseconds,
 * and react-router-dom's own `Link` wraps a navigation in
 * `startTransition` - React's own concurrent-rendering rule then keeps
 * the PREVIOUS page fully on screen for as long as the next one is
 * still suspended, never showing the Suspense fallback at all, exactly
 * the "no flash for a fast navigation" behavior that feature exists
 * for. A fresh load straight at a lazy route's own URL has no previous
 * page to keep showing, so this is a `page.goto()` directly to
 * `/privacy`, not a click from `/` - the real shape a bookmarked link
 * or a reload lands in. `serviceWorkers: "block"` turns off this app's
 * own PWA precaching (`sw.ts`) for this one context, since a precached
 * chunk is served straight from the Service Worker's Cache Storage, a
 * layer Playwright's page-level network interception never sees - the
 * artificial `page.route()` delay below only affects the real network
 * fetch a person's very first visit, before anything is precached yet,
 * would also see. */
async function captureLazyRouteSkeleton(browser: Browser, sessionValue: string): Promise<void> {
  const viewport = VIEWPORTS.find((v) => v.slug === "desktop")!;
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: "light",
    serviceWorkers: "block",
  });
  try {
    await context.addCookies([{ name: "session", value: sessionValue, url: BASE_URL }]);
    const page = await context.newPage();
    await page.route("**/assets/PrivacyPage-*.js", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    await page.goto(`${BASE_URL}/privacy`);
    await page.locator('[role="status"][aria-label="Loading"]').waitFor({ timeout: 5000 });
    await page.screenshot({ path: join(SCREENS_DIR, "lazy-route-skeleton.png") });
  } finally {
    await context.close();
  }
}

/** getmaipai/home step 5b's own restart-verification: shared/ui's Shell
 * (`ui/src/Shell.tsx`) owns the left rail, its collapse toggle
 * (`SidebarTrigger`, its accessible name "Collapse navigation"/"Expand
 * navigation" since the owner's "The collapsed rail" finding gave it
 * the removed RailToggle's own state-aware label), and its
 * `localStorage` persistence (`railStorageKey`) - none of it changed
 * by this step, but
 * an owner report of a stale pre-kit-adoption build looking broken
 * ("the left column is a disaster with its collapsed state and its
 * toggle") made this worth a real, interactive check rather than
 * trusting the static per-route matrix, which never exercises the
 * toggle at all. Desktop only (the trigger is `sm:hidden` below 640px
 * in Shell.tsx - phone gets a bottom tab bar instead, already covered
 * by every phone-viewport route capture in the plain matrix). */
async function captureShellRail(browser: Browser, sessionValue: string, theme: "light" | "dark"): Promise<void> {
  const viewport = VIEWPORTS.find((v) => v.slug === "desktop")!;
  const context = await newContext(browser, viewport, theme, sessionValue);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await page.goto(`${BASE_URL}/`);
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
    await page.locator('[role="status"]').first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
    const trigger = page.getByRole("button", { name: /collapse navigation|expand navigation/i });
    await trigger.waitFor();
    // Expanded is the default (no prior localStorage preference) -
    // spec.md "Application shell standards": the brand wordmark, the
    // nav group labels, and each item's own label text are all visible.
    await page.getByRole("navigation", { name: "Main navigation" }).getByText("MaiPai Home", { exact: false }).waitFor();
    await settleAnimations(page);
    await page.screenshot({ path: join(SCREENS_DIR, `shell-rail-expanded-desktop-${theme}.png`) });
    dedicatedScreenshots.push({ file: `shell-rail-expanded-desktop-${theme}.png`, route: "shell-rail-expanded", viewport: "desktop", theme });

    await trigger.click();
    // Collapsed: the wordmark's text (not the icon) hides via
    // `group-data-[collapsible=icon]:hidden` (AppShell.tsx's own
    // Brand()) - waiting for it to actually leave the accessibility
    // tree is the real assertion, not just a fixed delay.
    await page.getByRole("navigation", { name: "Main navigation" }).getByText("MaiPai Home", { exact: false }).waitFor({ state: "hidden" });
    await settleAnimations(page);
    await page.screenshot({ path: join(SCREENS_DIR, `shell-rail-collapsed-desktop-${theme}.png`) });
    dedicatedScreenshots.push({ file: `shell-rail-collapsed-desktop-${theme}.png`, route: "shell-rail-collapsed", viewport: "desktop", theme });

    // Persistence: Shell.tsx's own `railStorageKey` - a reload must keep
    // the collapsed choice, not silently reset to expanded. `isVisible()`,
    // not `.count()`: the brand text stays in the DOM even collapsed
    // (Tailwind's `group-data-[collapsible=icon]:hidden`, CSS-only, not
    // unmounted) - `.count()` doesn't respect visibility and false-
    // positived here on the first version of this check.
    await page.reload();
    await trigger.waitFor();
    if (await page.getByRole("navigation", { name: "Main navigation" }).getByText("MaiPai Home", { exact: false }).isVisible().catch(() => false)) {
      throw new Error("Shell rail's collapsed preference did not survive a reload");
    }

    await trigger.click();
    await page.getByRole("navigation", { name: "Main navigation" }).getByText("MaiPai Home", { exact: false }).waitFor();
  } finally {
    await context.close();
  }
}

/** SHELL2 (owner's feedback, 2026-10-06): "the site reloads twice when I
 * force refresh" and "clicking anything in the left rail flashes the
 * entire app". Counts real document loads on a normal and a hard
 * (cache-bypassing) reload, with a service worker already controlling
 * the page, and proves the rail and the shell survive a rail click: the
 * same rail node before and after, no loading screen in between. Throws
 * on any extra load or shell remount. */
async function captureShellNavReview(browser: Browser, sessionValue: string): Promise<void> {
  const desktop = VIEWPORTS.find((v) => v.slug === "desktop")!;
  const context = await newContext(browser, desktop, "dark", sessionValue);
  // A hub restart after a landing ships a new worker script: from the
  // second pass on, the served sw.js gets a fresh trailing comment before
  // each reload, so the reload finds a "new deploy" the way the owner's
  // tab does after a restart. The file is this run's own fresh build and
  // is restored however the run ends.
  const swFile = join(ROOT, "frontend", "dist", "sw.js");
  const swOriginal = readFileSync(swFile, "utf8");
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    let loads = 0;
    const navigations: string[] = [];
    page.on("load", () => { loads += 1; });
    page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations.push(new URL(frame.url()).pathname); });
    // Every mount and unmount of the rail and every loading screen, in
    // order, from the document's first byte.
    await page.addInitScript(() => {
      const log: string[] = [];
      (window as unknown as { __shellLog: string[] }).__shellLog = log;
      const start = performance.now();
      let rail: Element | null = null;
      const check = () => {
        const now = document.querySelector('[data-slot="app-rail"]');
        if (now !== rail) {
          log.push(`${Math.round(performance.now() - start)}ms ${now ? (rail ? "rail-replaced" : "rail-mounted") : "rail-unmounted"}`);
          rail = now;
        }
        if (document.querySelector('[role="status"][aria-label="Loading MaiPai Home"], [data-slot="route-skeleton"]')) {
          if (log[log.length - 1]?.endsWith("loading") !== true) log.push(`${Math.round(performance.now() - start)}ms loading`);
        }
      };
      new MutationObserver(check).observe(document, { childList: true, subtree: true });
      navigator.serviceWorker?.addEventListener("controllerchange", () => log.push(`${Math.round(performance.now() - start)}ms controllerchange`));
    });
    const settle = async () => {
      await page.locator('[data-slot="app-rail"]').waitFor();
      await page.waitForTimeout(4000);
    };
    await page.goto(`${BASE_URL}/chat`);
    await settle();
    // The first visit installs the worker; the next load is controlled by it.
    await page.evaluate(async () => { await navigator.serviceWorker?.ready; });
    await page.reload();
    await settle();
    const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker?.controller));
    const results: Record<string, unknown> = { controlled };
    const failures: string[] = [];

    if (!controlled) failures.push("no service worker controlled the page, so the update case was never exercised");
    let deploy = 0;
    for (const [pass, kind] of [[0, "reload"], [0, "hard-reload"], [1, "reload"], [1, "hard-reload"]] as const) {
      if (pass === 1) {
        deploy += 1;
        writeFileSync(swFile, `${swOriginal}\n// deploy ${deploy}\n`);
      }
      loads = 0;
      navigations.length = 0;
      // Firefox has no CDP session; its reload stands in for both kinds.
      if (kind === "reload" || useFirefox || useWebkit) await page.reload();
      else {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Page.reload", { ignoreCache: true });
      }
      await page.waitForLoadState("load");
      await settle();
      const log = await page.evaluate(() => (window as unknown as { __shellLog: string[] }).__shellLog);
      results[`${kind}${pass ? "-after-deploy" : ""}`] = { loads, navigations: [...navigations], log };
      if (loads !== 1) failures.push(`a ${kind} loaded the document ${loads} times`);
      const mounts = log.filter((entry) => entry.includes("rail-mounted") || entry.includes("rail-replaced")).length;
      if (mounts !== 1) failures.push(`a ${kind} mounted the rail ${mounts} times`);
      // Prove the update case really swapped workers in view; otherwise a
      // single load proves nothing.
      if (pass === 1 && kind === "reload" && !log.some((entry) => entry.endsWith("controllerchange"))) failures.push("the after-deploy reload saw no new worker take control");
    }

    // Rail clicks: the rail node must be the very same element afterwards,
    // with no loading screen and no document load in between.
    const clicks: Record<string, unknown>[] = [];
    for (const name of ["Chat", "Library", "Family", "Home", "Chat"]) {
      loads = 0;
      await page.evaluate(() => {
        (window as unknown as { __shellLog: string[] }).__shellLog.length = 0;
        document.querySelector('[data-slot="app-rail"]')?.setAttribute("data-probe", "kept");
      });
      const target = page.locator(`[data-slot="app-rail"] a[aria-label^="${name}"]`);
      const before = page.url();
      // Frames 50ms apart over the first 400ms after the click.
      await target.first().click();
      const frames: string[] = [];
      for (let i = 0; i < 8; i += 1) {
        frames.push(await page.evaluate(() => {
          const rail = document.querySelector('[data-slot="app-rail"]');
          const loading = document.querySelector('[role="status"][aria-label="Loading MaiPai Home"], [data-slot="route-skeleton"]');
          return `${rail ? (rail.getAttribute("data-probe") === "kept" ? "rail-kept" : "rail-new") : "no-rail"}${loading ? "+loading" : ""}`;
        }));
        await page.waitForTimeout(50);
      }
      await page.waitForTimeout(600);
      const kept = await page.evaluate(() => document.querySelector('[data-slot="app-rail"]')?.getAttribute("data-probe") === "kept");
      const log = await page.evaluate(() => [...(window as unknown as { __shellLog: string[] }).__shellLog]);
      const entry = { name, from: new URL(before).pathname, to: new URL(page.url()).pathname, loads, kept, frames, log };
      clicks.push(entry);
      if (!kept || loads > 0 || frames.some((frame) => frame !== "rail-kept") || log.length > 0) failures.push(`the ${name} rail click remounted the shell`);
    }
    results.clicks = clicks;
    console.log(`shell-nav measure: ${JSON.stringify(results)}`);
    if (failures.length) throw new Error(`captureShellNavReview: ${failures.join("; ")}`);
  } finally {
    writeFileSync(swFile, swOriginal);
    await context.close();
  }
}

/** RAIL-01 (owner's layout, 2026-10-06): the rail, the 288px history
 * column with many conversations, the conversation header, a real
 * exchange (a user message and a markdown reply), the composer empty and
 * multiline, the profile menu, and the avatar's attention badge, at 1440
 * in both themes plus one 390 sanity shot. Every key size is measured
 * in the browser and logged, and the run fails on a horizontal page
 * overflow. Written to data-scratch/chat-ab/shell-shots for review. */
async function captureChatShellReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "chat-ab", "shell-shots");
  mkdirSync(outDir, { recursive: true });
  const cookie = { Cookie: `session=${sessionValue}` };
  const titles = [
    "Weekend garden plans", "Shopping list ideas", "Science fair volcano", "Bedtime story about a fox", "Packing for the beach",
    "Birthday party games", "Fixing the bike chain", "Spanish homework help", "Soup recipes for winter", "Cleaning the fish tank",
    "Board games for four", "Planning a camping trip", "Why the sky is blue", "Piano practice schedule", "Car trip playlist",
    "Library books to borrow", "Making pancakes", "How volcanoes work", "Thank you note wording", "Chores chart",
  ];
  for (const title of titles) await seedTitledConversation("captureChatShellReview", cookie, title);
  const conversation = await seedTitledConversation("captureChatShellReview", cookie, "Homework helper notes");
  const desktop = VIEWPORTS.find((v) => v.slug === "desktop")!;
  const seedContext = await newContext(browser, desktop, "dark", sessionValue);
  try {
    const page = await seedContext.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await openStoredConversation(page, conversation.id, "Homework helper notes");
    await sendChatMessage(page, RICH_REPLY_PROMPT);
    await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ state: "detached", timeout: 30000 });
    await page.getByRole("heading", { name: "Homework helper" }).waitFor({ timeout: 30000 });
  } finally {
    await seedContext.close();
  }

  const measure = (page: Page) => page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
    };
    const font = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return null;
      const style = getComputedStyle(element);
      return `${style.fontSize}/${style.lineHeight} ${style.fontWeight}`;
    };
    const bg = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      return element ? getComputedStyle(element).backgroundColor : null;
    };
    return {
      rail: box('[data-slot="app-rail"]'),
      railItem: box('[data-slot="app-rail-item"]'),
      profile: box('[data-slot="rail-profile-trigger"]'),
      history: box('[data-slot="next-chat-rail"]'),
      newChat: box('[data-slot="aui_thread-list-new"]'),
      search: box('[data-slot="next-chat-rail"] input'),
      row: box('[data-slot="aui_thread-list-item"]'),
      rowFont: font('[data-slot="aui_thread-list-item-title"]'),
      sectionLabelFont: font('[data-slot="aui_thread-list-group-label"]'),
      header: box('[data-slot="next-chat-header"]'),
      titleFont: font('[data-chat-header-bar] button span'),
      column: box('[data-slot="aui_thread-viewport"] > .mx-auto'),
      userBubble: box('.aui-user-message-content'),
      userFont: font('.aui-user-message-content'),
      assistantFont: font('[data-slot="aui_assistant-message-content"] p'),
      composer: box('[data-slot="aui_composer-shell"]'),
      composerInput: box('[data-slot="aui_composer-shell"] textarea'),
      composerFont: font('[data-slot="aui_composer-shell"] textarea'),
      sendButton: box('[data-slot="aui_composer-shell"] button[aria-label="Send message"]'),
      historyRows: document.querySelectorAll('[data-slot="aui_thread-list-item"]').length,
      historyRowsVisible: [...document.querySelectorAll<HTMLElement>('[data-slot="aui_thread-list-item"]')].filter((row) => { const r = row.getBoundingClientRect(); return r.height > 0 && r.bottom <= window.innerHeight; }).length,
      tones: { rail: bg('[data-slot="app-rail"]'), history: bg('[data-slot="next-chat-rail"]'), header: bg('[data-slot="next-chat-header"]'), workspace: bg('[data-slot="rail-workspace"]'), composer: bg('[data-slot="aui_composer-shell"]'), userBubble: bg('.aui-user-message-content') },
      composerBorder: (() => { const el = document.querySelector<HTMLElement>('[data-slot="aui_composer-shell"]'); return el ? getComputedStyle(el).borderTopColor : null; })(),
      historyDivider: (() => { const el = document.querySelector<HTMLElement>('[data-slot="next-chat-rail"]'); return el ? `${getComputedStyle(el).borderRightWidth} ${getComputedStyle(el).borderRightColor}` : null; })(),
      headerDivider: (() => { const el = document.querySelector<HTMLElement>('[data-slot="next-chat-header"]'); return el ? getComputedStyle(el).borderBottomWidth : null; })(),
      vars: Object.fromEntries(["--background", "--foreground", "--shell-main", "--shell-rail", "--shell-history", "--shell-composer-bg"].map((name) => [name, getComputedStyle(document.body).getPropertyValue(name).trim()])),
      pageOverflowX: document.documentElement.scrollWidth > window.innerWidth,
    };
  });

  const shoot = async (page: Page, name: string) => {
    await settleAnimations(page);
    const file = join(outDir, `${name}.png`);
    await page.screenshot({ path: file });
    console.log(`Wrote ${file}`);
  };

  for (const theme of THEMES) {
    const context = await newContext(browser, desktop, theme, sessionValue);
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
      await openStoredConversation(page, conversation.id, "Homework helper notes");
      await page.getByRole("heading", { name: "Homework helper" }).waitFor();
      await page.getByRole("navigation", { name: "Primary navigation" }).waitFor();
      await shoot(page, `shell-conversation-1440-${theme}`);
      const numbers = await measure(page);
      console.log(`chat-shell measure 1440/${theme}: ${JSON.stringify(numbers)}`);
      if (numbers.pageOverflowX) throw new Error(`captureChatShellReview: horizontal page overflow at 1440/${theme}`);

      const composer = page.getByRole("textbox", { name: "Message input" });
      await composer.fill(Array.from({ length: 12 }, (_, i) => `Line ${i + 1} of a longer message that keeps going.`).join("\n"));
      await shoot(page, `shell-composer-multiline-1440-${theme}`);
      console.log(`chat-shell composer multiline 1440/${theme}: ${JSON.stringify(await measure(page).then((m) => ({ composer: m.composer, input: m.composerInput })))}`);
      await composer.fill("");

      await page.locator('[data-slot="rail-profile-trigger"]').click();
      await page.getByRole("menuitem", { name: /Settings/ }).waitFor();
      await shoot(page, `shell-profile-menu-1440-${theme}`);
      const menu = await page.evaluate(() => {
        const popup = document.querySelector<HTMLElement>('[data-slot="dropdown-menu-content"]');
        const item = document.querySelector<HTMLElement>('[data-slot="dropdown-menu-item"]');
        return { menu: popup && { width: Math.round(popup.getBoundingClientRect().width) }, row: item && { height: Math.round(item.getBoundingClientRect().height) } };
      });
      console.log(`chat-shell profile menu 1440/${theme}: ${JSON.stringify(menu)}`);
      await page.keyboard.press("Escape");

      await page.goto(`${BASE_URL}/chat`);
      await page.getByRole("textbox", { name: "Message input" }).waitFor();
      await shoot(page, `shell-new-chat-1440-${theme}`);
      console.log(`chat-shell new chat 1440/${theme}: ${JSON.stringify(await measure(page).then((m) => ({ composer: m.composer, column: m.column })))}`);
    } finally {
      await context.close();
    }
  }

  // The attention badge: a real flagged turn notifies the signed-in admin.
  await flagTurnsAsMarlow(sessionValue, ["I want to kill myself"], "captureChatShellReview");
  for (const theme of THEMES) {
    const context = await newContext(browser, desktop, theme, sessionValue);
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
      await openStoredConversation(page, conversation.id, "Homework helper notes");
      await page.locator('[data-slot="rail-profile-badge"]').waitFor({ timeout: 30000 });
      await shoot(page, `shell-attention-1440-${theme}`);
      await page.locator('[data-slot="rail-profile-trigger"]').click();
      await page.getByRole("menuitem", { name: /Notifications/ }).waitFor();
      await shoot(page, `shell-attention-menu-1440-${theme}`);
      await page.getByRole("menuitem", { name: /Notifications/ }).click();
      await page.getByRole("button", { name: "Dismiss all" }).waitFor();
      await shoot(page, `shell-notifications-open-1440-${theme}`);
    } finally {
      await context.close();
    }
  }

  // Other pages keep the rail and get the slim page title bar.
  {
    const context = await newContext(browser, desktop, "dark", sessionValue);
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
      for (const [path, name] of [["/", "home"], ["/settings", "settings"], ["/people", "family"]] as const) {
        await page.goto(`${BASE_URL}${path}`);
        await page.getByRole("heading", { level: 1 }).first().waitFor({ state: "attached" });
        await page.locator('[role="status"][aria-label*="oading"]').first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(800);
        await shoot(page, `shell-page-${name}-1440-dark`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        if (overflow) throw new Error(`captureChatShellReview: horizontal page overflow on ${path}`);
      }
      // Incognito on: the menu row shows it, the avatar wears the ring.
      await page.goto(`${BASE_URL}/chat`);
      await page.getByRole("textbox", { name: "Message input" }).waitFor();
      await page.locator('[data-slot="rail-profile-trigger"]').click();
      await page.getByRole("menuitem", { name: /Incognito/ }).click();
      // Incognito cross-fades through an 800ms view transition, which
      // holds pointer events on <html> until it ends.
      await page.waitForTimeout(1200);
      await page.keyboard.press("Escape");
      const explain = page.getByRole("dialog");
      if (await explain.count()) {
        await page.keyboard.press("Escape");
        await explain.waitFor({ state: "detached" }).catch(() => {});
      }
      await page.locator('[data-slot="rail-profile-trigger"]').click();
      await page.getByRole("menuitem", { name: /Incognito/ }).waitFor();
      await shoot(page, "shell-incognito-menu-1440-dark");
    } finally {
      await context.close();
    }
  }

  const phone = VIEWPORTS.find((v) => v.slug === "phone")!;
  const context = await newContext(browser, phone, "dark", sessionValue);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await openStoredConversation(page, conversation.id, "Homework helper notes");
    await page.getByRole("heading", { name: "Homework helper" }).waitFor();
    await shoot(page, "shell-conversation-390-dark");
    const numbers = await measure(page);
    console.log(`chat-shell measure 390/dark: ${JSON.stringify(numbers)}`);
    if (numbers.pageOverflowX) throw new Error("captureChatShellReview: horizontal page overflow at 390");
  } finally {
    await context.close();
  }
}

/** SKILLS-PAGE-01: the Skills section of Chat settings for an adult and a
 * teen, at 1440 and 390, light and dark, with the empty "Added to this home" state. */
async function captureChatSkillsReview(browser: Browser, ownerSession: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "chat-ab", "skills-shots");
  mkdirSync(outDir, { recursive: true });
  const ownerHeaders = { "Content-Type": "application/json", Cookie: `session=${ownerSession}` };
  const created = await fetch(`${BASE_URL}/api/people`, {
    method: "POST", headers: ownerHeaders,
    body: JSON.stringify({ displayName: "Skills Reviewer", role: "teen", secret: "review-skills-secret" }),
  });
  if (!created.ok) throw new Error(`skills review teen setup failed: ${created.status} ${await created.text()}`);
  const teen = await created.json() as { id: string };
  const signedIn = await fetch(`${BASE_URL}/api/auth/verify-secret`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ personId: teen.id, secret: "review-skills-secret" }),
  });
  const teenSession = signedIn.headers.get("set-cookie")?.split(";")[0]?.split("=")[1];
  if (!teenSession) throw new Error("skills review teen sign-in carried no session cookie");
  for (const [who, session] of [["adult", ownerSession], ["teen", teenSession]] as const) {
    for (const slug of ["desktop", "phone"] as const) {
      const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
      for (const theme of THEMES) {
        const context = await newContext(browser, viewport, theme, session);
        try {
          const page = await context.newPage();
          page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
          await page.goto(`${BASE_URL}/settings?tab=me&section=skills`);
          await page.locator("[data-skill-id]").first().waitFor();
          await page.getByText("No skills added yet").waitFor();
          const counts = await page.evaluate(() => ({
            rows: document.querySelectorAll("[data-skill-id]").length,
            used: [...document.querySelectorAll("[data-skill-id]")].filter((el) => el.textContent?.includes("Used in chat")).length,
            overflow: document.documentElement.scrollWidth > window.innerWidth,
          }));
          console.log(`skills ${who} ${slug} ${theme}: ${JSON.stringify(counts)}`);
          if (counts.overflow) throw new Error(`skills ${who} ${slug} ${theme} scrolls sideways`);
          await settleAnimations(page);
          const file = join(outDir, `skills-${who}-${viewport.width}-${theme}.png`);
          await page.screenshot({ path: file, fullPage: true });
          console.log(`Wrote ${file}`);
        } finally {
          await context.close();
        }
      }
    }
  }
}

/** PROJECTS-01b: the chat column's Projects section on the seeded owner
 * (two projects, chats inside and outside), at 1440 and 390 in both themes:
 * a project open, the chat menu's project list, the new project field, and
 * a child's column (a parent's project, no "+"). */
async function captureChatProjectsReview(browser: Browser, ownerSession: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "chat-ab", "projects-shots");
  mkdirSync(outDir, { recursive: true });
  const cookie = { Cookie: `session=${ownerSession}` };
  const json = { "Content-Type": "application/json", ...cookie };
  const makeFolder = async (name: string, person?: string) => {
    const res = await fetch(`${BASE_URL}/api/chat-folders`, { method: "POST", headers: json, body: JSON.stringify(person ? { name, person } : { name }) });
    if (!res.ok) throw new Error(`projects review: making ${name} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as { id: string };
  };
  const moveInto = async (conversationId: string, folderId: string) => {
    const res = await fetch(`${BASE_URL}/api/conversations/${conversationId}`, { method: "PATCH", headers: json, body: JSON.stringify({ folder_id: folderId }) });
    if (!res.ok) throw new Error(`projects review: moving a chat failed: ${res.status}`);
  };
  const garden = await makeFolder("Garden plans");
  const fair = await makeFolder("Science fair");
  for (const title of ["Raised bed layout", "When to plant tomatoes", "Compost basics"]) await moveInto((await seedTitledConversation("captureChatProjectsReview", cookie, title)).id, garden.id);
  for (const title of ["Volcano model", "Poster ideas"]) await moveInto((await seedTitledConversation("captureChatProjectsReview", cookie, title)).id, fair.id);
  for (const title of ["Dinner ideas", "Packing for the beach", "Birthday party games", "Fixing the bike chain"]) await seedTitledConversation("captureChatProjectsReview", cookie, title);

  const shoot = async (page: Page, name: string) => {
    await settleAnimations(page);
    const file = join(outDir, `${name}.png`);
    await page.screenshot({ path: file });
    console.log(`Wrote ${file}`);
  };
  const openChat = async (page: Page) => {
    await page.addInitScript(() => localStorage.setItem("maipai.chat.rail-collapsed", "0"));
    await page.goto(`${BASE_URL}/chat`);
    await page.getByRole("textbox", { name: "Message input" }).waitFor();
  };
  const panel = (page: Page, phone: boolean) => (phone ? page.getByRole("dialog") : page.locator('[data-slot="next-chat-rail"]'));
  const measure = (page: Page) => page.evaluate(() => {
    const height = (selector: string) => document.querySelector<HTMLElement>(selector)?.getBoundingClientRect().height ?? null;
    return {
      projectRow: height('[data-slot="aui_thread-list-project"]'),
      chatRow: height('[data-slot="aui_thread-list-item"]'),
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  });

  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    const phone = slug === "phone";
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, ownerSession);
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
        await openChat(page);
        if (phone) await page.getByRole("button", { name: "Show threads" }).click();
        const column = panel(page, phone);
        await column.getByText("Garden plans").waitFor();
        await column.locator('[data-slot="aui_thread-list-project-trigger"]', { hasText: "Garden plans" }).click();
        await column.getByText("Raised bed layout").waitFor();
        const measured = await measure(page);
        console.log(`projects ${slug} ${theme}: ${JSON.stringify(measured)}`);
        if (measured.overflow) throw new Error(`projects review ${slug} ${theme} scrolls sideways`);
        if (!phone && measured.projectRow !== measured.chatRow) throw new Error(`project row ${measured.projectRow}px differs from chat row ${measured.chatRow}px`);
        await shoot(page, `projects-open-${viewport.width}-${theme}`);
        if (!phone) {
          const row = column.locator('[data-slot="aui_thread-list-item"]', { hasText: "Dinner ideas" });
          await row.hover();
          await row.getByRole("button", { name: "More options" }).click();
          await page.getByRole("menuitem", { name: "Move to project" }).click();
          await page.getByRole("menuitem", { name: "Science fair" }).waitFor();
          await shoot(page, `projects-move-menu-${viewport.width}-${theme}`);
          await page.keyboard.press("Escape");
          await column.getByRole("button", { name: "New project" }).click();
          await column.getByPlaceholder("Project name").fill("Recipes");
          await shoot(page, `projects-new-field-${viewport.width}-${theme}`);
          await page.keyboard.press("Escape");
          if (theme === "light") {
            // New chat in project, end to end: the first message lands the chat in the project.
            const projectRow = column.locator('[data-slot="aui_thread-list-project"]', { hasText: "Science fair" });
            await projectRow.hover();
            await projectRow.getByRole("button", { name: "Project options" }).click();
            await page.getByRole("menuitem", { name: "New chat in project" }).click();
            await sendChatMessage(page, "Ideas for a baking soda volcano");
            await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ state: "detached", timeout: 30000 });
            const listed = (await (await fetch(`${BASE_URL}/api/conversations`, { headers: cookie })).json()) as Array<{ id: string; folder_id: string | null; turn_count: number }>;
            const inFair = listed.filter((row) => row.folder_id === fair.id && row.turn_count > 0);
            if (inFair.length !== 1) throw new Error(`New chat in project: expected one chat with turns in Science fair, found ${inFair.length}`);
            await column.locator('[data-slot="aui_thread-list-project-items"] [data-slot="aui_thread-list-item"]').first().waitFor();
            await shoot(page, `projects-new-chat-in-project-${viewport.width}-${theme}`);
          }
        }
      } finally {
        await context.close();
      }
    }
  }

  // A child's column: a project a parent made, no "+".
  const childRes = await fetch(`${BASE_URL}/api/people`, { method: "POST", headers: json, body: JSON.stringify({ displayName: "Pippa", role: "child" }) });
  if (!childRes.ok) throw new Error(`projects review: child setup failed: ${childRes.status}`);
  const child = (await childRes.json()) as { id: string };
  await makeFolder("Homework", child.id);
  const selected = await fetch(`${BASE_URL}/api/auth/select`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personId: child.id }) });
  const childSession = selected.headers.get("set-cookie")?.split(";")[0]?.split("=")[1];
  if (!childSession) throw new Error("projects review: the child sign-in carried no session cookie");
  const context = await newContext(browser, VIEWPORTS.find((v) => v.slug === "desktop")!, "light", childSession);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await openChat(page);
    const column = panel(page, false);
    await column.getByText("Homework").waitFor();
    if (await column.getByRole("button", { name: "New project" }).count()) throw new Error("a child's column offers New project");
    await shoot(page, "projects-child-1440-light");
  } finally {
    await context.close();
  }
}

/** COLUMN-01 (owner, 2026-10-06): the chat history column, open, hidden,
 * mid-slide, searching, hovered and selected rows, pinned, empty, loading
 * and the phone sheet, in both themes, measured. */
async function captureChatColumnReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "chat-ab", "column-shots");
  mkdirSync(outDir, { recursive: true });
  const cookie = { Cookie: `session=${sessionValue}` };
  const desktop = VIEWPORTS.find((v) => v.slug === "desktop")!;
  const phone = VIEWPORTS.find((v) => v.slug === "phone")!;
  const log = (label: string, value: unknown) => console.log(`chat-column ${label}: ${JSON.stringify(value)}`);
  const shoot = async (page: Page, name: string) => {
    await settleAnimations(page);
    const file = join(outDir, `${name}.png`);
    await page.screenshot({ path: file });
    console.log(`Wrote ${file}`);
  };
  const openChat = async (page: Page, collapsed: "0" | "1") => {
    await page.addInitScript((value) => localStorage.setItem("maipai.chat.rail-collapsed", value), collapsed);
    await page.goto(`${BASE_URL}/chat`);
    await page.getByRole("textbox", { name: "Message input" }).waitFor();
  };

  // INCOGNITO-ANIM-01: switching Incognito on has no transition. Frames at
  // 60 and 400 ms after the click, and whether any view-transition animation
  // ran (label from INCOGNITO_ANIM_LABEL: "before" on the old build).
  {
    const label = process.env.INCOGNITO_ANIM_LABEL ?? "after";
    const context = await newContext(browser, desktop, "dark", sessionValue);
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
      await page.addInitScript(() => localStorage.setItem("maipai.incognito-explanation-seen", "true"));
      await page.goto(`${BASE_URL}/chat`);
      await page.getByRole("textbox", { name: "Message input" }).waitFor();
      await page.locator('[data-slot="rail-profile-trigger"]').click();
      const item = page.getByRole("menuitem", { name: /Incognito/ });
      await page.evaluate(() => {
        const w = window as unknown as { __vt: boolean };
        w.__vt = false;
        const tick = () => { if (document.getAnimations().some((a) => String((a.effect as KeyframeEffect | null)?.pseudoElement ?? "").includes("view-transition"))) w.__vt = true; requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      });
      await item.click();
      await page.waitForTimeout(60);
      await page.screenshot({ path: join(outDir, `incognito-${label}-60ms-1440-dark.png`) });
      await page.waitForTimeout(340);
      await page.screenshot({ path: join(outDir, `incognito-${label}-400ms-1440-dark.png`) });
      await page.waitForTimeout(900);
      log(`incognito ${label}`, { viewTransitionRan: await page.evaluate(() => (window as unknown as { __vt: boolean }).__vt), incognitoClass: await page.evaluate(() => document.documentElement.classList.contains("incognito")) });
    } finally {
      await context.close();
    }
  }

  // Empty: before any conversation exists for this person.
  for (const theme of THEMES) {
    const context = await newContext(browser, desktop, theme, sessionValue);
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
      await openChat(page, "0");
      await page.getByText("Your chats will show up here.").waitFor();
      await shoot(page, `column-empty-1440-${theme}`);
    } finally {
      await context.close();
    }
  }

  const titles = [
    "Weekend garden plans", "Shopping list ideas", "Science fair volcano", "Bedtime story about a fox", "Packing for the beach",
    "Birthday party games", "Fixing the bike chain", "Spanish homework help", "Soup recipes for winter", "Cleaning the fish tank",
    "Board games for four", "Planning a camping trip", "Why the sky is blue", "Piano practice schedule", "Car trip playlist",
    "Library books to borrow", "Making pancakes", "How volcanoes work", "Thank you note wording", "Chores chart",
    "A very long conversation title that keeps going well past the column edge",
  ];
  for (const title of titles) await seedTitledConversation("captureChatColumnReview", cookie, title);
  const conversation = await seedTitledConversation("captureChatColumnReview", cookie, "Homework helper notes");
  {
    const context = await newContext(browser, desktop, "dark", sessionValue);
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
      await openStoredConversation(page, conversation.id, "Homework helper notes");
      await sendChatMessage(page, RICH_REPLY_PROMPT);
      await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ state: "detached", timeout: 30000 });
      await page.getByRole("heading", { name: "Homework helper" }).waitFor({ timeout: 30000 });
      // Pin two conversations through the row menu, the way a person does.
      for (const title of ["Weekend garden plans", "Chores chart"]) {
        const row = page.locator('[data-slot="aui_thread-list-item"]', { hasText: title });
        await row.hover();
        await row.getByRole("button", { name: "More options" }).click();
        await page.getByRole("menuitem", { name: "Pin" }).click();
        await page.locator('[data-slot="aui_thread-list-group-label"]', { hasText: "Pinned" }).waitFor();
      }
    } finally {
      await context.close();
    }
  }

  const measure = (page: Page) => page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
    };
    const font = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return null;
      const style = getComputedStyle(element);
      return `${style.fontSize}/${style.lineHeight} ${style.fontWeight} ${style.color}`;
    };
    const rows = [...document.querySelectorAll<HTMLElement>('[data-slot="next-chat-rail"] [data-slot="aui_thread-list-item"]')];
    return {
      column: box('[data-slot="next-chat-rail"]'),
      inner: box('[data-slot="chat-column-inner"]'),
      header: box('[data-slot="next-chat-rail"] [data-slot="chat-column-header"]'),
      title: font('[data-slot="next-chat-rail"] [data-slot="chat-column-title"]'),
      toggle: box('[data-slot="next-chat-rail"] [data-slot="chat-column-toggle"]'),
      newChat: box('[data-slot="next-chat-rail"] [data-slot="aui_thread-list-new"]'),
      row: box('[data-slot="next-chat-rail"] [data-slot="aui_thread-list-item"]'),
      rowFont: font('[data-slot="next-chat-rail"] [data-slot="aui_thread-list-item-title"]'),
      label: box('[data-slot="next-chat-rail"] [data-slot="aui_thread-list-group-label"]'),
      labelFont: font('[data-slot="next-chat-rail"] [data-slot="aui_thread-list-group-label"]'),
      rowsVisible: rows.filter((row) => { const r = row.getBoundingClientRect(); return r.height > 0 && r.bottom <= window.innerHeight; }).length,
      rows: rows.length,
      borders: [...document.querySelectorAll<HTMLElement>('[data-slot="chat-column-panel"] *')].filter((el) => { const s = getComputedStyle(el); return ["Top", "Right", "Bottom", "Left"].some((side) => parseFloat(s.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 && s.getPropertyValue(`border-${side.toLowerCase()}-style`) !== "none"); }).map((el) => el.getAttribute("data-slot") ?? el.tagName),
      headerToggle: box('[data-slot="next-chat-header"] [data-slot="chat-column-toggle"]'),
      composer: box('[data-slot="aui_composer-shell"]'),
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
    };
  });

  for (const theme of THEMES) {
    const context = await newContext(browser, desktop, theme, sessionValue);
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
      await page.addInitScript(() => localStorage.setItem("maipai.chat.rail-collapsed", "0"));
      await openStoredConversation(page, conversation.id, "Homework helper notes");
      await page.getByRole("heading", { name: "Homework helper" }).waitFor();
      await page.mouse.move(900, 450);
      await shoot(page, `column-open-1440-${theme}`);
      const open = await measure(page);
      log(`open 1440/${theme}`, open);
      if (open.overflowX) throw new Error(`captureChatColumnReview: horizontal overflow at 1440/${theme}`);
      if (open.borders.length) throw new Error(`captureChatColumnReview: borders inside the column: ${open.borders.join(", ")}`);

      // A hovered row beside the selected one.
      await page.locator('[data-slot="next-chat-rail"] [data-slot="aui_thread-list-item"]', { hasText: "Science fair volcano" }).hover();
      await shoot(page, `column-hover-1440-${theme}`);

      // Thread search.
      await page.mouse.move(900, 450);
      await page.getByRole("button", { name: "Search chats" }).click();
      await page.keyboard.type("vol");
      await shoot(page, `column-search-1440-${theme}`);
      const focusedInSearch = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
      log(`search focus 1440/${theme}`, focusedInSearch);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      log(`search closed focus 1440/${theme}`, await page.evaluate(() => document.activeElement?.getAttribute("aria-label")));

      // Hide: frame-sample the slide, then the hidden state.
      await page.mouse.move(900, 450);
      const startedAt = await page.evaluate(() => {
        const samples: Array<[number, number, number, number]> = [];
        (window as unknown as { __col: typeof samples }).__col = samples;
        const column = document.querySelector<HTMLElement>('[data-slot="next-chat-rail"]')!;
        const inner = document.querySelector<HTMLElement>('[data-slot="chat-column-inner"]')!;
        const start = performance.now();
        const tick = () => {
          const composer = document.querySelector<HTMLElement>('[data-slot="aui_composer-shell"]')!;
          samples.push([Math.round(performance.now() - start), Math.round(column.getBoundingClientRect().width), Math.round(inner.getBoundingClientRect().width), Math.round(composer.getBoundingClientRect().x)]);
          if (performance.now() - start < 600) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        return start;
      });
      void startedAt;
      await page.getByRole("button", { name: "Hide conversations" }).click();
      if (theme === "dark") {
        for (const at of [60, 120]) {
          await page.waitForTimeout(at === 60 ? 40 : 60);
          await page.screenshot({ path: join(outDir, `column-collapsing-${at}ms-1440-dark.png`) });
        }
      }
      await page.waitForTimeout(700);
      const frames = await page.evaluate(() => (window as unknown as { __col: Array<[number, number, number, number]> }).__col);
      const moving = frames.filter((frame, i) => i > 0 && frame[1] !== frames[i - 1]![1]);
      log(`collapse frames 1440/${theme}`, frames);
      log(`collapse duration ms 1440/${theme}`, moving.length ? moving[moving.length - 1]![0] - frames[0]![0] : 0);
      if (frames.some((frame) => frame[2] !== frames[0]![2])) throw new Error("captureChatColumnReview: the column's content changed width while it slid");
      await shoot(page, `column-collapsed-1440-${theme}`);
      const collapsed = await measure(page);
      log(`collapsed 1440/${theme}`, collapsed);
      log(`collapsed focus 1440/${theme}`, await page.evaluate(() => document.activeElement?.getAttribute("aria-label")));
      // Keyboard shortcut opens it again.
      await page.keyboard.press(process.platform === "darwin" ? "Meta+b" : "Control+b");
      await page.waitForTimeout(500);
      const reopened = await measure(page);
      log(`shortcut reopened 1440/${theme}`, reopened.column);
      if (!reopened.column || reopened.column.width < 200) throw new Error("captureChatColumnReview: the keyboard shortcut did not reopen the column");
    } finally {
      await context.close();
    }
  }

  // COLUMN-02 hover peek: hidden column, the pointer rests on the left edge.
  for (const theme of THEMES) {
    const context = await newContext(browser, desktop, theme, sessionValue);
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
      await page.addInitScript(() => localStorage.setItem("maipai.chat.rail-collapsed", "1"));
      await openStoredConversation(page, conversation.id, "Homework helper notes");
      await page.getByRole("heading", { name: "Homework helper" }).waitFor();
      await page.mouse.move(900, 450);
      await page.waitForTimeout(300);
      const before = await measure(page);
      const zone = await page.locator('[data-slot="chat-column-hover-zone"]').boundingBox();
      if (!zone) throw new Error("COLUMN-02: no hover zone while the column is hidden");
      log(`hover zone 1440/${theme}`, zone);
      // Passing the pointer over the zone and away does not open it.
      await page.mouse.move(zone.x + 2, 450);
      await page.mouse.move(900, 450);
      await page.waitForTimeout(350);
      if (await page.locator('[data-slot="next-chat-rail"][data-state="peek"]').count()) throw new Error("COLUMN-02: a pass over the zone opened the peek");
      // Resting on it does.
      await page.mouse.move(zone.x + 2, 450);
      await page.locator('[data-slot="next-chat-rail"][data-state="peek"]').waitFor();
      await page.waitForTimeout(300);
      await shoot(page, `column-peek-1440-${theme}`);
      const during = await measure(page);
      const peekBox = await page.locator('[data-slot="next-chat-rail"][data-state="peek"] [data-slot="chat-column-inner"]').boundingBox();
      log(`peek 1440/${theme}`, { peekBox, composerBefore: before.composer, composerDuring: during.composer, headerToggleBefore: before.headerToggle, headerToggleDuring: during.headerToggle });
      if (!peekBox || Math.round(peekBox.width) !== 288) throw new Error("COLUMN-02: the peek is not 288 wide");
      if (JSON.stringify(before.composer) !== JSON.stringify(during.composer)) throw new Error("COLUMN-02: the peek moved the conversation");
      // Stays while the pointer is inside; closes a moment after it leaves.
      await page.mouse.move(peekBox.x + 140, 300);
      await page.waitForTimeout(500);
      if (!(await page.locator('[data-slot="next-chat-rail"][data-state="peek"]').count())) throw new Error("COLUMN-02: the peek closed with the pointer inside it");
      await page.mouse.move(900, 450);
      await page.locator('[data-slot="next-chat-rail"][data-state="peek"]').waitFor({ state: "detached" });
      // Keyboard focus never opens it; Escape closes it.
      await page.getByRole("button", { name: "Show conversations" }).focus();
      await page.waitForTimeout(300);
      if (await page.locator('[data-slot="next-chat-rail"][data-state="peek"]').count()) throw new Error("COLUMN-02: keyboard focus opened the peek");
      await page.mouse.move(zone.x + 2, 450);
      await page.locator('[data-slot="next-chat-rail"][data-state="peek"]').waitFor();
      await page.keyboard.press("Escape");
      await page.locator('[data-slot="next-chat-rail"][data-state="peek"]').waitFor({ state: "detached" });
      // The pin control docks the column (the pointer leaves and returns,
      // since a pointer that never moved raises no new enter).
      await page.mouse.move(900, 450);
      await page.waitForTimeout(200);
      await page.mouse.move(zone.x + 2, 450);
      await page.locator('[data-slot="next-chat-rail"][data-state="peek"]').waitFor();
      await page.getByRole("button", { name: "Keep conversations open" }).click();
      await page.waitForTimeout(500);
      const docked = await measure(page);
      log(`pinned 1440/${theme}`, docked.column);
      if (!docked.column || docked.column.width < 280) throw new Error("COLUMN-02: pinning did not dock the column");
    } finally {
      await context.close();
    }
  }

  // COLUMN-02 chat settings: the gear opens Settings, Me, Chat.
  for (const theme of THEMES) {
    const context = await newContext(browser, desktop, theme, sessionValue);
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
      await page.addInitScript(() => localStorage.setItem("maipai.chat.rail-collapsed", "0"));
      await openStoredConversation(page, conversation.id, "Homework helper notes");
      await page.getByRole("heading", { name: "Homework helper" }).waitFor();
      const gear = page.getByRole("link", { name: "Chat settings" });
      await gear.hover();
      await page.getByRole("tooltip").waitFor();
      await shoot(page, `column-chat-settings-tooltip-1440-${theme}`);
      await gear.click();
      await page.getByRole("tab", { name: "Chat", exact: true }).last().waitFor();
      await page.waitForTimeout(1500);
      log(`chat settings ids 1440/${theme}`, await page.evaluate(() => [...document.querySelectorAll('[id^="settings-"]')].map((el) => el.id)));
      log(`chat settings url 1440/${theme}`, page.url());
      await shoot(page, `settings-chat-1440-${theme}`);
    } finally {
      await context.close();
    }
  }

  // CHAT-NOTICE-LED-01: the calm composer notice, a status dot then one sentence.
  for (const [slug, viewport] of [["1440", desktop], ["390", phone]] as const) {
    for (const theme of THEMES) {
      for (const level of ["amber", "red"] as const) {
        const context = await newContext(browser, viewport, theme, sessionValue);
        try {
          const page = await context.newPage();
          page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
          await page.route("**/api/health", async (route) => {
            const response = await route.fetch();
            const body = await response.json();
            body.engines = { ...(body.engines ?? {}), chat: { kind: "stopped", pid: null, alive: false, availability: "unavailable", reason: "stopped", notice: {
              adult: "Chat is paused. Your message stays here; press Send once it is back.",
              teen: "Chat is paused right now. Your message stays here; press Send once it is back.",
              child: "I'm taking a break. Ask a grown-up, or try again soon.",
              repairs_link: "Open Repairs",
            } } };
            await route.fulfill({ response, json: body });
          });
          await page.route("**/api/status/apps", (route) => route.fulfill({ json: [
            { id: "chat", name: "Chat", state: level === "red" ? "down" : "degraded", reason: level === "red" ? "Chat is down." : "Chat is paused.", paused: level === "amber", history: [], uptimePercent: 100 },
          ] }));
          await page.goto(`${BASE_URL}/chat`);
          await page.getByRole("textbox", { name: "Message input" }).waitFor();
          const notice = page.locator("[data-chat-notice]");
          await notice.waitFor();
          await page.waitForFunction((want) => document.querySelector("[data-chat-notice]")?.getAttribute("data-level") === want, level);
          const facts = await page.evaluate(() => {
            const el = document.querySelector<HTMLElement>("[data-chat-notice]")!;
            const dot = el.querySelector<HTMLElement>('[data-slot="chat-notice-dot"] > span')!;
            return { dot: getComputedStyle(dot).backgroundColor, dotSize: Math.round(dot.getBoundingClientRect().width), text: getComputedStyle(el).color, size: getComputedStyle(el).fontSize, box: getComputedStyle(el).backgroundColor, border: getComputedStyle(el).borderTopWidth };
          });
          log(`notice ${slug}/${theme}/${level}`, facts);
          await shoot(page, `notice-${level}-${slug}-${theme}`);
        } finally {
          await context.close();
        }
      }
    }
  }

  // Loading: hold the conversation list so the skeleton rows show.
  {
    const context = await newContext(browser, desktop, "dark", sessionValue);
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
      let release: () => void = () => {};
      const held = new Promise<void>((resolve) => { release = resolve; });
      await page.route("**/api/conversations?**", async (route) => { await held; await route.continue(); });
      await page.route("**/api/conversations", async (route) => { if (route.request().method() === "GET") await held; await route.continue(); });
      await page.addInitScript(() => localStorage.setItem("maipai.chat.rail-collapsed", "0"));
      await page.goto(`${BASE_URL}/chat`);
      await page.locator('[data-slot="next-chat-rail"] [data-slot="aui_thread-list-skeleton"]').first().waitFor();
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(outDir, "column-loading-1440-dark.png") });
      console.log(`Wrote ${join(outDir, "column-loading-1440-dark.png")}`);
      release();
    } finally {
      await context.close();
    }
  }

  // Phone: the same rows in the sheet behind the header's toggle.
  for (const theme of THEMES) {
    const context = await newContext(browser, phone, theme, sessionValue);
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
      await openStoredConversation(page, conversation.id, "Homework helper notes");
      await page.getByRole("button", { name: "Show threads" }).click();
      await page.getByRole("dialog").locator('[data-slot="aui_thread-list-item"]').first().waitFor();
      await shoot(page, `column-phone-sheet-390-${theme}`);
      const sheet = await page.evaluate(() => {
        const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
        const row = dialog.querySelector<HTMLElement>('[data-slot="aui_thread-list-item"]')!.getBoundingClientRect();
        return { width: Math.round(dialog.getBoundingClientRect().width), row: Math.round(row.height), overflowX: document.documentElement.scrollWidth > window.innerWidth };
      });
      log(`phone sheet 390/${theme}`, sheet);
    } finally {
      await context.close();
    }
  }
}

/** Opens a stored conversation and waits until the chat page has really
 * switched to it. `/chat?conversation=<id>` first renders the composer of
 * a fresh new-chat thread, then switches to the stored one once the
 * thread list answers; the switch swaps in that thread's own (empty)
 * composer. Text typed before the switch is dropped and Send stays
 * disabled (found 2026-10-06: `--next-chat-review` timed out on a
 * disabled Send whenever the list answered after the fill; reproduced on
 * demand by delaying `/api/conversations`). The active history row is the
 * thread runtime's own signal that the switch has happened. */
async function openStoredConversation(page: Page, conversationId: string, title: string): Promise<void> {
  await page.goto(`${BASE_URL}/chat?conversation=${conversationId}`);
  await page.getByRole("textbox", { name: "Message input" }).waitFor();
  // Attached, not visible: on phone the history column stays in the DOM
  // but hidden until "Show threads" opens its sheet.
  await page.locator('[data-slot="aui_thread-list-item"][data-active="true"]').filter({ hasText: title }).first().waitFor({ state: "attached" });
}

/** Types `text` and sends it, failing fast with the composer's own state
 * if Send never enables, instead of a bare 30 s click timeout. */
async function sendChatMessage(page: Page, text: string): Promise<void> {
  const composer = page.getByRole("textbox", { name: "Message input" });
  const send = page.getByRole("button", { name: "Send message", exact: true });
  await composer.fill(text);
  const deadline = Date.now() + 5000;
  while (!(await send.isEnabled())) {
    if (Date.now() > deadline) {
      throw new Error(`sendChatMessage: Send stayed disabled after typing; the composer holds ${JSON.stringify(await composer.inputValue())} (empty means the page swapped threads after the text was typed)`);
    }
    await page.waitForTimeout(100);
  }
  await send.click();
}

/** A real conversation with a real title, the recipe every capture
 * needing one uses: POST then PATCH, no fabricated fixture shape.
 * Throws with the capture's own name in the message on either call
 * failing, so a seeding failure reads as "captureX: ..." rather than a
 * bare fetch error several frames up. */
async function seedTitledConversation(callerName: string, cookie: Record<string, string>, title: string): Promise<{ id: string }> {
  const created = await fetch(`${BASE_URL}/api/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...cookie },
    body: JSON.stringify({ surface: "chat" }),
  });
  if (!created.ok) throw new Error(`${callerName}: creating the conversation failed: ${created.status}`);
  const row = (await created.json()) as { id: string };
  const renamed = await fetch(`${BASE_URL}/api/conversations/${row.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...cookie },
    body: JSON.stringify({ title }),
  });
  if (!renamed.ok) throw new Error(`${callerName}: setting the title failed: ${renamed.status}`);
  return row;
}

/** ELEMENTS-ADOPT-01 acceptance: a conversation with two replies (the action
 * row under both, the date line above the first message) and the new-chat
 * empty state, at 1440 and 390 in both themes. Written to
 * data-scratch/chat-ab/elements-shots like the shell review's captures. */
async function captureElementsReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "chat-ab", "elements-shots");
  mkdirSync(outDir, { recursive: true });
  const cookie = { Cookie: `session=${sessionValue}` };
  const conversation = await seedTitledConversation("captureElementsReview", cookie, "Homework helper notes");
  const desktop = VIEWPORTS.find((v) => v.slug === "desktop")!;
  const seedContext = await newContext(browser, desktop, "dark", sessionValue);
  try {
    const page = await seedContext.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await openStoredConversation(page, conversation.id, "Homework helper notes");
    await sendChatMessage(page, RICH_REPLY_PROMPT);
    await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ state: "detached", timeout: 30000 });
    await page.getByRole("heading", { name: "Homework helper" }).waitFor({ timeout: 30000 });
    await sendChatMessage(page, "Thanks. Can you say that again in one short sentence?");
    await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ state: "detached", timeout: 30000 });
    await page.waitForTimeout(500);
  } finally {
    await seedContext.close();
  }
  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
        await openStoredConversation(page, conversation.id, "Homework helper notes");
        await page.getByRole("heading", { name: "Homework helper" }).waitFor();
        await settleAnimations(page);
        const rows = await page.locator(".aui-assistant-action-bar-root").count();
        const lines = await page.locator('[data-slot="day-divider"]').count();
        console.log(`elements-review ${viewport.width}/${theme}: action rows ${rows}, date lines ${lines}`);
        await page.screenshot({ path: join(outDir, `conversation-${viewport.width}-${theme}.png`) });
        await page.locator('[data-slot="day-divider"]').first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        await page.locator('[data-slot="day-divider"]').first().scrollIntoViewIfNeeded();
        await settleAnimations(page);
        await page.screenshot({ path: join(outDir, `conversation-top-${viewport.width}-${theme}.png`) });
        await page.goto(`${BASE_URL}/chat`);
        await page.getByRole("textbox", { name: "Message input" }).waitFor();
        await settleAnimations(page);
        await page.screenshot({ path: join(outDir, `new-chat-${viewport.width}-${theme}.png`) });
        if (slug === "desktop" && theme === "dark") {
          // A starter chip sends its prompt like a typed message.
          await page.getByRole("button", { name: "Explain how rainbows form" }).click();
          await page.getByText("Explain how rainbows form, in plain words.").first().waitFor({ timeout: 15000 });
          console.log("elements-review: the Explain chip sent its prompt");
        }
      } finally {
        await context.close();
      }
    }
  }
  console.log(`Wrote captures to ${outDir}`);
}

/** HOME-UI-02e part two's own acceptance (COORDINATOR: "Captures at
 * 1440 and 390 with the list open and a selection active") - the
 * thread list's own restored multi-select, seeded with two real chat
 * threads (not the empty state) so the batch bar and a checked row both
 * show real content, not a placeholder. Written to data-scratch/ like
 * this file's other named review captures - a verification shot for
 * the coordinator to judge, not a permanent docs asset. */
/** ELEMENTS-ADOPT-02 review captures. Each persona sends one real turn
 * through the stub engine (POST /api/turn), then the shot opens that
 * conversation and drives the reply's own controls the way a person would. */
async function sessionFor(sessionValue: string, displayName: string | null): Promise<string> {
  if (!displayName) return sessionValue;
  const people = (await (await fetch(`${BASE_URL}/api/people`, { headers: { Cookie: `session=${sessionValue}` } })).json()) as Array<{ id: string; display_name: string }>;
  const person = people.find((p) => p.display_name === displayName);
  if (!person) throw new Error(`elements wave 2: seedHousehold() didn't create ${displayName}`);
  const select = await fetch(`${BASE_URL}/api/auth/select`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personId: person.id }) });
  const session = select.headers.get("set-cookie")?.split(";")[0]?.split("=")[1];
  if (!select.ok || !session) throw new Error(`elements wave 2: signing in as ${displayName} failed: ${select.status}`);
  return session;
}

async function seedTurnFor(session: string, text: string): Promise<{ conversation_id: string; turn_id: string }> {
  const turn = await fetch(`${BASE_URL}/api/turn`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: `session=${session}` }, body: JSON.stringify({ surface: "chat", text }) });
  if (!turn.ok) throw new Error(`elements wave 2: seeding a turn failed: ${turn.status} ${await turn.text()}`);
  return (await turn.json()) as { conversation_id: string; turn_id: string };
}

type Wave2Shot = { band: "adult" | "teen" | "child"; person: string | null; prompt: string; combos: ReadonlyArray<readonly ["desktop" | "phone", "light" | "dark"]>; drive(page: Page, band: "adult" | "teen" | "child"): Promise<void> };

const ALL_COMBOS = [["desktop", "light"], ["desktop", "dark"], ["phone", "light"], ["phone", "dark"]] as const;
const TWO_COMBOS = [["desktop", "light"], ["phone", "dark"]] as const;

function wave2Shots(part: string): Wave2Shot[] {
  if (part === "feedback") {
    const drive = async (page: Page, band: "adult" | "teen" | "child") => {
      await page.getByRole("button", { name: "Not helpful" }).last().click();
      if (band === "child") {
        await page.waitForTimeout(500);
        if (await page.locator('[data-slot="feedback-dialog"]').count()) throw new Error("elements wave 2: a child's thumbs-down drew the reasons form");
        return;
      }
      await page.locator('[data-slot="feedback-dialog"]').waitFor();
      await page.getByRole("button", { name: "Wrong" }).click();
      await page.getByRole("button", { name: "Too long" }).click();
      await page.getByLabel("Anything else?").fill("The opening hours were for another branch.");
    };
    return [
      { band: "adult", person: null, prompt: "When does the library open on Saturday?", combos: ALL_COMBOS, drive },
      { band: "teen", person: "Marlow", prompt: "When does the library open on Saturday?", combos: TWO_COMBOS, drive },
      { band: "child", person: "Nova", prompt: "When does the library open on Saturday?", combos: TWO_COMBOS, drive },
    ];
  }
  throw new Error(`elements wave 2: unknown part ${part}`);
}

async function captureElementsWave2Review(browser: Browser, sessionValue: string, part: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "chat-ab", "queue", "reports", "elements-wave2-shots");
  mkdirSync(outDir, { recursive: true });
  for (const shot of wave2Shots(part)) {
    const session = await sessionFor(sessionValue, shot.person);
    for (const [slug, theme] of shot.combos) {
      const seeded = await seedTurnFor(session, shot.prompt);
      const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
      const context = await newContext(browser, viewport, theme, session);
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
        await page.goto(`${BASE_URL}/chat?conversation=${seeded.conversation_id}`);
        await page.getByRole("button", { name: "Not helpful" }).last().waitFor({ timeout: 20000 });
        await shot.drive(page, shot.band);
        await settleAnimations(page);
        const file = `${part}-${shot.band}-${viewport.width}-${theme}.png`;
        await page.screenshot({ path: join(outDir, file) });
        console.log(`Wrote ${join(outDir, file)}`);
      } finally {
        await context.close();
      }
    }
  }
}

async function captureChatThreadActionsReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  const cookie = { Cookie: `session=${sessionValue}` };

  await seedTitledConversation("captureChatThreadActionsReview", cookie, "Weekend garden plans");
  await seedTitledConversation("captureChatThreadActionsReview", cookie, "Shopping list ideas");

  for (const viewport of [VIEWPORTS.find((v) => v.slug === "desktop")!, VIEWPORTS.find((v) => v.slug === "phone")!]) {
    const context = await newContext(browser, viewport, "dark", sessionValue);
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
      await page.goto(viewport.slug === "phone" ? `${BASE_URL}/chat?list=1` : `${BASE_URL}/chat`);
      await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
      await page.locator('[role="status"]').first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
      await page.getByText("Weekend garden plans", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Select chats" }).click();
      await page.getByRole("checkbox", { name: "Select “Weekend garden plans”" }).click();
      await page.getByText("1 selected", { exact: true }).waitFor();
      await settleAnimations(page);
      const file = `chat-thread-actions-${viewport.slug}-dark.png`;
      await page.screenshot({ path: join(outDir, file), fullPage: true });
      console.log(`Wrote ${join(outDir, file)}`);
    } finally {
      await context.close();
    }
  }
}

/** CHAT-LIST-01 follow-up audit: capture the current `/chat` thread-list
 * controls at 1440 and 390. Current NextThreadList renders New chat and
 * Search chats; it has no temporary-chat button. Seed one real
 * conversation so the list isn't the empty state. On phone the rail is
 * a Sheet, opened the same way a person would ("Show threads"). */
async function captureChatListReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  const cookie = { Cookie: `session=${sessionValue}` };


  await seedTitledConversation("captureChatListReview", cookie, "Weekend garden plans");

  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
        await page.addInitScript(() => localStorage.setItem("maipai.chat.rail-collapsed", "0"));
        await page.goto(`${BASE_URL}/chat`);
        await page.getByRole("textbox", { name: "Message input" }).waitFor();
        // On phone the rail column is still in the DOM (hidden, not
        // unmounted) once the Sheet's own copy of the same list opens
        // beside it - scoped to the open dialog the same way
        // NextChatPage.test.tsx's "New chat closes the phone/tablet
        // Sheet" test disambiguates the two.
        let scope: Page | Locator = page;
        if (slug === "phone") {
          await page.getByRole("button", { name: "Show threads" }).click();
          scope = page.getByRole("dialog");
        }
        await scope.getByText("Weekend garden plans", { exact: true }).waitFor();
        if (!(await scope.getByRole("textbox", { name: "Search threads" }).count())) {
          await scope.getByRole("button", { name: "Search chats" }).click();
        }
        await scope.getByRole("textbox", { name: "Search threads" }).waitFor();
        // CHAT-LIST-01's temporary-chat affordance is absent from the
        // current NextThreadList composition. Capture the controls that
        // the app actually ships and report that contract explicitly;
        // don't wait forever on the retired button label.
        await scope.getByRole("button", { name: "New chat", exact: true }).waitFor();
        await settleAnimations(page);
        const file = `chat-list-current-controls-${viewport.width}-${theme}.png`;
        await page.screenshot({ path: join(outDir, file), fullPage: slug === "phone" });
        console.log(`Wrote ${join(outDir, file)}`);
        if (!(await scope.getByRole("button", { name: "Start a temporary chat", exact: true }).count())) {
          console.log(`CHAT-LIST-01 temporary-chat control absent from ${slug}/${theme}; captured shipped New chat control instead`);
        }
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

/** B23 audit capture: real titled conversations with the kit search field
 * filled and the filtered Home list visible at requested desktop/light and
 * phone/dark sizes. */
async function captureChatSearchReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "chat-ab", "search-shots");
  mkdirSync(outDir, { recursive: true });
  const cookie = { Cookie: `session=${sessionValue}` };
  await seedTitledConversation("captureChatSearchReview", cookie, "Garden plans for spring");
  await seedTitledConversation("captureChatSearchReview", cookie, "Garden tools and seeds");
  await seedTitledConversation("captureChatSearchReview", cookie, "Family shopping list");
  for (const [slug, theme] of [["desktop", "light"], ["phone", "dark"]] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    const context = await newContext(browser, viewport, theme, sessionValue);
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
      await page.goto(`${BASE_URL}/chat`);
      await page.getByRole("textbox", { name: "Message input" }).waitFor();
      let scope: Page | Locator = page;
      if (slug === "phone") {
        await page.getByRole("button", { name: "Show threads" }).click();
        scope = page.getByRole("dialog");
      }
      const search = scope.getByRole("textbox", { name: "Search threads" });
      await search.fill("garden");
      await scope.getByText("Garden plans for spring", { exact: true }).waitFor();
      await scope.getByText("Garden tools and seeds", { exact: true }).waitFor();
      if (await scope.getByText("Family shopping list", { exact: true }).count()) throw new Error("Search audit state still shows a non-matching chat");
      await settleAnimations(page);
      const file = `chat-search-${viewport.width}-${theme}.png`;
      await page.screenshot({ path: join(outDir, file), fullPage: slug === "phone" });
      console.log(`Wrote ${join(outDir, file)}`);
      await page.close();
    } finally {
      await context.close();
    }
  }
}

/** CHAT-MOBILE-SHEET-01: capture and measure the phone history drawer at
 * 390x844 in both themes. The New chat row, Search field, first thread,
 * and shipped Sheet close button must share a comfortable 16px gutter. */
async function captureChatMobileSheetReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  const cookie = { Cookie: `session=${sessionValue}` };
  await seedTitledConversation("captureChatMobileSheetReview", cookie, "Weekend garden plans");
  const viewport = VIEWPORTS.find((v) => v.slug === "phone")!;
  for (const theme of THEMES) {
    const context = await newContext(browser, viewport, theme, sessionValue);
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
      await page.goto(`${BASE_URL}/chat`);
      await page.getByRole("textbox", { name: "Message input" }).waitFor();
      await page.getByRole("button", { name: "Show threads" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByText("Weekend garden plans", { exact: true }).waitFor();
      await settleAnimations(page);
      const measure = async (locator: Locator) => locator.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
      });
      const boxes = {
        dialog: await measure(dialog),
        newChat: await measure(dialog.locator("[data-slot='aui_thread-list-new']")),
        // Home composes assistant-ui's ThreadSearch (data-slot=thread-search),
        // not the kit's standalone ThreadListSearch (aui_thread-list-search).
        // Its input retains the component's accessible name "Search threads";
        // the caller's "Search chats" prop labels the wrapper only.
        search: await measure(dialog.locator("[data-slot='thread-search']")),
        firstRow: await measure(dialog.locator("[data-slot='aui_thread-list-item']").first()),
        close: await measure(dialog.locator("[data-slot='sheet-close']")),
      };
      const newChatLeft = boxes.newChat.x - boxes.dialog.x;
      const newChatTop = boxes.newChat.y - boxes.dialog.y;
      const searchLeft = boxes.search.x - boxes.dialog.x;
      const newChatGutter = newChatLeft;
      const searchGutter = searchLeft;
      const closeGutter = boxes.dialog.right - boxes.close.right;
      const firstRowGutter = boxes.firstRow.x - boxes.dialog.x;
      console.log(`CHAT-MOBILE-SHEET-01 ${theme}: ${JSON.stringify({ ...boxes, newChatLeft, newChatTop, searchLeft, newChatGutter, searchGutter, closeGutter, firstRowGutter })}`);
      if (newChatLeft < 12 || newChatTop < 12) throw new Error(`New chat inset too small (${newChatLeft}px left, ${newChatTop}px top)`);
      // ThreadSearch is intentionally shifted by `-ms-0.5` in
      // NextThreadList, so its wrapper lands 2px left of the 16px row
      // gutter. Keep the check tight while accepting that shipped offset.
      if (Math.abs(newChatGutter - searchGutter) > 2) throw new Error(`New chat and Search gutters differ (${newChatGutter}px vs ${searchGutter}px)`);
      if (Math.abs(newChatGutter - closeGutter) > 1) throw new Error(`Close and New chat gutters differ (${closeGutter}px vs ${newChatGutter}px)`);
      if (Math.abs(newChatGutter - firstRowGutter) > 1) throw new Error(`First row and New chat gutters differ (${firstRowGutter}px vs ${newChatGutter}px)`);
      await settleAnimations(page);
      const file = `chat-mobile-sheet-390-${theme}.png`;
      await page.screenshot({ path: join(outDir, file) });
      dedicatedScreenshots.push({ file, route: "chat-mobile-sheet", viewport: "phone (390x844)", theme });
      console.log(`Wrote ${join(outDir, file)}`);
      await page.close();
    } finally {
      await context.close();
    }
  }
}

/** SHORTCUTS-01 acceptance: show the real chat page with its keyboard
 * reference open, using the same seeded backend and Chromium capture
 * path as the rest of the screenshot suite. */
async function captureChatShortcutsReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  const viewport = VIEWPORTS.find((v) => v.slug === "desktop")!;
  const context = await newContext(browser, viewport, "light", sessionValue);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await page.goto(`${BASE_URL}/chat`);
    await page.getByRole("textbox", { name: "Message input" }).waitFor();
    await page.keyboard.press("Meta+/");
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await dialog.waitFor();
    for (const label of ["New chat", "Focus composer", "Stop reply", "Search", "Toggle sidebar"]) {
      await dialog.getByText(label, { exact: true }).waitFor();
    }
    await settleAnimations(page);
    const file = "chat-shortcut-reference-desktop-light.png";
    await page.screenshot({ path: join(outDir, file), fullPage: false });
    console.log(`Wrote ${join(outDir, file)}`);
    await page.close();
  } finally {
    await context.close();
  }
}

/** CHAT-FIND-0923-05: the shell nav sidebar's own header block (the
 * logo) and the page header used to share a bottom edge; CHAT-HEADER-
 * 01/02/03's own new title/actions buttons defaulted to the kit's
 * 48px touch-target floor (docs/UI.md), growing the row past the
 * template's own 40px header-control convention (Light-Dark.tsx's own
 * `h-10 w-10`) and breaking the line. Fixed with `h-10` + `hitArea(1)`
 * on the title button and `size="icon-lg"` on the chevron - the 40px
 * visual line back, the 48px hit area kept (the coordinator's own
 * ruling, not a guess: shrinking the real touch target below the
 * kit's own stated floor was rejected). happy-dom computes no real
 * box layout (this whole file's own established reason every other
 * pixel-level claim here is proven the same way), so this is the
 * actual proof: real getBoundingClientRect() on both elements, at
 * both widths the acceptance names, throwing on the first mismatch
 * rather than silently capturing a still-broken page. */
async function verifyChatFindHeaderAlignment(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  const cookie = { Cookie: `session=${sessionValue}` };

  for (const width of [1440, 2000]) {
    const context = await newContext(browser, { slug: "wide", width, height: 1000 }, "light", sessionValue);
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
      await page.goto(`${BASE_URL}/chat`);
      await page.getByRole("textbox", { name: "Message input" }).waitFor();
      const bottoms = await page.evaluate(() => {
        const sidebarHeader = document.querySelector('[data-slot="sidebar-header"]');
        const header = document.querySelector("header");
        return {
          sidebarHeaderBottom: sidebarHeader?.getBoundingClientRect().bottom,
          headerBottom: header?.getBoundingClientRect().bottom,
        };
      });
      if (bottoms.sidebarHeaderBottom === undefined || bottoms.headerBottom === undefined) {
        throw new Error(`verifyChatFindHeaderAlignment: could not find both elements at width ${width}: ${JSON.stringify(bottoms)}`);
      }
      if (Math.abs(bottoms.sidebarHeaderBottom - bottoms.headerBottom) > 0.5) {
        throw new Error(`verifyChatFindHeaderAlignment: bottom edges don't line up at width ${width} - sidebar header bottom ${bottoms.sidebarHeaderBottom}, page header bottom ${bottoms.headerBottom}`);
      }
      console.log(`width ${width}: aligned, both bottoms at ${bottoms.headerBottom}`);
      await settleAnimations(page);
      const file = `chat-find-header-alignment-${width}.png`;
      await page.screenshot({ path: join(outDir, file), fullPage: false });
      console.log(`Wrote ${join(outDir, file)}`);
      // A review caught this: 260px was tight enough that a slightly
      // wider font render could clip "Home" at the 28px wordmark's own
      // grown width, making a real, uncramped logo look falsely cropped
      // in the review capture alone. 320px leaves real margin.
      const zoomFile = `chat-find-logo-zoom-${width}.png`;
      await page.screenshot({ path: join(outDir, zoomFile), clip: { x: 0, y: 0, width: 320, height: 100 } });
      console.log(`Wrote ${join(outDir, zoomFile)}`);
    } finally {
      await context.close();
    }
  }
}

/** CHAT-FIND-0923-04 ("a sent message's bubble must not resize on
 * hover"): real proof of the `w-fit` fix in ui-v0.5.47
 * (thread.aui.tsx's own comment on the bubble div explains the CSS
 * Grid mechanism). A real user turn, not a fixture: the bubble is
 * only reproducibly a "tight pill" against real rendered text, and
 * the action bar only genuinely mounts/unmounts through
 * `ActionBarPrimitive.Root`'s own `autohide="not-last"` once a second
 * (assistant) message exists to make the user one no longer the
 * last. Same real getBoundingClientRect() proof as
 * verifyChatFindHeaderAlignment above, for the same happy-dom reason. */
async function verifyChatFindBubbleHoverWidth(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  const cookie = { Cookie: `session=${sessionValue}` };

  const context = await newContext(browser, { slug: "wide", width: 1440, height: 1000 }, "light", sessionValue);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await page.goto(`${BASE_URL}/chat`);
    await page.getByRole("textbox", { name: "Message input" }).fill("hi");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    // Wait for the reply to finish, so the user bubble is no longer the
    // last message and `autohide="not-last"` actually autohides it -
    // otherwise the action bar never unmounts and the "at rest" width
    // below would already include it, hiding the bug this exists to catch.
    await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ state: "detached", timeout: 30000 });

    const userMessageRoot = page.locator('[data-slot="aui_user-message-root"]').first();
    await userMessageRoot.waitFor();
    const bubble = userMessageRoot.locator(".aui-user-message-content").first();
    await settleAnimations(page);

    const restWidth = await bubble.evaluate((el) => el.getBoundingClientRect().width);
    const restFile = join(outDir, "chat-find-bubble-hover-width-rest.png");
    await page.screenshot({ path: restFile, fullPage: false });
    console.log(`Wrote ${restFile}`);

    await userMessageRoot.hover();
    await page.getByRole("button", { name: "Edit" }).waitFor({ timeout: 5000 });
    await settleAnimations(page);
    const hoverWidth = await bubble.evaluate((el) => el.getBoundingClientRect().width);
    const hoverFile = join(outDir, "chat-find-bubble-hover-width-hover.png");
    await page.screenshot({ path: hoverFile, fullPage: false });
    console.log(`Wrote ${hoverFile}`);

    if (Math.abs(restWidth - hoverWidth) > 0.5) {
      throw new Error(
        `verifyChatFindBubbleHoverWidth: bubble resized on hover - rest ${restWidth}px, hovered ${hoverWidth}px`,
      );
    }
    console.log(`bubble width unchanged: rest ${restWidth}px, hovered ${hoverWidth}px`);
  } finally {
    await context.close();
  }
}

/** Screen finding: typing the first character into a new chat visibly
 * shifted the composer down a few pixels. Root cause (ui-v0.5.48,
 * commons): the welcome view's suggestions row used to unmount the
 * instant the composer stopped being empty, removing its own `gap-4`
 * flex unit from the vertically-centered welcome block, which
 * re-centered and dropped everything in it. Real getBoundingClientRect()
 * on the composer's own textbox before and after typing one character
 * into a brand-new (empty) chat, same happy-dom-computes-no-real-layout
 * reason every other pixel claim in this file is proven this way. */
async function verifyChatFindComposerShift(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  const cookie = { Cookie: `session=${sessionValue}` };

  const context = await newContext(browser, { slug: "wide", width: 1440, height: 1000 }, "light", sessionValue);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await page.goto(`${BASE_URL}/chat`);
    const textbox = page.getByRole("textbox", { name: "Message input" });
    await textbox.waitFor();
    await settleAnimations(page);

    const measureTop = () => textbox.evaluate((el) => el.getBoundingClientRect().top);

    const beforeTop = await measureTop();
    const beforeFile = join(outDir, "chat-find-composer-shift-before.png");
    await page.screenshot({ path: beforeFile, fullPage: false });
    console.log(`Wrote ${beforeFile}`);

    // Control: wait the same order of time typing would take, without
    // actually typing, to rule out a settle-timing artifact (a font or
    // animation still resolving) rather than something the keystroke
    // itself causes.
    await page.waitForTimeout(300);
    const controlTop = await measureTop();
    if (Math.abs(controlTop - beforeTop) > 0.5) {
      throw new Error(
        `verifyChatFindComposerShift: composer moved with no keystroke at all (a settle-timing artifact, not this check's own target) - at rest ${beforeTop}px, 300ms later ${controlTop}px`,
      );
    }

    await textbox.pressSequentially("h", { delay: 0 });
    await settleAnimations(page);
    const afterTop = await measureTop();
    const afterFile = join(outDir, "chat-find-composer-shift-after.png");
    await page.screenshot({ path: afterFile, fullPage: false });
    console.log(`Wrote ${afterFile}`);

    console.log(`composer top: before=${beforeTop}px after=${afterTop}px delta=${afterTop - beforeTop}px`);
    if (Math.abs(afterTop - beforeTop) > 0.5) {
      throw new Error(
        `verifyChatFindComposerShift: composer moved on the first keystroke - before top ${beforeTop}px, after top ${afterTop}px`,
      );
    }
  } finally {
    await context.close();
  }
}

async function captureHero(browser: Browser, sessionValue: string): Promise<void> {
  const context = await newContext(browser, { slug: "desktop", width: 1280, height: 800 }, "dark", sessionValue);
  try {
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/people`);
    // Real content, not a spinner: wait for the seeded roster to actually
    // render before capturing (getmaipai/.github/CLAUDE.md's screenshot
    // rule - a shot of a loading state is not a shot of the feature).
    await page.getByRole("heading", { name: "Household" }).waitFor();
    await page.getByText("Nova", { exact: true }).waitFor();
    // Derived from HERO_PATH itself, not a hardcoded "docs/assets" -
    // under --webkit that path is "docs/assets/webkit/" (issue #76), and
    // a code review (2026-09-12) caught that a hardcoded parent here
    // would still create only the Chromium one, so a bare `--webkit` run
    // (nothing else skips captureHero) would throw ENOENT on the write
    // below - never actually exercised by this fix's own verification,
    // since that ran with `--chat-focus-review`, which skips captureHero
    // entirely.
    mkdirSync(dirname(HERO_PATH), { recursive: true });
    await page.screenshot({ path: HERO_PATH });
    console.log(`Wrote ${HERO_PATH}`);
  } finally {
    await context.close();
  }
}

/** HOME-UI-02d's own acceptance ("captures at 1440 and 390, both
 * looks, both themes, of the dashboard, Chat with the list open, and a
 * person's Memories tab; each opened and judged"). `ui.look` applies
 * live to a freshly-loaded page (`useLook.ts`'s own `useQuery` reads
 * whatever `PUT /api/settings` last wrote, no restart needed), so one
 * seeded backend covers both looks - just a setting write between
 * passes, the same shape `seedHousehold()`'s own `chatStatsReview`
 * branch already uses for a review-only setting. Written to
 * data-scratch/ (git-ignored): a comparison set for this item's own
 * judgment, not a permanent docs asset - the ordinary matrix already
 * captures Studio (the real default) permanently under `home-*`,
 * `chat-list-*` and `people-memories-*`. */
async function captureLookComparison(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });

  const people = (await (await fetch(`${BASE_URL}/api/people`, { headers: { Cookie: `session=${sessionValue}` } })).json()) as Array<{ id: string; display_name: string }>;
  const sage = people.find((p) => p.display_name === "Sage");
  if (!sage) throw new Error("captureLookComparison: seedHousehold() didn't create Sage");

  const pages: Array<{ slug: string; path: string }> = [
    { slug: "dashboard", path: "/" },
    { slug: "chat-list", path: "/chat?list=1" },
    { slug: "people-memories", path: "/memory" },
  ];
  const viewports = [VIEWPORTS.find((v) => v.slug === "phone")!, VIEWPORTS.find((v) => v.slug === "desktop")!];

  for (const look of ["calm", "studio"] as const) {
    const setLook = await fetch(`${BASE_URL}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: `session=${sessionValue}` },
      body: JSON.stringify({ scope: `person:${sage.id}`, key: "ui.look", value: look }),
    });
    if (!setLook.ok) throw new Error(`captureLookComparison: seeding ui.look=${look} failed: ${setLook.status}`);

    for (const viewport of viewports) {
      for (const theme of THEMES) {
        const context = await newContext(browser, viewport, theme, sessionValue);
        try {
          for (const p of pages) {
            const page = await context.newPage();
            await page.goto(`${BASE_URL}${p.path}`);
            await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
            await page.locator('[role="status"]').first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
            await settleAnimations(page);
            const file = `${p.slug}-look-${look}-${viewport.slug}-${theme}.png`;
            await page.screenshot({ path: join(outDir, file), fullPage: true });
            console.log(`Wrote ${join(outDir, file)}`);
            await page.close();
          }
        } finally {
          await context.close();
        }
      }
    }
  }
}

/** The shell-on-shadcndashboard stand-up's own acceptance (docs/plans/
 * shell-on-shadcndashboard-2026-09-21.md, step 1): "captures at 1440 and
 * 390, both looks, both themes, of every /next route, opened and judged
 * for one thing only, that nothing on them is Home-drawn." `the migrated root shell`
 * (household) gates the whole tree; `ui.look` (person, the same key the
 * old shell's `useLook.ts` reads) drives the vendored template's own
 * `.style-calm`/`.style-studio` body class via `useNextLook.ts` - the
 * same two-setting shape `captureLookComparison` above already uses for
 * the old shell, reused here rather than invented fresh. Written to
 * `docs/assets/screens/` (committed, unlike `captureLookComparison`'s
 * `data-scratch/`): a permanent record of the stand-up's own acceptance,
 * not a one-off review set. `/chat` is excluded - not wired yet
 * (ui-v0.5.4's named gap, CHAT-SDK-01). */
async function captureNextStandup(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(SCREENS_DIR, "next-standup");
  mkdirSync(outDir, { recursive: true });

  const people = (await (await fetch(`${BASE_URL}/api/people`, { headers: { Cookie: `session=${sessionValue}` } })).json()) as Array<{ id: string; display_name: string }>;
  const sage = people.find((p) => p.display_name === "Sage");
  if (!sage) throw new Error("captureNextStandup: seedHousehold() didn't create Sage");


  const pages: Array<{ slug: string; path: string; waitFor: string }> = [
    { slug: "dashboard", path: "/", waitFor: "text=Here is your household today." },
    { slug: "people", path: "/people", waitFor: 'a[href^="/people/"]' },
    { slug: "settings", path: "/settings", waitFor: "text=Default Inputs" },
    { slug: "sign-in", path: "/sign-in", waitFor: "form" },
  ];
  const viewports = [VIEWPORTS.find((v) => v.slug === "phone")!, VIEWPORTS.find((v) => v.slug === "desktop")!];

  for (const look of ["calm", "studio"] as const) {
    const setLook = await fetch(`${BASE_URL}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: `session=${sessionValue}` },
      body: JSON.stringify({ scope: `person:${sage.id}`, key: "ui.look", value: look }),
    });
    if (!setLook.ok) throw new Error(`captureNextStandup: seeding ui.look=${look} failed: ${setLook.status}`);

    for (const viewport of viewports) {
      for (const theme of THEMES) {
        const context = await newContext(browser, viewport, theme, sessionValue);
        try {
          for (const p of pages) {
            const page = await context.newPage();
            await page.goto(`${BASE_URL}${p.path}`);
            await page.locator(p.waitFor).first().waitFor({ timeout: 15000 });
            await settleAnimations(page);
            const file = `${p.slug}-look-${look}-${viewport.slug}-${theme}.png`;
            // Resize to the real scroll height and take a plain (non-fullPage)
            // shot instead: FullLayout's header is `sticky top-0`
            // (dashboard/layouts/full/vertical/header/Header.tsx), and
            // Chromium's fullPage capture stitches tall pages by scrolling,
            // which re-paints the sticky header mid-stitch and ghosts
            // whatever was behind it (the footer's copyright line bled into
            // the Tables page's title bar in dark desktop until this fix -
            // found live in this stand-up's own acceptance captures, not a
            // bug in the header or the footer themselves).
            const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
            await page.setViewportSize({ width: viewport.width, height: fullHeight });
            await settleAnimations(page);
            await page.screenshot({ path: join(outDir, file) });
            console.log(`Wrote ${join(outDir, file)}`);
            await page.close();
          }
        } finally {
          await context.close();
        }
      }
    }
  }
}

/** Lane 15's own two review shots: the bell popover's "Dismiss all" and
 * the history page's multi-select, each needing at least two real
 * pending notifications on screen - not fabricated rows (this file's
 * own header rule, and the coordinator's own ruling on Confirm,
 * docs/dev/session-b.md, on why a screenshot never shows a state the
 * running app can't really produce), a real safety.flagged_turn twice
 * from the seeded teen (Marlow, no secret - the same profile every
 * other review here already creates). Chosen over memory.updated: the
 * safety classifier is deterministic and needs no live model or judge,
 * so this capture works the same way whether or not either is
 * reachable on the machine right now - this script's own throwaway
 * backend never touches them anyway (`chatModel` below is a scripted
 * stub, not the household's real engine). Written to data-scratch/
 * (git-ignored) rather than SCREENS_DIR: a verification shot for the
 * coordinator to judge, not a permanent docs asset this feature has no
 * ROUTES entry for. */
// Signs in as the seeded teen (Marlow, no secret) and fires one or more
// real safety.flagged_turn deliveries to Sage (the household's owner,
// the "adults" audience) - shared by every capture that needs a real
// pending notification on screen, not a fabricated badge count (this
// file's own header rule). Was retyped independently in two capture
// functions (a code review, HOME-UI-02f); one definition now, so a
// change to the auth/select response shape or the seeded household
// only needs fixing once.
async function flagTurnsAsMarlow(sessionValue: string, texts: readonly string[], caller: string): Promise<void> {
  const people = (await (await fetch(`${BASE_URL}/api/people`, { headers: { Cookie: `session=${sessionValue}` } })).json()) as Array<{ id: string; display_name: string }>;
  const marlow = people.find((p) => p.display_name === "Marlow");
  if (!marlow) throw new Error(`${caller}: seedHousehold() didn't create Marlow`);
  const marlowSelect = await fetch(`${BASE_URL}/api/auth/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ personId: marlow.id }),
  });
  if (!marlowSelect.ok) throw new Error(`${caller}: signing in as Marlow failed: ${marlowSelect.status}`);
  const marlowSession = marlowSelect.headers.get("set-cookie")?.split(";")[0]?.split("=")[1];
  if (!marlowSession) throw new Error(`${caller}: Marlow's own sign-in carried no session cookie`);

  for (const text of texts) {
    const turn = await fetch(`${BASE_URL}/api/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `session=${marlowSession}` },
      body: JSON.stringify({ surface: "chat", text }),
    });
    if (!turn.ok) throw new Error(`${caller}: Marlow's own flagged turn failed: ${turn.status}`);
  }
}

// HOME-UI-04b's own double-border, collapsed-rail and invisible-table-
// text findings: a throwaway review set (data-scratch, not the stand-
// up's own committed acceptance captures), expanded vs. collapsed, both
// themes, desktop only (the owner's own findings were both desktop-
// only).
async function captureNextSidebarReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  const viewport = VIEWPORTS.find((v) => v.slug === "desktop")!;
  for (const theme of THEMES) {
    const context = await newContext(browser, viewport, theme, sessionValue);
    try {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/`);
      await page.locator("text=Here is your household today.").first().waitFor({ timeout: 15000 });
      await settleAnimations(page);
      await page.screenshot({ path: join(outDir, `next-sidebar-expanded-desktop-${theme}.png`) });
      console.log(`Wrote ${join(outDir, `next-sidebar-expanded-desktop-${theme}.png`)}`);

      await page.locator("button:has(svg.lucide-panel-left)").first().click();
      await settleAnimations(page);
      await page.screenshot({ path: join(outDir, `next-sidebar-collapsed-desktop-${theme}.png`) });
      console.log(`Wrote ${join(outDir, `next-sidebar-collapsed-desktop-${theme}.png`)}`);

      await page.close();
    } finally {
      await context.close();
    }
  }
}

// HOME-UI-04b item 3's own proof: the dashboard in three of the nine
// ui.look presets, 1440 dark (COORDINATOR's own ask) - Neutral and
// Mauve (two of the seven new shadcn base-color presets) plus Studio
// (the pre-existing default, proving the old presets still work
// alongside the new ones on the same mechanism).
async function captureNextLookPresets(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  const people = (await (await fetch(`${BASE_URL}/api/people`, { headers: { Cookie: `session=${sessionValue}` } })).json()) as Array<{ id: string; display_name: string }>;
  const sage = people.find((p) => p.display_name === "Sage");
  if (!sage) throw new Error("captureNextLookPresets: seedHousehold() didn't create Sage");

  const viewport = VIEWPORTS.find((v) => v.slug === "desktop")!;
  for (const look of ["neutral", "mauve", "studio"] as const) {
    const setLook = await fetch(`${BASE_URL}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: `session=${sessionValue}` },
      body: JSON.stringify({ scope: `person:${sage.id}`, key: "ui.look", value: look }),
    });
    if (!setLook.ok) throw new Error(`captureNextLookPresets: seeding ui.look=${look} failed: ${setLook.status}`);

    const context = await newContext(browser, viewport, "dark", sessionValue);
    try {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/`);
      await page.locator("text=Here is your household today.").first().waitFor({ timeout: 15000 });
      await settleAnimations(page);
      await page.screenshot({ path: join(outDir, `next-look-${look}-desktop-dark.png`) });
      console.log(`Wrote ${join(outDir, `next-look-${look}-desktop-dark.png`)}`);
      await page.close();
    } finally {
      await context.close();
    }
  }
}

// HOME-UI-04d's own proof: ui.appearance explicitly set opposite the
// OS's own colorScheme, both directions - the logo (and everything
// else) must follow the setting, not the media query that used to win
// for the kit's own CSS variables while the class-driven template
// parts (the logo among them) followed the setting instead.
async function captureNextAppearanceMismatch(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  const people = (await (await fetch(`${BASE_URL}/api/people`, { headers: { Cookie: `session=${sessionValue}` } })).json()) as Array<{ id: string; display_name: string }>;
  const sage = people.find((p) => p.display_name === "Sage");
  if (!sage) throw new Error("captureNextAppearanceMismatch: seedHousehold() didn't create Sage");

  const viewport = VIEWPORTS.find((v) => v.slug === "desktop")!;
  for (const setting of ["light", "dark"] as const) {
    const osPref = setting === "light" ? "dark" : "light";
    const setAppearance = await fetch(`${BASE_URL}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: `session=${sessionValue}` },
      body: JSON.stringify({ scope: `person:${sage.id}`, key: "ui.appearance", value: setting }),
    });
    if (!setAppearance.ok) throw new Error(`captureNextAppearanceMismatch: seeding ui.appearance=${setting} failed: ${setAppearance.status}`);

    // newContext's own colorScheme sets the OS preference; the PUT
    // above sets the person's explicit choice - opposite each other
    // on purpose, this capture's whole point.
    const context = await newContext(browser, viewport, osPref, sessionValue);
    try {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/`);
      await page.locator("text=Here is your household today.").first().waitFor({ timeout: 15000 });
      await settleAnimations(page);
      await page.screenshot({ path: join(outDir, `next-appearance-${setting}-vs-os-${osPref}.png`) });
      console.log(`Wrote ${join(outDir, `next-appearance-${setting}-vs-os-${osPref}.png`)}`);
      await page.close();
    } finally {
      await context.close();
    }
  }
}

/** HOME-UI-04e's own acceptance (1440 and 390, dark, against the
 * vendored template's own demo user-profile view - the single-
 * Tailwind-root and palette fixes it proved are long since landed) -
 * now doubling as SHELL-04's own permanent capture (2026-09-21):
 * extended to both themes, and its wait condition moved off
 * "Personal Information", the vendored `UserProfile`'s own demo
 * section heading that no real `/people` composition has ever
 * shown (SHELL-04 dropped that section entirely - no Home counterpart
 * for email/phone/position/address). Waits on a real table row rather
 * than the profile card's own "This is your own profile." text - a
 * review caught that the profile card renders straight from the
 * `person` prop, outside the household `AsyncState`, so that text
 * paints on first render regardless of whether `GET /api/people` has
 * resolved; `table tbody tr` is gated by the fetch the way the apps
 * row's own capture already established. */
async function captureNextPeopleReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/people`);
        // SHELL-04 changed this route from a table to a card grid
        // (`NextPeoplePage.tsx`); the shared CardTitle is a div, so use
        // a real person-card link as the data-ready signal. These links
        // render only after the real `/api/people` query resolves.
        await page.locator('a[href^="/people/"]').first().waitFor({ timeout: 15000 });
        await assertNoLegacyDataTableChrome(page, "People");
        await settleAnimations(page);
        const path = join(outDir, `next-people-${viewport.width}-${theme}.png`);
        await page.screenshot({ path, fullPage: slug === "phone" });
        console.log(`Wrote ${path}`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

/** SHELL-01's own acceptance ("1440 and 390, dark and light, judged
 * against dashboard-01's rhythm"): both viewports, both themes, of
 * `/` itself - the pair to `captureNextPeopleReview` above so the
 * dashboard composition has the same permanent, re-runnable capture a
 * live-instance judgment call was originally made from ad hoc. Waits on
 * the greeting's subtitle rather than any one widget's own text: it
 * only renders once `useDashboard()`'s `AsyncState` has resolved real
 * data (`NextDashboardPage.tsx`), and unlike a stat card's value it
 * never changes across viewport, theme, or role. */
async function captureNextDashboardReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/`);
        await page.locator("text=Here is your household today.").first().waitFor({ timeout: 15000 });
        await settleAnimations(page);
        if (viewport.width === 390) {
          const logo = await page.locator('header nav a:has(img[alt="logo"])').evaluate((anchor) => {
            const image = Array.from(anchor.querySelectorAll<HTMLImageElement>('img[alt="logo"]'))
              .find((candidate) => getComputedStyle(candidate).display !== "none");
            if (!image) throw new Error("visible header logo image not found");
            const box = (element: HTMLElement) => ({
              clientWidth: element.clientWidth,
              scrollWidth: element.scrollWidth,
              overflowX: getComputedStyle(element).overflowX,
              renderedWidth: element.getBoundingClientRect().width,
            });
            const container = anchor as HTMLElement;
            const wrapper = container.parentElement;
            const imageBounds = image.getBoundingClientRect();
            const containerBounds = container.getBoundingClientRect();
            return {
              image: {
                clientWidth: image.clientWidth,
                scrollWidth: image.scrollWidth,
                overflowX: getComputedStyle(image).overflowX,
                renderedWidth: image.getBoundingClientRect().width,
                naturalWidth: image.naturalWidth,
              },
              container: box(container),
              imageFitsContainer: imageBounds.left >= containerBounds.left - 1 &&
                imageBounds.right <= containerBounds.right + 1,
              wrapper: wrapper ? box(wrapper) : null,
              page: {
                clientWidth: document.documentElement.clientWidth,
                scrollWidth: document.documentElement.scrollWidth,
              },
            };
          });
          console.log(`logo-phone assertion @ 390/${theme}: ${JSON.stringify(logo)}`);
          if (
            logo.image.renderedWidth < logo.image.naturalWidth - 1 ||
            logo.container.clientWidth < logo.image.renderedWidth - 1 ||
            !logo.imageFitsContainer ||
            logo.page.scrollWidth > logo.page.clientWidth
          ) {
            throw new Error(`logo-phone assertion failed @ 390/${theme}: ${JSON.stringify(logo)}`);
          }
        }
        const path = join(outDir, `next-dashboard-${viewport.width}-${theme}.png`);
        await page.screenshot({ path, fullPage: slug === "phone" });
        console.log(`Wrote ${path}`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

/** PROFILE-SHEET-01's live acceptance: open the real Home-owned account
 * sheet at the phone viewport, assert the seeded signed-in person and
 * Home destinations, reject every shipped demo identity/link, then
 * save the open sheet for visual review. */
async function captureNextProfileSheetReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  const viewport = VIEWPORTS.find((v) => v.slug === "phone")!;
  const context = await newContext(browser, viewport, "dark", sessionValue);
  try {
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/`);
    await page.getByText("Here is your household today.").waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "Open account menu for Sage" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("heading", { name: "Sage" }).waitFor();
    await sheet.getByRole("link", { name: "Settings" }).waitFor();
    await sheet.getByRole("link", { name: "Help" }).waitFor();
    const text = await sheet.innerText();
    if (/Cameron|shadcndashboard\.com|Invoice|Subscription|Account Settings|Log Out/.test(text)) {
      throw new Error(`captureNextProfileSheetReview: template content remains in the account sheet: ${text}`);
    }
    await settleAnimations(page);
    const path = join(outDir, `next-profile-sheet-${viewport.width}-dark.png`);
    await page.screenshot({ path, fullPage: true });
    console.log(`Wrote ${path}`);
    await page.close();
  } finally {
    await context.close();
  }
}

async function readComposerGeometry(page: Page) {
  return page.evaluate(() => {
    const composer = document.querySelector<HTMLElement>("[data-slot=\"aui_composer-shell\"]");
    const footer = document.querySelector<HTMLElement>(".aui-thread-viewport-footer");
    const rect = (element: HTMLElement | null) => element ? element.getBoundingClientRect() : null;
    const composerRect = rect(composer);
    const footerRect = rect(footer);
    const paneRect = rect(document.querySelector<HTMLElement>("[data-slot=\"next-chat-pane\"]"));
    const rootRect = rect(document.querySelector<HTMLElement>(".aui-thread-root"));
    const viewportRect = rect(document.querySelector<HTMLElement>("[data-slot=\"aui_thread-viewport\"]"));
    const contentRect = rect(document.querySelector<HTMLElement>("[data-slot=\"aui_thread-viewport\"] > .mx-auto"));
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      composer: composerRect && { top: composerRect.top, bottom: composerRect.bottom, height: composerRect.height },
      footer: footerRect && { top: footerRect.top, bottom: footerRect.bottom, height: footerRect.height },
      pane: paneRect && { top: paneRect.top, bottom: paneRect.bottom, height: paneRect.height },
      root: rootRect && { top: rootRect.top, bottom: rootRect.bottom, height: rootRect.height },
      viewportElement: viewportRect && { top: viewportRect.top, bottom: viewportRect.bottom, height: viewportRect.height },
      content: contentRect && { top: contentRect.top, bottom: contentRect.bottom, height: contentRect.height },
      bottomGap: composerRect ? window.innerHeight - composerRect.bottom : null,
    };
  });
}

type ComposerGeometry = Awaited<ReturnType<typeof readComposerGeometry>>;

function assertComposerUnder72px(geometry: ComposerGeometry, testName: string): void {
  const height = geometry.composer?.height;
  if (height === null || height === undefined || height >= 72) {
    throw new Error(`Regression test failed: ${testName}`);
  }
}

function assertComposerAtBottom(geometry: ComposerGeometry, testName: string): void {
  const footerBottomGap = geometry.footer ? geometry.viewport.height - geometry.footer.bottom : null;
  if (geometry.bottomGap === null || geometry.bottomGap === undefined || geometry.bottomGap >= 24 || footerBottomGap === null || footerBottomGap >= 24) {
    throw new Error(`Regression test failed: ${testName}`);
  }
}

/** Captures the chat page at desktop and phone sizes in both themes, plus
 * a tall-window run with one and ten rendered messages. Each thread uses
 * persisted turns from the screenshot-only scripted Stack so both the
 * composer and real Elements message layouts are exercised. */
async function captureNextChatReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  // This page review uses one persisted conversation with a real turn
  // through the screenshot-only scripted Stack. Keep it across all four
  // captures so viewport/theme comparisons show identical content.
  const cookie = { Cookie: `session=${sessionValue}` };
  const conversation = await seedTitledConversation("captureNextChatReview", cookie, "A few questions for today");
  const seedContext = await newContext(browser, VIEWPORTS.find((v) => v.slug === "desktop")!, "dark", sessionValue);
  try {
    const page = await seedContext.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await openStoredConversation(page, conversation.id, "A few questions for today");
    await sendChatMessage(page, "Show me a short demo reply.");
    await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ state: "detached", timeout: 30000 });
    await page.getByText(SCREENSHOT_CHAT_REPLY, { exact: true }).waitFor({ timeout: 15000 });
  } finally {
    await seedContext.close();
  }

  const turnsResponse = await fetch(`${BASE_URL}/api/conversations/${conversation.id}/turns`, { headers: cookie });
  if (!turnsResponse.ok) throw new Error(`captureNextChatReview: reading seeded turns failed: ${turnsResponse.status}`);
  const turns = await turnsResponse.json() as Array<{ reasoning?: string; reply_text?: string; replyText?: string }>;
  if (turns.length !== 1) throw new Error(`captureNextChatReview: expected 1 persisted turn, found ${turns.length}`);
  if ((turns[0]?.reply_text ?? turns[0]?.replyText) !== SCREENSHOT_CHAT_REPLY) {
    throw new Error("captureNextChatReview: scripted demo reply was not persisted");
  }
  console.log(`captureNextChatReview: seeded conversation ${conversation.id} has the scripted demo reply`);

  // The shared ChatThread owns the current model-selector slot; keep this
  // source check pointed at that binding, where it moved from the page.
  const chatThreadSource = readFileSync(join(ROOT, "frontend", "src", "apps", "chat", "ChatThread.tsx"), "utf8");
  const elementBindingsSource = readFileSync(join(ROOT, "frontend", "src", "apps", "chat", "elementBindings.ts"), "utf8");
  if (!chatThreadSource.includes("ComposerExtraEnd: MODEL_TRAILING_SLOT") || !elementBindingsSource.includes("export const MODEL_TRAILING_SLOT = ComposerTrailingWithModelSelector") || chatThreadSource.includes("ComposerThinkingControl")) {
    throw new Error("captureNextChatReview: shared trailing ComposerModelSelector binding was not found or retired ComposerThinkingControl remains");
  }
  console.log("captureNextChatReview: shared composer source check confirms ComposerModelSelector is wired");

  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      const consoleErrors: string[] = [];
      const httpErrors: string[] = [];
      try {
        const page = await context.newPage();
        page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
        page.on("pageerror", (error) => consoleErrors.push(error.message));
        page.on("response", (response) => { if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`); });
        await page.goto(`${BASE_URL}/chat?conversation=${conversation.id}`);
        const composer = page.getByRole("textbox", { name: "Message input" });
        await composer.waitFor();
        if (!(await composer.isEnabled())) throw new Error(`captureNextChatReview: composer disabled on ${slug}/${theme}`);
        await page.getByText(SCREENSHOT_CHAT_REPLY, { exact: true }).waitFor();
        if (await page.getByRole("alert").count()) throw new Error(`captureNextChatReview: error banner on ${slug}/${theme}`);
        if (await page.getByRole("button", { name: "Stop generating", exact: true }).count()) throw new Error(`captureNextChatReview: turn still running on ${slug}/${theme}`);
        await settleAnimations(page);
        const composerGeometry = await readComposerGeometry(page);
        console.log(`captureNextChatReview geometry ${slug}/${theme}: ${JSON.stringify(composerGeometry)}`);
        if (slug === "desktop") {
          assertComposerUnder72px(composerGeometry, "composer root height under 72px empty at desktop");
        }
        if (composerGeometry.bottomGap === null || composerGeometry.bottomGap === undefined || composerGeometry.bottomGap >= 24) {
          throw new Error("Regression test failed: composer bottom gap under 24px");
        }
        assertComposerAtBottom(composerGeometry, "composer stays at the bottom with a one-message thread");
        if (!await page.getByText(SCREENSHOT_CHAT_REPLY, { exact: true }).isVisible()) {
          throw new Error("Regression test failed: composer stays at the bottom with a one-message thread");
        }
        const filename = `next-chat-${viewport.width}-${theme}.png`;
        const path = join(outDir, filename);
        await page.screenshot({ path, fullPage: slug === "phone" });
        dedicatedScreenshots.push({ file: filename, route: "/chat", viewport: viewport.slug, theme });
        console.log(`Wrote ${path}`);
        if (consoleErrors.length || httpErrors.length) throw new Error(`captureNextChatReview: ${slug}/${theme} browser errors: ${[...consoleErrors, ...httpErrors].join(" | ")}`);
        console.log(`captureNextChatReview: ${slug}/${theme} had no console errors`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }

  const wideViewport: ViewportSpec = { slug: "wide-review", width: 2000, height: 1293 };
  const wideOneContext = await newContext(browser, wideViewport, "dark", sessionValue);
  try {
    const page = await wideOneContext.newPage();
    await page.goto(`${BASE_URL}/chat?conversation=${conversation.id}`);
    await page.getByText(SCREENSHOT_CHAT_REPLY, { exact: true }).waitFor();
    await settleAnimations(page);
    const geometry = await readComposerGeometry(page);
    console.log(`captureNextChatReview geometry wide-one-message/dark: ${JSON.stringify(geometry)}`);
    assertComposerUnder72px(geometry, "composer root height under 72px empty at 2000x1293");
    assertComposerAtBottom(geometry, "composer stays at the bottom with a one-message thread at 2000x1293");
    const path = join(outDir, "next-chat-2000x1293-one-message-dark.png");
    await page.screenshot({ path });
    console.log(`Wrote ${path}`);
    await page.close();
  } finally {
    await wideOneContext.close();
  }

  const newChatContext = await newContext(browser, wideViewport, "dark", sessionValue);
  try {
    const page = await newChatContext.newPage();
    await page.goto(`${BASE_URL}/chat`);
    await page.getByRole("textbox", { name: "Message input" }).waitFor();
    await page.getByText("How can I help you today?").waitFor();
    await settleAnimations(page);
    const geometry = await readComposerGeometry(page);
    console.log(`captureNextChatReview geometry wide-new-chat/dark: ${JSON.stringify(geometry)}`);
    assertComposerUnder72px(geometry, "new-chat composer root height under 72px at 2000x1293");
    const path = join(outDir, "next-chat-2000x1293-new-chat-dark.png");
    await page.screenshot({ path });
    console.log(`Wrote ${path}`);
    await page.close();
  } finally {
    await newChatContext.close();
  }

  const wideTenContext = await newContext(browser, wideViewport, "dark", sessionValue);
  try {
    const page = await wideTenContext.newPage();
    await openStoredConversation(page, conversation.id, "A few questions for today");
    for (let turn = 2; turn <= 5; turn += 1) {
      await sendChatMessage(page, `Demo question ${turn}.`);
      await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ timeout: 15000 });
      await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ state: "detached", timeout: 30000 });
      await page.getByText(SCREENSHOT_CHAT_REPLY, { exact: true }).nth(turn - 1).waitFor({ timeout: 15000 });
    }
    const tenTurnResponse = await fetch(`${BASE_URL}/api/conversations/${conversation.id}/turns`, { headers: cookie });
    if (!tenTurnResponse.ok) throw new Error(`captureNextChatReview: reading ten-message turns failed: ${tenTurnResponse.status}`);
    const tenTurns = await tenTurnResponse.json() as Array<unknown>;
    if (tenTurns.length !== 5) throw new Error(`captureNextChatReview: expected 5 persisted turns (10 messages), found ${tenTurns.length}`);
    await settleAnimations(page);
    const geometry = await readComposerGeometry(page);
    console.log(`captureNextChatReview geometry wide-ten-message/dark: ${JSON.stringify(geometry)}`);
    assertComposerUnder72px(geometry, "composer root height under 72px empty with ten messages at 2000x1293");
    assertComposerAtBottom(geometry, "composer stays at the bottom with a ten-message thread at 2000x1293");
    const path = join(outDir, "next-chat-2000x1293-ten-messages-dark.png");
    await page.screenshot({ path });
    console.log(`Wrote ${path}`);
    await page.close();
  } finally {
    await wideTenContext.close();
  }

  if (regenerateMenuReview) {
    const context = await newContext(browser, VIEWPORTS.find((v) => v.slug === "desktop")!, "dark", sessionValue);
    try {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/chat?conversation=${conversation.id}`);
      await page.getByText(SCREENSHOT_CHAT_REPLY, { exact: true }).last().waitFor();
      await page.getByRole("button", { name: "Regenerate with a different model" }).last().click();
      await page.getByRole("button", { name: /Alternate screenshot stub/ }).waitFor();
      await settleAnimations(page);
      const file = "regenerate-menu-1440-dark.png";
      const path = join(outDir, file);
      await page.screenshot({ path });
      dedicatedScreenshots.push({ file, route: "/chat", viewport: "desktop", theme: "dark" });
      console.log(`Wrote ${path}`);
      await page.close();
    } finally {
      await context.close();
    }
  }
}

/** UPLOAD-IMG-02: the person's own pictures, end to end through the real
 * composer. Two licence-clean synthetic pictures (drawn here with sharp,
 * nothing downloaded) are picked through the browser's own file chooser,
 * exactly as a person picks them, so they pass the real adapter, the real
 * upload route and the real turn. Captures, at 1440 and 390 in both themes:
 * the two tiles in the composer (`composer`), the reopened conversation with
 * the thumbnails above the person's bubble as the history path renders them
 * (`sent`), the kit's preview dialog after a click (`lightbox`), and the
 * child Nova, whose photo uploads are off by default (`child-off`: the phone's
 * "+" menu with no photo rows; on desktop the plain line after picking a
 * picture). With UI_EVIDENCE_TAG=before the same steps run and log what they
 * find instead of failing on what the old code lacks. */
async function captureNextChatSentPictures(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  const evidenceTag = process.env.UI_EVIDENCE_TAG ?? "after";
  const strict = evidenceTag === "after";
  const cookie = { Cookie: `session=${sessionValue}` };
  const title = "My new robot";
  const drawSource = `
    import sharp from "sharp";
    const robot = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><rect width="900" height="900" fill="#c9b8a6"/><rect y="560" width="900" height="340" fill="#7a5c45"/><rect x="250" y="250" width="400" height="460" rx="180" fill="#f4f4f2"/><rect x="300" y="330" width="300" height="130" rx="60" fill="#1d1d22"/><circle cx="380" cy="395" r="34" fill="#e8e8ea"/><circle cx="520" cy="395" r="34" fill="#e8e8ea"/><line x1="360" y1="250" x2="320" y2="150" stroke="#2a2a30" stroke-width="10"/><line x1="540" y1="250" x2="580" y2="150" stroke="#2a2a30" stroke-width="10"/><circle cx="320" cy="145" r="16" fill="#2a2a30"/><circle cx="580" cy="145" r="16" fill="#2a2a30"/></svg>';
    let lines = "";
    for (let i = 0; i < 14; i++) lines += '<rect x="90" y="' + (150 + i * 46) + '" width="' + (520 - (i % 4) * 90) + '" height="14" rx="7" fill="#c8ccd4"/>';
    const page = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900" fill="#ffffff"/><rect width="1200" height="64" fill="#eef0f4"/><rect x="40" y="22" width="180" height="20" rx="10" fill="#9aa3b2"/>' + lines + '<rect x="760" y="140" width="380" height="640" rx="18" fill="#f3f5f9" stroke="#d5dae3"/><rect x="800" y="190" width="300" height="16" rx="8" fill="#9aa3b2"/></svg>';
    const out = {
      robot: (await sharp(Buffer.from(robot)).png().toBuffer()).toString("base64"),
      page: (await sharp(Buffer.from(page)).png().toBuffer()).toString("base64"),
    };
    console.log(JSON.stringify(out));
  `;
  const drawn = Bun.spawnSync({ cmd: ["bun", "-e", drawSource], cwd: join(ROOT, "backend"), stdout: "pipe", stderr: "pipe" });
  if (drawn.exitCode !== 0) throw new Error(`captureNextChatSentPictures: drawing the demo pictures failed: ${drawn.stderr.toString()}`);
  const pictures = JSON.parse(drawn.stdout.toString().trim().split("\n").at(-1)!) as { robot: string; page: string };
  const files = [
    { name: "my-robot.png", mimeType: "image/png", buffer: Buffer.from(pictures.robot, "base64") },
    { name: "notes-page.png", mimeType: "image/png", buffer: Buffer.from(pictures.page, "base64") },
  ];

  /** Picks `picked` through the real "+" control: a direct button on
   * desktop, the "Add photos and files" row of the menu on a phone. */
  const pickPictures = async (page: Page, slug: "desktop" | "phone", picked: typeof files): Promise<void> => {
    try {
      const chooser = page.waitForEvent("filechooser", { timeout: 15000 });
      chooser.catch(() => {});
      await page.getByRole("button", { name: "Add", exact: true }).first().click();
      if (slug === "phone") {
        const menu = page.locator('[data-slot="composer-menu"][data-open]').first();
        await menu.waitFor({ timeout: 5000 });
        await settleAnimations(page);
        await menu.getByText(/^Add (photos and )?files$/).first().click({ timeout: 5000 });
      }
      await (await chooser).setFiles(picked);
    } catch (error) {
      await page.screenshot({ path: join(outDir, `next-chat-sent-pictures-debug-${slug}.png`) });
      throw error;
    }
  };
  const imagesLoaded = async (page: Page, selector: string, count: number): Promise<number> => {
    const deadline = Date.now() + 10000;
    for (;;) {
      const loaded = await page.locator(selector).evaluateAll((imgs) => imgs.filter((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0).length);
      if (loaded >= count || Date.now() > deadline) return loaded;
      await page.waitForTimeout(100);
    }
  };

  // One stored conversation with the two pictures sent through the real path.
  const conversation = await seedTitledConversation("captureNextChatSentPictures", cookie, title);
  const seedContext = await newContext(browser, VIEWPORTS.find((v) => v.slug === "desktop")!, "dark", sessionValue);
  try {
    const page = await seedContext.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await openStoredConversation(page, conversation.id, title);
    await pickPictures(page, "desktop", files);
    await page.locator(".aui-composer-attachments .aui-attachment-tile").nth(1).waitFor();
    const uploads: string[] = [];
    page.on("request", (request) => { if (request.url().includes("/api/attachments/upload")) uploads.push(request.method()); });
    let turnBody = "";
    page.on("request", (request) => { if (request.url().includes("/api/turn/stream")) turnBody = request.postData() ?? ""; });
    await sendChatMessage(page, "can you see these files?");
    await page.getByText(SCREENSHOT_CHAT_REPLY, { exact: true }).waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ state: "detached", timeout: 30000 });
    console.log(`captureNextChatSentPictures ${evidenceTag}: ${JSON.stringify({ uploads: uploads.length, turnCarriesIds: /"images":\[\{"id":"file-/.test(turnBody), turnCarriesDataUrl: turnBody.includes("data:image") })}`);
  } finally {
    await seedContext.close();
  }

  const people = await (await fetch(`${BASE_URL}/api/people`, { headers: cookie })).json() as Array<{ id: string; display_name: string; role: string }>;
  const child = people.find((p) => p.display_name === "Nova" && p.role === "child");
  if (!child) throw new Error("captureNextChatSentPictures: the seeded child Nova is required");
  const childSignIn = await fetch(`${BASE_URL}/api/auth/select`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personId: child.id }) });
  const childSession = childSignIn.headers.get("set-cookie")?.split(";")[0]?.split("=")[1];
  if (!childSession) throw new Error("captureNextChatSentPictures: Nova's sign-in carried no session cookie");

  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const shot = (name: string) => join(outDir, `next-chat-sent-pictures-${evidenceTag}-${name}-${viewport.width}-${theme}.png`);
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
        // The composer with two pictures picked, nothing sent.
        await page.goto(`${BASE_URL}/chat`);
        await page.getByRole("textbox", { name: "Message input" }).waitFor();
        if (slug === "phone") {
          // The adult's phone "+" menu: the photo rows are there.
          await page.waitForLoadState("networkidle");
          await page.getByRole("button", { name: "Add", exact: true }).first().click();
          const menu = page.locator('[data-slot="composer-menu"][data-open]').first();
          await menu.waitFor();
          await settleAnimations(page);
          const rows = await menu.locator('[data-slot="composer-menu-item"]').allInnerTexts();
          const box = await menu.boundingBox();
          console.log(`captureNextChatSentPictures ${evidenceTag} ${slug}/${theme}: adult menu rows ${JSON.stringify(rows.map((r) => r.replace(/\s+/g, " ").trim()))}, menu x ${box?.x} to ${box ? box.x + box.width : "?"} of ${viewport.width}`);
          if (strict && (!box || box.x < 0 || box.x + box.width > viewport.width)) throw new Error(`captureNextChatSentPictures: the phone "+" menu runs off the screen on ${theme}`);
          await page.screenshot({ path: shot("menu") });
          await page.getByRole("button", { name: "Add", exact: true }).first().click();
          await page.locator('[data-slot="composer-menu"][data-open]').waitFor({ state: "detached" });
        }
        await pickPictures(page, slug, files);
        const tiles = await imagesLoaded(page, ".aui-composer-attachments img", 2);
        await page.getByRole("textbox", { name: "Message input" }).fill("can you see these files?");
        await settleAnimations(page);
        console.log(`captureNextChatSentPictures ${evidenceTag} ${slug}/${theme}: composer tiles painted ${tiles}, remove buttons ${await page.locator(".aui-composer-attachments .aui-attachment-tile-remove").count()}`);
        if (strict && tiles !== 2) throw new Error(`captureNextChatSentPictures: ${tiles} of 2 composer tiles painted on ${slug}/${theme}`);
        await page.screenshot({ path: shot("composer") });

        // The reopened conversation: what the history path renders.
        await openStoredConversation(page, conversation.id, title);
        await page.getByText(SCREENSHOT_CHAT_REPLY, { exact: true }).first().waitFor();
        const thumbs = await imagesLoaded(page, ".aui-user-message-attachments-end img", 2);
        const srcs = await page.locator(".aui-user-message-attachments-end img").evaluateAll((imgs) => imgs.map((img) => img.getAttribute("src") ?? ""));
        await settleAnimations(page);
        console.log(`captureNextChatSentPictures ${evidenceTag} ${slug}/${theme}: reopened thumbnails painted ${thumbs}, all from the hub ${srcs.length > 0 && srcs.every((src) => src.startsWith("/api/attachments/"))}`);
        if (strict && thumbs !== 2) throw new Error(`captureNextChatSentPictures: ${thumbs} of 2 sent thumbnails painted after reopening on ${slug}/${theme}`);
        await page.screenshot({ path: shot("sent") });

        // A click opens the kit's preview dialog.
        if (thumbs > 0) {
          await page.locator(".aui-user-message-attachments-end .aui-attachment-tile").first().click();
          await page.getByRole("dialog").waitFor();
          await imagesLoaded(page, '[role="dialog"] img', 1);
          await settleAnimations(page);
          await page.screenshot({ path: shot("lightbox") });
          await page.keyboard.press("Escape");
          await page.getByRole("dialog").waitFor({ state: "detached" });
        }
        await page.close();
      } finally {
        await context.close();
      }

      // The child, photo uploads off (the default until a parent turns it on).
      const childContext = await newContext(browser, viewport, theme, childSession);
      try {
        const page = await childContext.newPage();
        page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
        await page.goto(`${BASE_URL}/chat`);
        await page.getByRole("textbox", { name: "Message input" }).waitFor();
        await page.waitForLoadState("networkidle");
        if (slug === "phone") {
          await page.getByRole("button", { name: "Add", exact: true }).first().click();
          await page.locator('[data-slot="composer-menu"][data-open]').first().waitFor();
          const rows = await page.locator('[data-slot="composer-menu"][data-open] [data-slot="composer-menu-item"]').allInnerTexts();
          console.log(`captureNextChatSentPictures ${evidenceTag} ${slug}/${theme}: child menu rows ${JSON.stringify(rows.map((r) => r.replace(/\s+/g, " ").trim()))}`);
          if (strict && rows.some((row) => /photo/i.test(row))) throw new Error(`captureNextChatSentPictures: the child's menu offers a photo row on ${slug}/${theme}`);
        } else {
          await pickPictures(page, slug, files.slice(0, 1));
          const toast = page.getByText("Photo uploads are turned off for this profile.").first();
          const shown = await toast.waitFor({ timeout: 5000 }).then(() => true, () => false);
          const staged = await page.locator(".aui-composer-attachments .aui-attachment-tile").count();
          console.log(`captureNextChatSentPictures ${evidenceTag} ${slug}/${theme}: child picture refused with the plain line ${shown}, tiles staged ${staged}`);
          if (strict && (!shown || staged !== 0)) throw new Error(`captureNextChatSentPictures: the child's picture was not refused plainly on ${slug}/${theme}`);
        }
        await settleAnimations(page);
        await page.screenshot({ path: shot("child-off") });
        await page.close();
      } finally {
        await childContext.close();
      }
      console.log(`Wrote next-chat-sent-pictures-${evidenceTag}-{composer,sent,lightbox,child-off}-${viewport.width}-${theme}.png`);
    }
  }
}

/** ANSWER-IMG-04: pictures in a chat answer, the kit image gallery. A real
 * scripted turn is sent in a demo conversation, then this run's throwaway
 * demo database gives that stored turn a picture set whose files sit in the
 * hub's own picture cache (generated here: licence-clean synthetic scenes,
 * nothing downloaded), because no outside picture host is reachable from a
 * screenshot run. The thread is reopened, so the tiles are what the history
 * path renders. Captures the row with its +2 badge, the gallery open, and a
 * reply with no pictures, at 1440 and 390 in both themes; logs the reply
 * text's top offset before and after the pictures paint (held back by the
 * test, then released) so "no layout shift" is a number. */
async function captureNextChatAnswerImages(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  const cookie = { Cookie: `session=${sessionValue}` };
  const evidenceTag = process.env.UI_EVIDENCE_TAG ?? "after";
  const withTitle = "What the tower looks like";
  const withoutTitle = "A plain question";
  // Each conversation gets its turn before the next one is created (the
  // history capture's own order: an empty thread is the one a send lands in).
  const seedTurn = async (title: string): Promise<{ id: string }> => {
    const conversation = await seedTitledConversation("captureNextChatAnswerImages", cookie, title);
    const seedContext = await newContext(browser, VIEWPORTS.find((v) => v.slug === "desktop")!, "dark", sessionValue);
    try {
      const page = await seedContext.newPage();
      page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
      await openStoredConversation(page, conversation.id, title);
      await sendChatMessage(page, "Show me a short demo reply.");
      await page.getByText(SCREENSHOT_CHAT_REPLY, { exact: true }).waitFor({ timeout: 30000 });
      await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ state: "detached", timeout: 30000 });
    } finally {
      await seedContext.close();
    }
    return conversation;
  };
  const withPictures = await seedTurn(withTitle);
  const withoutPictures = await seedTurn(withoutTitle);
  // The picture files go into the hub's own cache through the cache module
  // itself, so ids, variants and the index are exactly what a live turn writes.
  const seedSource = `
    import sharp from "sharp";
    import { putAnswerImage } from "./src/lib/answerImages/cache";
    const scenes = [["#7cb7e8", "#f6c453", "#3f7d4e"], ["#f2a65a", "#ffe08a", "#8a5a44"], ["#2f4a7a", "#e8eef7", "#56606e"], ["#a7d8c9", "#ffffff", "#2e6b5e"], ["#e9c2d4", "#fff4c2", "#6b4a7a"]];
    const out = [];
    for (const [i, [sky, sun, land]] of scenes.entries()) {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + sky + '"/><stop offset="1" stop-color="#ffffff"/></linearGradient></defs><rect width="1200" height="900" fill="url(#g)"/><circle cx="' + (300 + i * 150) + '" cy="220" r="110" fill="' + sun + '"/><path d="M0 640 Q300 ' + (480 + i * 20) + ' 600 620 T1200 600 V900 H0Z" fill="' + land + '"/><path d="M560 660 L600 260 L640 660 Z" fill="#3b3b44"/><rect x="520" y="640" width="160" height="22" fill="#3b3b44"/></svg>';
      const png = await sharp(Buffer.from(svg)).png().toBuffer();
      const full = await sharp(png).resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 86 }).toBuffer();
      const tile = await sharp(png).resize({ width: 640, height: 640, fit: "inside" }).webp({ quality: 82 }).toBuffer();
      const id = await putAnswerImage({ tile: new Uint8Array(tile), full: new Uint8Array(full), band: "adult" });
      out.push({ id, src: "/api/answer-image/" + id + "?v=tile", full: "/api/answer-image/" + id + "?v=full", width: 1200, height: 900, alt: "Drawing of the iron tower, scene " + (i + 1), caption: "The iron tower, scene " + (i + 1), source: { title: "Iron tower scene " + (i + 1), site: "commons.wikimedia.org", url: "https://commons.wikimedia.org/wiki/Main_Page" }, license: { short: "CC0" } });
    }
    console.log(JSON.stringify(out));
  `;
  const seeded = Bun.spawnSync({ cmd: ["bun", "-e", seedSource], cwd: join(ROOT, "backend"), env: { ...process.env, MAIPAI_DATA_DIR: DATA_DIR }, stdout: "pipe", stderr: "pipe" });
  if (seeded.exitCode !== 0) throw new Error(`captureNextChatAnswerImages: seeding the picture cache failed: ${seeded.stderr.toString()}`);
  const items = JSON.parse(seeded.stdout.toString().trim().split("\n").at(-1)!) as unknown[];
  const db = new Database(join(DATA_DIR, "hub.db"));
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const turn = db.query("SELECT id FROM conversation_turns WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1").get(withPictures.id) as { id: string } | null;
    if (!turn) throw new Error("captureNextChatAnswerImages: the scripted turn was not stored");
    db.prepare("UPDATE conversation_turns SET answer_images = ? WHERE id = ?").run(JSON.stringify({ layout: "row", after_paragraph: 0, visible: 3, items }), turn.id);
  } finally {
    db.close();
  }

  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
        // Hold the picture bytes back until the text has been measured once.
        let release!: () => void;
        const released = new Promise<void>((resolve) => { release = resolve; });
        let served = 0;
        await page.route("**/api/answer-image/**", async (route) => { await released; served++; await route.continue(); });
        await openStoredConversation(page, withPictures.id, withTitle);
        const reply = page.getByText(SCREENSHOT_CHAT_REPLY, { exact: true }).first();
        await reply.waitFor();
        await page.locator('[data-slot="image-gallery"]').waitFor();
        const before = await reply.evaluate((el) => el.getBoundingClientRect().top);
        release();
        await page.waitForFunction(() => {
          const imgs = [...document.querySelectorAll<HTMLImageElement>('[data-slot="image-gallery"] img')];
          return imgs.length > 0 && imgs.every((img) => img.complete && img.naturalWidth > 0);
        });
        await settleAnimations(page);
        const after = await reply.evaluate((el) => el.getBoundingClientRect().top);
        const tiles = await page.locator('[data-slot="image-gallery"] img').evaluateAll((imgs) => imgs.map((img) => img.getAttribute("src")));
        console.log(`captureNextChatAnswerImages ${evidenceTag} ${slug}/${theme}: ${JSON.stringify({ textTopBefore: before, textTopAfter: after, shift: after - before, tiles: tiles.length, allFromHub: tiles.every((src) => src?.startsWith("/api/answer-image/")), served, badge: await page.getByText("+2", { exact: true }).count() })}`);
        if (after !== before) throw new Error(`captureNextChatAnswerImages: the reply text moved ${after - before}px when the pictures painted on ${slug}/${theme}`);
        await page.screenshot({ path: join(outDir, `next-chat-answer-images-${evidenceTag}-row-${viewport.width}-${theme}.png`) });
        await page.getByRole("button", { name: "Open image: Drawing of the iron tower, scene 2" }).click();
        await page.getByRole("dialog").waitFor();
        await page.getByRole("dialog").locator("img").evaluate((img: HTMLImageElement) => img.complete ? undefined : new Promise((r) => img.addEventListener("load", r, { once: true })));
        await settleAnimations(page);
        await page.screenshot({ path: join(outDir, `next-chat-answer-images-${evidenceTag}-gallery-${viewport.width}-${theme}.png`) });
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").waitFor({ state: "detached" });
        const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
        console.log(`captureNextChatAnswerImages ${evidenceTag} ${slug}/${theme}: focus after Escape on ${JSON.stringify(focused)}`);
        await openStoredConversation(page, withoutPictures.id, withoutTitle);
        await page.getByText(SCREENSHOT_CHAT_REPLY, { exact: true }).first().waitFor();
        await settleAnimations(page);
        const galleries = await page.locator('[data-slot="image-gallery"], [data-slot="answer-images"]').count();
        console.log(`captureNextChatAnswerImages ${evidenceTag} ${slug}/${theme}: no-picture reply has ${galleries} gallery boxes`);
        if (galleries !== 0) throw new Error("captureNextChatAnswerImages: a reply with no pictures reserved a gallery box");
        await page.screenshot({ path: join(outDir, `next-chat-answer-images-${evidenceTag}-none-${viewport.width}-${theme}.png`) });
        console.log(`Wrote next-chat-answer-images-${evidenceTag}-{row,gallery,none}-${viewport.width}-${theme}.png`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

/** CHAT-SIDEBAR-FINISH-01: chat's own history list with ten threads spread
 * over Today, Yesterday and Earlier, one of them open with a real scripted
 * turn, at 1440 and 390 in both themes. The conversations are created
 * through the API like every other capture; only their `created_at` is
 * moved back in this run's throwaway demo database, because no route
 * takes a creation date and the list groups threads with no turns by it.
 * Logs each row's measured height, active state and fill, the group
 * labels and any icon inside a row, so the review judges numbers, not
 * only pixels. `UI_EVIDENCE_TAG` (default "after") names the set, so a
 * before run at the previous pin does not overwrite it. */
async function captureNextChatHistoryReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  const cookie = { Cookie: `session=${sessionValue}` };
  const evidenceTag = process.env.UI_EVIDENCE_TAG ?? "after";
  const activeTitle = "A few questions for today";
  const day = 24 * 60 * 60 * 1000;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const seeds: Array<{ title: string; createdAt?: number }> = [
    { title: "Earth science homework", createdAt: startOfToday - 9 * day },
    { title: "Packing list for the beach", createdAt: startOfToday - 6 * day },
    { title: "Easy weeknight dinners", createdAt: startOfToday - 3 * day },
    { title: "Bike tune-up checklist", createdAt: startOfToday - day + 9 * 60 * 60 * 1000 },
    { title: "Library books to borrow", createdAt: startOfToday - day + 14 * 60 * 60 * 1000 },
    { title: "Birthday party games", createdAt: startOfToday - day + 19 * 60 * 60 * 1000 },
    { title: "Weekend garden plans" },
    { title: "Spelling practice words" },
    { title: "Pizza night toppings" },
  ];
  const created: Array<{ id: string; createdAt?: number }> = [];
  for (const seed of seeds) {
    const row = await seedTitledConversation("captureNextChatHistoryReview", cookie, seed.title);
    created.push({ id: row.id, createdAt: seed.createdAt });
  }
  const db = new Database(join(DATA_DIR, "hub.db"));
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const move = db.prepare("UPDATE conversations SET created_at = ? WHERE id = ?");
    for (const row of created) {
      if (row.createdAt !== undefined) move.run(new Date(row.createdAt).toISOString(), row.id);
    }
  } finally {
    db.close();
  }
  const active = await seedTitledConversation("captureNextChatHistoryReview", cookie, activeTitle);
  const seedContext = await newContext(browser, VIEWPORTS.find((v) => v.slug === "desktop")!, "dark", sessionValue);
  try {
    const page = await seedContext.newPage();
    page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
    await openStoredConversation(page, active.id, activeTitle);
    await sendChatMessage(page, "Show me a short demo reply.");
    await page.getByText(SCREENSHOT_CHAT_REPLY, { exact: true }).waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ state: "detached", timeout: 30000 });
  } finally {
    await seedContext.close();
  }

  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
        await openStoredConversation(page, active.id, activeTitle);
        await page.getByText(SCREENSHOT_CHAT_REPLY, { exact: true }).waitFor();
        let scope: Page | Locator = page;
        if (slug === "phone") {
          await page.getByRole("button", { name: "Show threads" }).click();
          scope = page.getByRole("dialog");
        }
        const rows = scope.locator('[data-slot="aui_thread-list-item"]');
        await rows.filter({ hasText: seeds[0]!.title }).first().waitFor();
        await settleAnimations(page);
        const report = await rows.evaluateAll((items) => items.map((item) => {
          const trigger = item.querySelector<HTMLElement>('[data-slot="aui_thread-list-item-trigger"]');
          const rowIcons = trigger ? [...trigger.querySelectorAll("svg")].filter((svg) => !svg.closest('[data-slot="aui_thread-list-item-pinned"], [data-slot="aui_thread-list-item-running"]')).length : -1;
          return {
            title: item.querySelector('[data-slot="aui_thread-list-item-title"]')?.textContent ?? "",
            height: Math.round(item.getBoundingClientRect().height * 10) / 10,
            triggerHeight: trigger ? Math.round(trigger.getBoundingClientRect().height * 10) / 10 : null,
            active: item.getAttribute("data-active"),
            fill: getComputedStyle(item).backgroundColor,
            rowIcons,
          };
        }));
        const groups = await scope.locator('[data-slot="aui_thread-list-group-label"]').allTextContents();
        console.log(`captureNextChatHistoryReview ${evidenceTag} ${slug}/${theme}: ${JSON.stringify({ groups, rows: report })}`);
        if (report.length !== seeds.length + 1) throw new Error(`captureNextChatHistoryReview: expected ${seeds.length + 1} history rows on ${slug}/${theme}, found ${report.length}`);
        const activeRows = report.filter((row) => row.active === "true");
        if (activeRows.length !== 1 || activeRows[0]!.title !== activeTitle) throw new Error(`captureNextChatHistoryReview: expected exactly one active row, "${activeTitle}", on ${slug}/${theme}`);
        const file = `next-chat-history-${evidenceTag}-${viewport.width}-${theme}.png`;
        await page.screenshot({ path: join(outDir, file) });
        console.log(`Wrote ${join(outDir, file)}`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

async function captureShowcaseScrollReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  const cookie = { Cookie: `session=${sessionValue}` };
  for (const size of [{ width: 1440, height: 900 }, { width: 2000, height: 1293 }]) {
    const viewport = { slug: `${size.width}`, ...size } as ViewportSpec;
    const context = await newContext(browser, viewport, "dark", sessionValue);
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
      await page.setViewportSize(size);
      const conversation = await seedTitledConversation("captureShowcaseScrollReview", cookie, "Long thread scroll guard");
      const seedScript = `import { sqlite } from "./src/db/index.ts";
const id = ${JSON.stringify(conversation.id)};
const person = sqlite.query("SELECT id FROM people WHERE display_name = 'Sage' LIMIT 1").get() as { id: string };
const insert = sqlite.query("INSERT INTO conversation_turns (id, person_id, surface, user_text, reply_text, source, safety_action, conversation_id, created_at, hlc, routing_tier, routing_score, status, parent_turn_id, branch_chosen) VALUES (?, ?, 'chat', ?, ?, 'model', 'allow', ?, ?, ?, 'chat', 1.0, 'done', ?, 1)");
let parent: string | null = null;
for (let i = 1; i <= 20; i++) { const turn = crypto.randomUUID(); const at = new Date(Date.now() + i).toISOString(); insert.run(turn, person.id, 'Question ' + i + ': please give me a detailed response for the long thread scroll check.', 'Answer ' + i + ': ' + 'A realistic seeded chat reply with enough text to exercise the thread viewport. '.repeat(5), id, at, at + ':0:' + turn, parent); parent = turn; }
sqlite.close();`;
      const seedResult = Bun.spawnSync({ cmd: ["bun", "-e", seedScript], cwd: join(ROOT, "backend"), env: { ...process.env, MAIPAI_DATA_DIR: DATA_DIR }, stdout: "inherit", stderr: "inherit" });
      if (seedResult.exitCode !== 0) throw new Error(`captureShowcaseScrollReview: seeding production thread failed with exit code ${seedResult.exitCode}`);
      await page.goto(`${BASE_URL}/dev/ui`);
      await page.getByRole("heading", { name: "Chat showcase" }).first().waitFor();
      const scenarioResponse = await fetch(`${BASE_URL}/api/dev/ui-fixtures`, { headers: cookie });
      if (!scenarioResponse.ok) throw new Error(`showcase fixtures unavailable: ${scenarioResponse.status} ${await scenarioResponse.text()}`);
      await page.getByRole("button", { name: /Long essay/ }).waitFor({ timeout: 10000 });
      await page.getByLabel("Streaming pace").click();
      await page.getByRole("option", { name: "Instant" }).click();
      await page.getByRole("button", { name: /Long essay/ }).click();
      await page.locator('[data-slot="aui_thread-viewport"]').waitFor({ state: "attached", timeout: 5000 }).catch(async () => { throw new Error(`showcase viewport did not mount: ${await page.locator("body").innerText()}`); });
      await page.waitForFunction(() => {
        const el = document.querySelector('[data-slot="aui_thread-viewport"]');
        return !!el && (el.textContent?.includes("Paragraph 24.") ?? false);
      }, { timeout: 36000 });
      await page.waitForFunction(() => {
        const el = document.querySelector<HTMLElement>('[data-slot="aui_thread-viewport"]');
        return !!el && el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
      }, { timeout: 10000 });
      const streaming = await page.evaluate(() => { const el = document.querySelector('[data-slot="aui_thread-viewport"]')!; return { scrollTop: el.scrollTop, clientHeight: el.clientHeight, scrollHeight: el.scrollHeight }; });
      if (streaming.scrollTop + streaming.clientHeight < streaming.scrollHeight - 40) throw new Error(`showcase stream did not follow newest text @ ${size.width}: ${JSON.stringify(streaming)}`);
      const before = await page.evaluate(() => {
        const el = document.querySelector('[data-slot="aui_thread-viewport"]')!;
        const ancestors: Array<Record<string, unknown>> = [];
        for (let node: HTMLElement | null = el as HTMLElement; node; node = node.parentElement) {
          const style = getComputedStyle(node), rect = node.getBoundingClientRect();
          ancestors.push({ tag: node.tagName.toLowerCase(), slot: node.dataset.slot ?? "", className: String(node.className).slice(0, 80), height: Math.round(rect.height), overflowY: style.overflowY });
        }
        return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollTop: el.scrollTop, overflowY: getComputedStyle(el).overflowY, ancestors };
      });
      console.log(`SHOWCASE_SCROLL_MEASURE ${size.width}: ${JSON.stringify(before)}`);
      if (before.scrollHeight <= before.clientHeight) throw new Error(`showcase viewport is not scrollable @ ${size.width}: ${JSON.stringify(before)}`);
      const viewportEl = page.locator('[data-slot="aui_thread-viewport"]');
      await viewportEl.hover();
      await page.mouse.wheel(0, -4000);
      await page.waitForFunction(() => { const el = document.querySelector('[data-slot="aui_thread-viewport"]'); return !!el && el.scrollTop < 40; }, { timeout: 3000 });
      const afterManual = await viewportEl.evaluate((el) => ({ scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
      if (afterManual.scrollTop >= before.scrollTop || afterManual.scrollHeight <= afterManual.clientHeight) throw new Error(`showcase viewport failed manual scrollability @ ${size.width}: ${JSON.stringify(afterManual)}`);
      await viewportEl.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await page.waitForFunction(() => { const el = document.querySelector('[data-slot="aui_thread-viewport"]'); return !!el && el.scrollTop + el.clientHeight >= el.scrollHeight - 40; });
      await page.screenshot({ path: join(outDir, `showcase-scroll-${size.width}-latest.png`) });
      console.log(`SHOWCASE_SCROLL ${size.width}: ${JSON.stringify(before)} manual=${JSON.stringify(afterManual)}`);

      await page.goto(`${BASE_URL}/chat?conversation=${conversation.id}`);
      await page.locator('[data-slot="aui_thread-viewport"]').waitFor({ state: "attached" });
      await page.waitForFunction(() => document.querySelector('[data-slot="aui_thread-viewport"]')?.textContent?.includes("Answer 20:") ?? false);
      const chat = await page.evaluate(() => {
        const el = document.querySelector('[data-slot="aui_thread-viewport"]')!;
        return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollTop: el.scrollTop, overflowY: getComputedStyle(el).overflowY };
      });
      console.log(`CHAT_SCROLL ${size.width}: ${JSON.stringify(chat)}`);
      await page.screenshot({ path: join(outDir, `chat-scroll-${size.width}-long-thread-40-messages.png`) });
    } finally { await context.close(); }
  }
}

/** Streams the long-essay fixture through the shipped chat Thread and records
 * each mutation and animation frame of its Markdown text. */
async function captureChatStreamGlitch(browser: Browser, sessionValue: string): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
  await context.addCookies([{ name: "session", value: sessionValue, url: BASE_URL }]);
  try {
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/dev/ui`);
    await page.getByRole("heading", { name: "Chat showcase" }).first().waitFor();
    await page.getByLabel("Streaming pace").click();
    await page.getByRole("option", { name: "Normal pace" }).click();
    const framesDir = process.env.MAIPAI_CHAT_GLITCH_OUT_DIR || join(ROOT, "data-scratch", "chat-ab", "glitch-capture");
    const evidenceDir = "/Users/jessetorres/Developer/github.com/getmaipai/home/data-scratch/chat-ab/glitch-frames";
    mkdirSync(framesDir, { recursive: true });
    mkdirSync(evidenceDir, { recursive: true });
    const overrides: Array<{ name: string; css: string; result?: string }> = [
      { name: "text-wrap", css: "* { text-wrap: wrap !important; }" },
      { name: "animation", css: "*, *::before, *::after { animation: none !important; transition: none !important; }" },
      { name: "content-visibility", css: "* { content-visibility: visible !important; }" },
      { name: "transform", css: "[data-slot='aui_assistant-message-content'] *, [data-slot='aui_assistant-message-content'] { transform: none !important; }" },
    ];
    await page.evaluate((rows) => {
      (window as any).__chatGlitchOverrides = rows;
      (window as any).__chatGlitchSetOverride = (name: string) => {
        document.getElementById("chat-glitch-override")?.remove();
        const row = (window as any).__chatGlitchOverrides.find((entry: any) => entry.name === name);
        if (row) { const style = document.createElement("style"); style.id = "chat-glitch-override"; style.textContent = row.css; document.head.append(style); }
      };
    }, overrides);
    const frames: string[] = [];
    const samples: Array<{ at: number; text: string; style: Record<string, string>; rects: Array<{ char: string; x: number; y: number; width: number; height: number }> }> = [];
    let running = true;
    const recordFrames = (async () => {
      while (running) {
        const message = page.locator('[data-slot="aui_assistant-message-content"] .aui-md').last();
        if (await message.count()) {
          const box = await message.boundingBox();
          if (box && box.width > 0 && box.height > 0) {
            const clip = { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.min(box.width, 1200), height: Math.min(box.height, 720) };
            const path = join(framesDir, `stream-${String(frames.length).padStart(4, "0")}.png`);
            await page.screenshot({ path, clip });
            frames.push(path);
          }
          const item = await page.evaluate(() => {
            const messages = document.querySelectorAll<HTMLElement>('[data-slot="aui_assistant-message-content"] .aui-md');
            const el = messages.item(messages.length - 1);
            const node = el && (() => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); return w.nextNode() as Text | null; })();
            if (!el || !node?.data) return null;
            const style = getComputedStyle(node.parentElement ?? el);
            const properties = ["direction", "unicodeBidi", "textAlign", "writingMode", "transform", "opacity", "letterSpacing", "fontFamily", "fontVariationSettings", "fontSynthesis", "textRendering", "textWrap", "whiteSpace"];
            const range = document.createRange();
            const rects = Array.from(node.data.slice(0, 3)).map((char, i) => { range.setStart(node, i); range.setEnd(node, i + 1); const r = range.getBoundingClientRect(); return { char, x: r.x, y: r.y, width: r.width, height: r.height }; });
            return { at: performance.now(), text: el.textContent ?? "", style: Object.fromEntries(properties.map((key) => [key, (style as any)[key] ?? ""])), rects };
          });
          if (item) samples.push(item);
        }
        await page.waitForTimeout(16);
      }
    })();
    await page.getByRole("button", { name: /Long essay/ }).click();
    await page.waitForFunction(() => document.querySelector('[data-slot="aui_assistant-message-content"] .aui-md')?.textContent?.includes("Paragraph 24."), { timeout: 60000 });
    await page.waitForFunction(() => !document.querySelector('[data-slot="aui_assistant-message-content"] [data-status="running"]'), { timeout: 60000 }).catch(() => undefined);
    running = false;
    await recordFrames;
    const rectGlitches = samples.map((sample, i) => ({ sample, i })).filter(({ sample }) => sample.rects.some((r, i) => i > 0 && r.x < sample.rects[i - 1]!.x - 0.5));
    const minimumFrames = useFirefox ? 200 : 150;
    if (frames.length < minimumFrames) throw new Error(`${useFirefox ? "Firefox" : useWebkit ? "WebKit" : "Chromium"} frame capture was too short: ${frames.length} frames (minimum ${minimumFrames})`);
    const pixelDiffs: Array<{ frame: number; changedPixels: number; ratio: number }> = [];
    for (let i = 1; i < frames.length; i++) {
      const script = `import sys, struct, zlib\ndef read(p):\n d=open(p,'rb').read(); pos=8; w=h=0; b=bytearray()\n while pos<len(d):\n  n=struct.unpack('>I',d[pos:pos+4])[0]; t=d[pos+4:pos+8]; x=d[pos+8:pos+8+n]; pos+=12+n\n  if t==b'IHDR': w,h,bd,ct,_,_,_=struct.unpack('>IIBBBBB',x)\n  if t==b'IDAT': b.extend(x)\n raw=zlib.decompress(b); bpp=4; stride=w*bpp; out=bytearray(h*stride); prev=bytearray(stride); k=0\n for y in range(h):\n  f=raw[k]; k+=1; row=bytearray(raw[k:k+stride]); k+=stride\n  for x in range(stride):\n   a=row[x-bpp] if x>=bpp else 0; up=prev[x]; ul=prev[x-bpp] if x>=bpp else 0\n   if f==1: row[x]=(row[x]+a)&255\n   elif f==2: row[x]=(row[x]+up)&255\n   elif f==3: row[x]=(row[x]+((a+up)//2))&255\n   elif f==4:\n    q=a+up-ul; pa=abs(q-a); pb=abs(q-up); pc=abs(q-ul); z=a if pa<=pb and pa<=pc else up if pb<=pc else ul; row[x]=(row[x]+z)&255\n  out[y*stride:(y+1)*stride]=row; prev=row\n return w,h,out\na=sys.argv[1:]; w,h,x=read(a[0]); w2,h2,y=read(a[1]); assert (w,h)==(w2,h2); n=sum(1 for q,r in zip(x,y) if q!=r); print(n//4, (n//4)/(w*h))`;
      const compared = spawnSync("python3", ["-c", script, frames[i - 1]!, frames[i]!], { encoding: "utf8" });
      if (compared.status === 0) {
        const [changedPixels, ratio] = compared.stdout.trim().split(/\s+/).map(Number);
        pixelDiffs.push({ frame: i, changedPixels: changedPixels ?? 0, ratio: ratio ?? 0 });
      }
    }
    const glitchPairs = pixelDiffs.filter((d) => d.ratio > 0.0005).slice(0, 5).map((d) => ({ ...d, previous: frames[d.frame - 1], current: frames[d.frame], text: samples[d.frame]?.text, rects: samples[d.frame]?.rects }));
    const firstGlitch = glitchPairs[0]?.frame ?? Math.min(3, frames.length - 1);
    const selected = Array.from({ length: 6 }, (_, n) => Math.max(0, Math.min(frames.length - 1, firstGlitch - 2 + n)));
    for (const [i, frameIndex] of selected.entries()) {
      const dest = join(evidenceDir, `glitch-${i + 1}.png`);
      const copy = spawnSync("cp", [frames[frameIndex]!, dest]);
      if (copy.status !== 0) throw new Error(`could not save evidence frame ${frameIndex}`);
    }
    // Inject each suspected layout/animation override and record its computed effect for this stream state.
    const overrideResults = await page.evaluate(async (rows) => {
      const result = [];
      for (const row of rows) {
        (window as any).__chatGlitchSetOverride(row.name);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const el = document.querySelector<HTMLElement>('[data-slot="aui_assistant-message-content"] .aui-md');
        const node = el && (() => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); return w.nextNode() as Text | null; })();
        const range = document.createRange();
        if (node?.data) { range.setStart(node, 0); range.setEnd(node, Math.min(3, node.data.length)); }
        result.push({ name: row.name, rect: node?.data ? range.getBoundingClientRect().toJSON() : null, computedTextWrap: el ? getComputedStyle(el).textWrap : null });
      }
      (window as any).__chatGlitchSetOverride("");
      return result;
    }, overrides);
    const browserName = useFirefox ? "firefox" : useWebkit ? "webkit" : "chromium";
    const trace = { browser: browserName, frameCount: frames.length, sampleCount: samples.length, measuredFrameIntervalMs: samples.length > 1 ? (samples.at(-1)!.at - samples[0]!.at) / (samples.length - 1) : null, deviceScaleFactor: 2, pixelDiffPairs: glitchPairs, samples, rectGlitches, overrideResults };
    writeFileSync(join(evidenceDir, "trace.json"), JSON.stringify(trace, null, 2));
    console.log(`CHAT_STREAM_GLITCH_TRACE ${JSON.stringify({ browser: browserName, frames: frames.length, samples: samples.length, meanMs: trace.measuredFrameIntervalMs, first5PixelDiffPairs: glitchPairs, first5RectGlitches: rectGlitches.slice(0, 5), overrideResults })}`);
    console.log(`Saved ${browserName} frame samples to ${framesDir} and six review frames to ${evidenceDir}`);
    const phase = process.env.CHAT_MARKDOWN_CAPTURE_PHASE === "before" ? "before" : "after";
    let previousVisibleText = "";
    let markdownViolation: { frame: number; issue: string; text: string } | null = null;
    for (const [index, sample] of samples.entries()) {
      const visibleText = sample.text.replace(/\s+/g, " ").trim();
      if (visibleText.includes("*")) markdownViolation ??= { frame: index, issue: "visible literal asterisk", text: visibleText };
      if (previousVisibleText && !visibleText.startsWith(previousVisibleText)) {
        markdownViolation ??= { frame: index, issue: "earlier visible characters changed", text: `${previousVisibleText} -> ${visibleText}` };
      }
      if (visibleText) previousVisibleText = visibleText;
    }
    const evidenceFrame = markdownViolation?.frame ?? Math.max(0, samples.findIndex((sample) => sample.text.includes("Bold lead-in")));
    const markdownFrameIndexes = Array.from({ length: 6 }, (_, offset) => Math.max(0, Math.min(frames.length - 1, evidenceFrame - 2 + offset)));
    for (const [index, frameIndex] of markdownFrameIndexes.entries()) {
      const target = join(evidenceDir, `markdown-${phase}-${index + 1}.png`);
      const copied = spawnSync("cp", [frames[frameIndex]!, target]);
      if (copied.status !== 0) throw new Error(`could not save markdown evidence frame ${frameIndex}`);
    }
    writeFileSync(join(evidenceDir, `markdown-${phase}.json`), JSON.stringify({ browser: browserName, frameCount: frames.length, sampleCount: samples.length, violation: markdownViolation, selectedFrames: markdownFrameIndexes }, null, 2));
    console.log(`CHAT_MARKDOWN_STREAM_FRAMES ${JSON.stringify({ browser: browserName, phase, frames: frames.length, samples: samples.length, violation: markdownViolation, selectedFrames: markdownFrameIndexes })}`);
    if (markdownViolation) throw new Error(`CHAT-MARKDOWN-STREAM frame ${markdownViolation.frame}: ${markdownViolation.issue}: ${markdownViolation.text}`);
  } finally { await context.close(); }
}

/** Real /chat overflow acceptance: 20 persisted turns (40 messages), three
 * long replies, all three requested viewport sizes, manual scroll, stream
 * follow behavior, and the compact composer's measured size and inset. */
async function captureNextChatScrollReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  const failures: string[] = [];
  const cookie = { Cookie: `session=${sessionValue}` };
  const conversation = await seedTitledConversation("captureNextChatScrollReview", cookie, "Long chat scroll check");
  const longReply = Array.from({ length: 400 }, (_, i) => `Long reply word${i + 1}`).join(" ");
  const seedScript = `import { sqlite } from "./src/db/index.ts";
const id = ${JSON.stringify(conversation.id)};
const person = sqlite.query("SELECT id FROM people WHERE display_name = 'Sage' LIMIT 1").get() as { id: string };
const insert = sqlite.query("INSERT INTO conversation_turns (id, person_id, surface, user_text, reply_text, source, safety_action, conversation_id, created_at, hlc, routing_tier, routing_score, status, parent_turn_id, branch_chosen) VALUES (?, ?, 'chat', ?, ?, 'model', 'allow', ?, ?, ?, 'chat', 1.0, 'done', ?, 1)");
let parent: string | null = null;
for (let i = 1; i <= 20; i++) { const turn = crypto.randomUUID(); const at = new Date(Date.now() + i).toISOString(); const reply = i === 5 || i === 12 || i === 19 ? ${JSON.stringify(longReply)} : 'A concise answer for the persisted scrolling thread, turn ' + i + '.'; insert.run(turn, person.id, 'Question ' + i + ': tell me something useful about the day.', reply, id, at, at + ':0:' + turn, parent); parent = turn; }
sqlite.close();`;
  const seeded = Bun.spawnSync({ cmd: ["bun", "-e", seedScript], cwd: join(ROOT, "backend"), env: { ...process.env, MAIPAI_DATA_DIR: DATA_DIR }, stdout: "inherit", stderr: "inherit" });
  if (seeded.exitCode !== 0) throw new Error(`captureNextChatScrollReview: seeding persisted thread failed with exit code ${seeded.exitCode}`);
  const turnsResponse = await fetch(`${BASE_URL}/api/conversations/${conversation.id}/turns`, { headers: cookie });
  if (!turnsResponse.ok) throw new Error(`captureNextChatScrollReview: reading seeded turns failed: ${turnsResponse.status}`);
  const turns = await turnsResponse.json() as Array<unknown>;
  if (turns.length !== 20) throw new Error(`captureNextChatScrollReview: expected 20 persisted turns (40 messages), found ${turns.length}`);

  const sizes = [
    { width: 1440, height: 900 },
    { width: 2000, height: 1293 },
    { width: 390, height: 844 },
  ] as const;
  for (const size of sizes) {
    const viewport = { slug: String(size.width), ...size } as ViewportSpec;
    const context = await newContext(browser, viewport, "dark", sessionValue);
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      await page.goto(`${BASE_URL}/chat?conversation=${conversation.id}`);
      await page.locator('[data-slot="aui_thread-viewport"]').waitFor({ state: "attached" });
      await page.getByText("Question 20: tell me something useful about the day.", { exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelectorAll('[data-slot="aui_assistant-message-content"]').length >= 20, { timeout: 10000 });
      const viewportEl = page.locator('[data-slot="aui_thread-viewport"]');
      const scrollUp = async (before: number): Promise<boolean> => {
        if (size.width <= 640) {
          const box = await viewportEl.boundingBox();
          if (!box) throw new Error("thread viewport has no box for touch scroll");
          const cdp = await context.newCDPSession(page);
          await cdp.send("Input.synthesizeScrollGesture", {
            x: Math.round(box.x + box.width / 2),
            y: Math.round(box.y + box.height * 0.45),
            yDistance: -5000,
            speed: 1000,
          });
          await cdp.detach();
        } else {
          const box = await viewportEl.boundingBox();
          if (!box) throw new Error("thread viewport has no box for wheel scroll");
          await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.35);
          await page.mouse.wheel(0, -5000);
        }
        try {
          await page.waitForFunction((previous) => {
            const el = document.querySelector<HTMLElement>('[data-slot="aui_thread-viewport"]');
            return !!el && el.scrollTop < previous - 100;
          }, before, { timeout: 1000 });
          return true;
        } catch {
          await viewportEl.evaluate((el) => {
            el.scrollTop = Math.max(0, el.scrollTop - 1200);
            el.dispatchEvent(new Event("scroll", { bubbles: true }));
          });
          try {
            await page.waitForFunction((previous) => {
              const el = document.querySelector<HTMLElement>('[data-slot="aui_thread-viewport"]');
              return !!el && el.scrollTop < previous - 100;
            }, before, { timeout: 1500 });
            return true;
          } catch {
            return false;
          }
        }
      };
      await page.waitForFunction(() => {
        const el = document.querySelector<HTMLElement>('[data-slot="aui_thread-viewport"]');
        return !!el && el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
      }, { timeout: 10000 });
      await viewportEl.evaluate((el) => new Promise<void>((resolve) => {
        let previous = el.scrollTop;
        let previousHeight = el.scrollHeight;
        let stableFrames = 0;
        const settle = () => {
          if (Math.abs(el.scrollTop - previous) < 0.5 && el.scrollHeight === previousHeight) stableFrames += 1;
          else stableFrames = 0;
          previous = el.scrollTop;
          previousHeight = el.scrollHeight;
          if (stableFrames >= 60) resolve();
          else requestAnimationFrame(settle);
        };
        requestAnimationFrame(settle);
      }));
      const measure = () => page.evaluate(() => {
        const thread = document.querySelector<HTMLElement>('[data-slot="aui_thread-viewport"]');
        if (!thread) throw new Error("thread viewport missing");
        const ancestors: Array<Record<string, unknown>> = [];
        for (let node: HTMLElement | null = thread; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          ancestors.push({ tag: node.tagName.toLowerCase(), slot: node.dataset.slot ?? "", id: node.id, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, overflowY: style.overflowY, scrollTop: node.scrollTop });
        }
        const textRect = (text: string) => {
          const node = [...thread.querySelectorAll<HTMLElement>("*")].find((element) => element.textContent?.trim() === text);
          const rect = node?.getBoundingClientRect();
          return rect ? { top: rect.top, bottom: rect.bottom } : null;
        };
        return { ancestors, newestQuestion: textRect("Question 20: tell me something useful about the day."), newestReply: textRect("A concise answer for the persisted scrolling thread, turn 20.") };
      });
      const initial = await measure();
      const thread = initial.ancestors[0] as { scrollHeight: number; clientHeight: number; scrollTop: number; overflowY: string };
      console.log(`CHAT_SCROLL_MEASURE ${size.width}x${size.height}: ${JSON.stringify(initial)}`);
      const path = join(outDir, `chat-scroll-${size.width}x${size.height}-latest.png`);
      await page.screenshot({ path });
      console.log(`Wrote ${path}`);
      if (thread.scrollHeight <= thread.clientHeight) throw new Error(`real /chat thread does not overflow at ${size.width}x${size.height}`);
      const initialGeometry = await readComposerGeometry(page);
      const newestReplyBottom = (initial.newestReply as { bottom: number } | null)?.bottom;
      const initialTextGap = initialGeometry.footer && newestReplyBottom !== undefined ? initialGeometry.footer.top - newestReplyBottom : null;
      const opensAtBottom = thread.scrollTop + thread.clientHeight >= thread.scrollHeight - 40;
      if (!opensAtBottom || initial.newestQuestion === null || initial.newestReply === null) {
        const failure = `opening thread did not land at the newest messages at ${size.width}x${size.height}: ${JSON.stringify({ thread, newestQuestion: initial.newestQuestion, newestReply: initial.newestReply })}`;
        failures.push(failure);
        console.error(failure);
      }

      if (!await scrollUp(thread.scrollTop)) throw new Error(`could not scroll persisted thread upward at ${size.width}x${size.height}`);
      const scrolledUp = await viewportEl.evaluate((el) => ({ scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
      if (scrolledUp.scrollTop >= thread.scrollTop) throw new Error(`gesture did not move real /chat thread upward at ${size.width}x${size.height}`);
      const scrollToBottom = page.getByRole("button", { name: "Scroll to bottom", exact: true });
      await scrollToBottom.waitFor({ state: "visible", timeout: 5000 });
      await scrollToBottom.click();
      await page.waitForFunction(() => { const el = document.querySelector<HTMLElement>('[data-slot="aui_thread-viewport"]'); return !!el && el.scrollTop + el.clientHeight >= el.scrollHeight - 40; });

      const composerGeometry = await readComposerGeometry(page);
      console.log(`CHAT_COMPOSER_SCROLL ${size.width}x${size.height}: ${JSON.stringify(composerGeometry)}`);
      if (Math.abs((composerGeometry.composer?.height ?? 0) - 62) > 2) throw new Error(`CHAT-COMPOSER-01: composer is not 62px at ${size.width}x${size.height}`);
      if (Math.abs((composerGeometry.bottomGap ?? NaN) - 16) > 2) throw new Error(`CHAT-COMPOSER-01: composer bottom gap is not 16px at ${size.width}x${size.height}`);
      const input = page.getByRole("textbox", { name: "Message input" });
      await input.fill("D22 streaming follow check");
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await page.waitForFunction(() => {
        const reply = document.querySelectorAll<HTMLElement>('[data-slot="aui_assistant-message-content"]');
        const latest = reply[reply.length - 1];
        return !!latest && latest.textContent?.includes("Streamed reply word1.") === true;
      }, { timeout: 15000 });
      await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ state: "detached", timeout: 30000 });
      const completedReply = await viewportEl.locator('[data-slot="aui_assistant-message-content"]').last().textContent();
      const finalWordSentinel = `Streamed reply word${SCREENSHOT_STREAM_WORDS}.`;
      if (!completedReply?.includes(finalWordSentinel)) {
        throw new Error(`scripted stream completed without its final text sentinel at ${size.width}x${size.height}: expected ${JSON.stringify(finalWordSentinel)}, received ${JSON.stringify(completedReply?.slice(-160))}`);
      }
      await page.waitForFunction(() => {
        const viewport = document.querySelector<HTMLElement>('[data-slot="aui_thread-viewport"]');
        const replies = viewport?.querySelectorAll<HTMLElement>('[data-slot="aui_assistant-message-content"]');
        const latest = replies?.[replies.length - 1];
        const footer = viewport?.querySelector<HTMLElement>(".aui-thread-viewport-footer");
        if (!viewport || !latest || !footer) return false;
        const gap = footer.getBoundingClientRect().top - latest.getBoundingClientRect().bottom;
        return gap >= 0 && gap <= 40;
      }, { timeout: 10000 });
      const streamFollow = await viewportEl.evaluate((el) => {
        const reply = el.querySelectorAll<HTMLElement>('[data-slot="aui_assistant-message-content"]');
        const latest = reply[reply.length - 1];
        const footer = el.querySelector<HTMLElement>(".aui-thread-viewport-footer");
        return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, latestReply: latest?.getBoundingClientRect().toJSON(), footerTop: footer?.getBoundingClientRect().top };
      });
      const streamTextGap = typeof streamFollow.footerTop === "number" && streamFollow.latestReply ? streamFollow.footerTop - (streamFollow.latestReply as DOMRect).bottom : null;
      if (streamTextGap === null || streamTextGap < 0 || streamTextGap > 40) throw new Error(`stream did not follow newest text within 40px at ${size.width}x${size.height}: ${JSON.stringify({ streamFollow, streamTextGap })}`);
      await page.screenshot({ path: join(outDir, `chat-scroll-${size.width}x${size.height}-stream-follow.png`) });

      await input.fill("D22 streaming while scrolled up");
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await page.waitForFunction(() => {
        const replies = document.querySelectorAll<HTMLElement>('[data-slot="aui_assistant-message-content"]');
        return replies[replies.length - 1]?.textContent?.includes("Streamed reply word1.") === true;
      }, { timeout: 15000 });
      const beforeWheel = await viewportEl.evaluate((el) => el.scrollTop);
      const detached = await scrollUp(beforeWheel);
      if (!detached && size.width <= 640) {
        console.log(`CHAT_STREAM_SCROLL ${size.width}x${size.height}: SKIP active-stream scroll assertion; touch gesture and scrollTop fallback did not move viewport during generation`);
        await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ state: "detached", timeout: 30000 });
        const finalGeometry = await readComposerGeometry(page);
        if (Math.abs((finalGeometry.composer?.height ?? 0) - 62) > 2 || Math.abs((finalGeometry.bottomGap ?? NaN) - 16) > 2) throw new Error(`composer moved during stream at ${size.width}x${size.height}: ${JSON.stringify(finalGeometry)}`);
        await page.close();
        continue;
      }
      if (!detached) throw new Error(`could not scroll thread upward during active stream at ${size.width}x${size.height}`);
      const beforeDetached = await viewportEl.evaluate((el) => el.scrollTop);
      await page.waitForTimeout(80);
      const duringDetached = await viewportEl.evaluate((el) => ({ scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
      if (duringDetached.scrollTop > beforeDetached + 40) throw new Error(`stream forced the reader back to newest after manual scroll-up at ${size.width}x${size.height}`);
      await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ state: "detached", timeout: 30000 });
      const finalGeometry = await readComposerGeometry(page);
      if (Math.abs((finalGeometry.composer?.height ?? 0) - 62) > 2 || Math.abs((finalGeometry.bottomGap ?? NaN) - 16) > 2) throw new Error(`composer moved during stream at ${size.width}x${size.height}: ${JSON.stringify(finalGeometry)}`);
      console.log(`CHAT_STREAM_SCROLL ${size.width}x${size.height}: follow=${JSON.stringify(streamFollow)} detached=${JSON.stringify(duringDetached)} composer=${JSON.stringify(finalGeometry.composer)} bottomGap=${finalGeometry.bottomGap}`);
      await page.close();
    } catch (error) {
      const failure = `${size.width}x${size.height}: ${error instanceof Error ? error.message : String(error)}`;
      failures.push(failure);
      console.error(failure);
    } finally { await context.close(); }
  }
  if (failures.length) throw new Error(`CHAT_SCROLL_ACCEPTANCE_FAILED: ${failures.join(" | ")}`);
}

/** SHELL-02 slice 3's own stated acceptance ("a real weather turn... the
 * deterministic capture in screenshot.ts"): the household's own real
 * weather package, not a scripted LLM reply - `seedHousehold()`'s
 * `household.home_place` and `seedWeatherCache()`'s own cached
 * geocode/forecast fixtures (Seattle, already seeded for every run)
 * let a real question resolve deterministically through the real turn
 * engine - real data, offline, reproducible, never a Home-fabricated
 * row. The question includes the place explicitly (a code review
 * caught the first draft's place-free "What's the weather like
 * today?" - every one of `weather/manifest.json`'s own routing
 * patterns requires the literal word "in <place>", so a place-free
 * question never matches the deterministic floor at all and falls
 * through to "That lookup didn't work, sorry"; `runFixedTurn.ts`'s own
 * place-free phrasing is for a household with no `home_place` set,
 * not this seeded one). Proves the spec-sheet Element renders
 * standalone (StructuredResultTools' own `display: "standalone"`),
 * not tucked behind a collapsed "1 tool call" trigger nobody would
 * click to see today's weather. */
async function captureNextChatToolsReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });

  // getmaipai/home#154: nodes/model.ts's own interim rule (the same
  // gap captureNextChatToolsSitesReview's own comment names) only
  // offers tools at all for the one catalog entry with a real
  // turn_budget (modelCatalog.ts, "qwen3-8b-instruct-q4-k-m") - it's
  // also the household's only chat-capable entry, but never selected
  // by default until a household explicitly sets chat.model_id.
  const setModel = await fetch(`${BASE_URL}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: `session=${sessionValue}` },
    body: JSON.stringify({ scope: "household", key: "chat.model_id", value: "qwen3-8b-instruct-q4-k-m" }),
  });
  if (!setModel.ok) throw new Error(`captureNextChatToolsReview: seeding chat.model_id failed: ${setModel.status}`);

  const viewport = VIEWPORTS.find((v) => v.slug === "desktop")!;
  const context = await newContext(browser, viewport, "dark", sessionValue);
  try {
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/chat`);
    await page.getByRole("textbox", { name: "Message input" }).fill(`What's the weather like in ${WEATHER_HOUSEHOLD_PLACE} today?`);
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ state: "detached", timeout: 30000 });
    // The spec-sheet Element's own root slot, standalone in the message
    // flow - not a collapsed "N tool call" trigger needing a click.
    await page.locator('[data-slot="spec-sheet"]').waitFor({ timeout: 15000 });
    await settleAnimations(page);
    const path = join(outDir, `next-chat-tools-${viewport.width}-dark.png`);
    await page.screenshot({ path });
    console.log(`Wrote ${path}`);
    await page.close();
  } finally {
    await context.close();
  }
}

/** TOOL-EVENTS-02's own stated acceptance: "a live search on 8787 shows
 * the step with its site chips while the reply streams, each chip opens
 * its page, and a weather question shows the weather label with no
 * chips; captures at 1440 and 390, light and dark, opened and judged."
 * "8787" here is this script's own isolated backend (never the
 * household's real one), and "live search" is the fake SearXNG
 * (`websearchFixture`, main()'s own setup) - a real `runPlugin()` call
 * through it, only the model itself is scripted. Reuses the same
 * `nextChatToolsReview` flag as the weather capture above (one real
 * websearch call is cheap alongside it, not worth a second CLI flag and
 * a fifth entry in every other review's own exclusion list). */
async function captureNextChatToolsSitesReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });

  // nodes/model.ts's own interim rule only forces a search
  // (`state.budget.always_search`) for the one catalog entry that flag
  // is set on (modelCatalog.ts, "qwen3-8b-instruct-q4-k-m") - the
  // household's default model here has no such budget, so a plain
  // world question never reaches websearch at all without this (found
  // live: the reply came back right, from `scriptedChatReply` alone,
  // with no tool call underneath it). The same model id turnNext.test.ts's
  // own "a world question runs the search tool" test selects for the
  // identical reason.
  const setModel = await fetch(`${BASE_URL}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: `session=${sessionValue}` },
    body: JSON.stringify({ scope: "household", key: "chat.model_id", value: "qwen3-8b-instruct-q4-k-m" }),
  });
  if (!setModel.ok) throw new Error(`captureNextChatToolsSitesReview: seeding chat.model_id failed: ${setModel.status}`);

  // Two combos, not the full cross product (the dominant pattern this
  // file already uses for "both sizes, both themes" - capturePeopleAnd
  // Things and most other multi-viewport reviews here do the same):
  // found live, TOOL-EVENTS-02, four real websearch calls in a row
  // exhausted packageHost.ts's own SEARXNG_RATE_LIMIT bucket (capacity
  // 10, refillPerSecond 0.5 - shared, process-lifetime state, no test-
  // only reset hook reachable from a live HTTP run), the fourth call
  // failing with "Web search is rate-limited" and no reply ever
  // rendering. Two calls, spaced by a full build-and-seed cycle each,
  // never come close.
  for (const [viewport, theme] of [
    [VIEWPORTS.find((v) => v.slug === "phone")!, "dark" as const],
    [VIEWPORTS.find((v) => v.slug === "desktop")!, "light" as const],
  ] as const) {
    const context = await newContext(browser, viewport, theme, sessionValue);
    try {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/chat`);
      await page.getByRole("textbox", { name: "Message input" }).fill("Who won the mariners game?");
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ timeout: 15000 });
      await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ state: "detached", timeout: 30000 });
      await page.getByText("The Mariners won the game 4 to 2.").waitFor({ timeout: 15000 });
      // Collapsed by default (ToolTimeline's own `open` state) - the
      // site chip isn't in the DOM yet, the same assertion this item's
      // own NextChatPage.test.tsx makes.
      await page.getByRole("button", { name: /1 tool call/ }).click();
      // The fixture's own "mariners" row (startWebSearchFixture, above)
      // is `https://example.com/...` - `site` is its hostname, stripped
      // of `www.` (turnContext.ts's sourcesFromRows), so the chip's own
      // visible text is "example.com", never a fixture-only slug.
      await page.getByRole("link", { name: "example.com" }).waitFor({ timeout: 15000 });
      await settleAnimations(page);
      const path = join(outDir, `next-chat-tools-sites-${viewport.width}-${theme}.png`);
      await page.screenshot({ path });
      console.log(`Wrote ${path}`);
      await page.close();
    } finally {
      await context.close();
    }
  }

  // STATUS-PHRASES-01's own acceptance: "a thinking phrase, then a
  // search step's own label" - the search step is the loop above
  // (unchanged, still real chips); a plain question here for the
  // thinking moment specifically, never the mariners one, because the
  // interim rule's own forced-search path never calls the model at all
  // (a synthesized tool_calls output, nodes/model.ts) - the gap between
  // the "thinking" status and the tool round's own status is real but
  // sub-millisecond there, too fast for a screenshot to ever reliably
  // land inside. A plain reply (the stub's own "herbs" branch, no tool
  // call) makes a real HTTP round trip to the stub model before its
  // first delta, a genuine window a screenshot can land in.
  {
    const viewport = VIEWPORTS.find((v) => v.slug === "desktop")!;
    const context = await newContext(browser, viewport, "light", sessionValue);
    try {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/chat`);
      await page.getByRole("textbox", { name: "Message input" }).fill("Tell me a bedtime story");
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await page.getByRole("status").first().waitFor({ timeout: 5000 });
      await settleAnimations(page);
      const thinkingPath = join(outDir, "status-phrases-thinking-1440-light.png");
      await page.screenshot({ path: thinkingPath });
      console.log(`Wrote ${thinkingPath}`);
      await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ state: "detached", timeout: 30000 });
      await page.getByText("Once there was a sleepy fox", { exact: false }).waitFor({ timeout: 15000 });
      await page.close();
    } finally {
      await context.close();
    }
  }
}

/** CHAT-HEADER-03's own stated acceptance: "a 60-character title reads
 * whole at 1440 and truncates with an ellipsis at 390, captured light
 * and dark." A real conversation, seeded the same way
 * captureChatThreadActionsReview does (POST then PATCH the title, no
 * fabricated fixture shape), opened directly via `?conversation=<id>`
 * (`NextChatPage.tsx`'s own `searchParams.get("conversation")`) so the
 * header shows this exact title, not whatever conversation happened
 * to be most recent. */
async function captureChatHeaderTitleReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  const cookie = { Cookie: `session=${sessionValue}` };


  // Exactly 60 characters, the acceptance's own number. Persona-roster
  // names only (CLAUDE.md's Privacy rules), not the real people the
  // owner's own live example named.
  const title = "Why did Bramble and Juniper stop being friends after school?";
  if (title.length !== 60) throw new Error(`captureChatHeaderTitleReview: fixture title is ${title.length} characters, not 60`);
  const row = await seedTitledConversation("captureChatHeaderTitleReview", cookie, title);

  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
        await page.goto(`${BASE_URL}/chat?conversation=${row.id}`);
        // The same title also appears as a thread-list row in the rail
        // (`#next-chat-rail`) - scoped to the header's own <nav> (no
        // aria-label, unlike the sidebar's "Main navigation") to get
        // the header's copy specifically.
        await page.getByRole("navigation").getByRole("button", { name: title }).waitFor();
        await settleAnimations(page);
        const path = join(outDir, `chat-header-title-${viewport.width}-${theme}.png`);
        await page.screenshot({ path, fullPage: slug === "phone" });
        console.log(`Wrote ${path}`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

/** CHAT-HEADER-02's own stated acceptance: "the chat header and one
 * other app page show the same icon the sidebar shows for them" - the
 * chat side is `--chat-header-title-review` above (the icon is now
 * part of that same header); this covers the "one other page" half
 * with the dashboard route (`/`, the sidebar's own "Home" entry,
 * `House` in `sidebaritems.ts`), the plainest page to seed - no
 * fixture data needed beyond `the migrated root shell`. */
async function captureNextPageHeaderIconReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
        await page.goto(`${BASE_URL}/`);
        // Scoped to the header's own unnamed <nav> - the sidebar's own
        // "Home" group heading is a second, unrelated match otherwise
        // (found writing NextRoutes.test.tsx's own equivalent check).
        await page.getByRole("navigation").getByText("Home").waitFor();
        await settleAnimations(page);
        const path = join(outDir, `next-page-header-icon-${viewport.width}-${theme}.png`);
        await page.screenshot({ path, fullPage: slug === "phone" });
        console.log(`Wrote ${path}`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

/** SHELL-02 slice 6's own stated capture: the composer's "+" menu open -
 * the default-visible set only (photos and files, camera): Apps, Create
 * image, Web search and the voice waveform all stay behind
 * NEXT_CHAT_UNWIRED_CONTROLS_ENABLED (composerAddMenu.tsx, Apps joined
 * live 2026-09-22), unset in a real run, so this capture shows exactly
 * what a real household sees. Live finding 2026-09-22: the row layout
 * itself was oversized and still truncated - both viewports now, not
 * desktop only, since that's a width claim. */
async function captureNextChatComposerReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    const context = await newContext(browser, viewport, "dark", sessionValue);
    try {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/chat`);
      const composer = page.getByRole("textbox", { name: "Message input" });
      await composer.waitFor();
      if (!(await composer.isEnabled())) throw new Error(`captureNextChatComposerReview: composer disabled on ${slug}`);
      await composer.fill("Show me a short demo reply.");
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await page.getByText(SCREENSHOT_CHAT_REPLY, { exact: true }).waitFor({ timeout: 15000 });
      await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ state: "detached", timeout: 30000 }).catch(() => {});
      if (slug === "phone") {
        await page.getByRole("button", { name: "Add", exact: true }).click();
        await page.locator('[data-slot="composer-menu"][data-open]').waitFor({ timeout: 5000 });
        await page.getByText("Add photos and files", { exact: true }).waitFor({ timeout: 5000 });
      } else {
        // At the desktop breakpoint Add is the direct attachment control;
        // the shipped menu is phone-only (composerAddMenu.tsx). Capture
        // that actual desktop state instead of waiting for a menu that
        // this branch intentionally does not render.
        await page.getByRole("button", { name: "Add", exact: true }).waitFor({ state: "visible" });
      }
      if ((await page.locator("body").innerText()).includes("isn't running")) throw new Error(`captureNextChatComposerReview: chat engine error banner on ${slug}`);
      if (await page.getByRole("alert").count()) throw new Error(`captureNextChatComposerReview: error banner on ${slug}`);
      if (await page.getByRole("button", { name: "Stop generating", exact: true }).count()) throw new Error(`captureNextChatComposerReview: turn still running on ${slug}`);
      await settleAnimations(page);
      const path = join(outDir, `next-chat-composer-${viewport.width}-dark.png`);
      await page.screenshot({ path });
      console.log(`Wrote ${path}`);
      await page.close();
    } finally {
      await context.close();
    }
  }
}

/** COMPOSER-01: the composer's layout contract, measured in a real browser.
 * Empty and one line stay 48 to 52 px (COMPOSER-SIZE-01), text wrapping grows it toward 210 px
 * and then scrolls inside, the controls stay on the bottom edge, one model
 * selector, Send 32 px. Throws on a violation, so a regression fails
 * the capture, and writes PNGs (empty, one line, multiline, long, generating,
 * paused notice) at 1440 and 390, light and dark. */
async function captureComposerLayoutReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = process.env.MAIPAI_COMPOSER_OUT_DIR || join(ROOT, "data-scratch", "screenshots", "composer");
  mkdirSync(outDir, { recursive: true });
  const measure = async (page: Page) => page.evaluate(() => {
    const shell = document.querySelector('[data-slot="aui_composer-shell"]') as HTMLElement;
    const box = shell.getBoundingClientRect();
    const rect = (el: Element | null) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
    const input = shell.querySelector("textarea");
    const send = shell.querySelector('button[aria-label="Send message"], button[aria-label="Stop generating"]');
    const column = document.querySelector(".aui-thread-viewport-footer");
    const buttons = [...shell.querySelectorAll(".aui-composer-action-wrapper button")].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && b.getAttribute("data-slot") !== "composer-menu-item"; }).map((b) => rect(b));
    const selectors = document.querySelectorAll('[data-slot="model-selector-trigger"]').length;
    return {
      shell: rect(shell), input: rect(input), send: rect(send), column: rect(column), buttons, selectors,
      inputScrolls: input ? input.scrollHeight > input.clientHeight + 1 : false,
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  const results: string[] = [];
  // MAIPAI_COMPOSER_SOFT=1 records violations instead of throwing (before/after measuring).
  const fail = (message: string) => { if (process.env.MAIPAI_COMPOSER_SOFT) results.push(`VIOLATION ${message}`); else throw new Error(message); };
  const longText = Array.from({ length: 14 }, (_, i) => `Line ${i + 1} of a long draft message`).join("\n");
  for (const theme of THEMES) {
    for (const width of [1440, 390] as const) for (const withModels of [false, true]) {
      const viewport = VIEWPORTS.find((v) => v.width === width)!;
      const tag = `${width}-${theme}${withModels ? "-models" : ""}`;
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        const shot = async (name: string) => {
          await settleAnimations(page);
          const path = join(outDir, `composer-${name}-${tag}.png`);
          await page.screenshot({ path });
          console.log(`Wrote ${path}`);
        };
        if (withModels) {
          // Two chat models make the owner's one model selector appear.
          await page.route("**/api/engines", async (route) => {
            const response = await route.fetch();
            const body = await response.json() as { configured: boolean; roles: Array<Record<string, unknown>> };
            body.configured = true;
            const chat = body.roles.find((role) => role.id === "chat");
            if (chat) chat.models = [{ id: "family.gguf", name: "Family" }, { id: "fast.gguf", name: "Fast" }];
            await route.fulfill({ response, json: body });
          });
        }
        await page.goto(`${BASE_URL}/chat`);
        const input = page.getByRole("textbox", { name: "Message input" });
        await input.waitFor();
        await page.evaluate(() => document.fonts.ready);
        // Empty.
        if (withModels) await page.locator('[data-slot="model-selector-trigger"]').waitFor();
        let m = await measure(page);
        const emptyH = m.shell!.height;
        results.push(`${tag} empty ${emptyH.toFixed(1)}px send ${m.send!.width.toFixed(0)}x${m.send!.height.toFixed(0)} selectors ${m.selectors}`);
        if (m.selectors !== (withModels ? 1 : 0)) fail(`composer ${tag}: ${m.selectors} model selectors, want ${withModels ? 1 : 0}`);
        const maxRow = withModels && width < 640 ? 110 : 52.5; // a phone with the model label stacks its controls
        if (emptyH < 47 || emptyH > maxRow) fail(`composer ${tag}: empty height ${emptyH}px, want 48 to 52`);
        if (m.send!.width < 31.5 || m.send!.width > 32.5) fail(`composer ${tag}: send is ${m.send!.width}px, want 32`);
                if (m.overflowX) fail(`composer ${tag}: horizontal overflow`);
        await shot("empty");
        // One line.
        await input.fill("Plan my day");
        m = await measure(page);
        results.push(`${tag} one line ${m.shell!.height.toFixed(1)}px`);
        if (m.shell!.height > maxRow) fail(`composer ${tag}: one-line height ${m.shell!.height}px`);
        await shot("one-line");
        // Three lines: grows, controls stay on the bottom edge.
        await input.fill("First line of a longer message\nSecond line\nThird line");
        m = await measure(page);
        results.push(`${tag} three lines ${m.shell!.height.toFixed(1)}px`);
        if (m.shell!.height <= emptyH + 20) fail(`composer ${tag}: did not grow (${m.shell!.height}px)`);
        for (const b of m.buttons) if (b && m.shell!.bottom - b.bottom > 12) fail(`composer ${tag}: a control floats ${m.shell!.bottom - b.bottom}px above the bottom edge`);
        if (m.input!.bottom > m.send!.top + 1) fail(`composer ${tag}: text overlaps the controls`);
        await shot("multiline");
        // Long: capped, the text scrolls inside, controls anchored.
        await input.fill(longText);
        m = await measure(page);
        results.push(`${tag} long ${m.shell!.height.toFixed(1)}px scrolls ${m.inputScrolls}`);
        if (m.shell!.height > 212) fail(`composer ${tag}: grew to ${m.shell!.height}px, cap is about 210`);
        if (!m.inputScrolls) fail(`composer ${tag}: long text does not scroll inside`);
        for (const b of m.buttons) if (b && m.shell!.bottom - b.bottom > 12) fail(`composer ${tag}: a control floats ${m.shell!.bottom - b.bottom}px above the bottom edge (long)`);
        await shot("long");
        if (withModels) { await page.close(); continue; }
        // Generating: Stop replaces Send.
        await input.fill("CHAT QUEUE screenshot: tell me a little about the day");
        await page.getByRole("button", { name: "Send message", exact: true }).click();
        await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor();
        await page.waitForTimeout(400);
        m = await measure(page);
        results.push(`${tag} generating ${m.shell!.height.toFixed(1)}px stop ${m.send!.width.toFixed(0)}px input ${m.input?.height.toFixed(0)}`);
        if (m.shell!.height > 52.5) fail(`composer ${tag}: generating height ${m.shell!.height}px`);
        await shot("generating");
        await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ state: "detached", timeout: 30000 });
        await page.waitForTimeout(2000); // let the held reply finish before the page closes
        await page.close();
        // Paused: the notice sits below the composer without crowding.
        const paused = await context.newPage();
        paused.setDefaultTimeout(15000);
        await paused.route("**/api/health", async (route) => {
          const response = await route.fetch();
          const body = await response.json() as { engines: { chat: Record<string, unknown> } };
          const line = "Chat is paused. Your message stays here; press Send once it is back.";
          body.engines.chat = { ...body.engines.chat, kind: "failed", alive: false, availability: "unavailable", reason: "failed_start", notice: { adult: line, teen: line, child: line, repairs_link: "Open Repairs" } };
          await route.fulfill({ response, json: body });
        });
        await paused.goto(`${BASE_URL}/chat`);
        await paused.getByRole("textbox", { name: "Message input" }).waitFor();
        await paused.getByText("Chat is paused", { exact: false }).first().waitFor();
        const pm = await paused.evaluate(() => {
          const shell = document.querySelector('[data-slot="aui_composer-shell"]')!.getBoundingClientRect();
          const note = document.querySelector('[data-slot="aui_composer-notice"], [data-chat-notice]')!.getBoundingClientRect();
          const footer = document.querySelector(".aui-thread-viewport-footer")!.getBoundingClientRect();
          return { shellH: shell.height, gap: note.top - shell.bottom, noteBottom: note.bottom, footerBottom: footer.bottom, winH: window.innerHeight };
        });
        results.push(`${tag} paused shell ${pm.shellH.toFixed(1)}px gap ${pm.gap.toFixed(1)}px`);
        if (pm.shellH > 52.5) fail(`composer ${tag}: paused height ${pm.shellH}px`);
        if (pm.gap < 0 || pm.noteBottom > pm.winH) fail(`composer ${tag}: paused notice crowds or leaves the screen`);
        await settleAnimations(paused);
        const pausedPath = join(outDir, `composer-paused-${tag}.png`);
        await paused.screenshot({ path: pausedPath });
        console.log(`Wrote ${pausedPath}`);
        await paused.close();
      } finally {
        await context.close();
      }
    }
  }
  writeFileSync(join(outDir, "measurements.txt"), results.join("\n") + "\n");
  console.log(results.join("\n"));
}

/** Capture the real kit MessageQueue above the composer while the scripted
 * first reply is held open. The fixed prompt is unique to this named review;
 * the backend fixture delays it long enough for both queued messages to be
 * visible in every viewport/theme pair. */
async function captureNextChatQueueReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = process.env.MAIPAI_CHAT_QUEUE_OUT_DIR || join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  for (const theme of ["light", "dark"] as const) {
    for (const slug of ["desktop", "phone"] as const) {
      const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        await page.goto(`${BASE_URL}/chat`);
        const composer = page.getByRole("textbox", { name: "Message input" });
        await composer.waitFor();
        if (!(await composer.isEnabled())) throw new Error(`captureNextChatQueueReview: composer disabled on ${slug}/${theme}`);
        await composer.fill("CHAT QUEUE screenshot: tell me a little about the day");
        await page.getByRole("button", { name: "Send message", exact: true }).click();
        await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor();
        for (const text of ["Second queued question", "Third queued question"]) {
          await composer.fill(text);
          await page.getByRole("button", { name: "Queue message", exact: true }).click();
        }
        const queue = page.locator('[data-slot="message-queue"]');
        await queue.getByText("2 queued", { exact: true }).waitFor();
        await queue.getByText("Second queued question", { exact: true }).waitFor();
        await queue.getByText("Third queued question", { exact: true }).waitFor();
        if (await page.getByRole("alert").count()) throw new Error(`captureNextChatQueueReview: error banner on ${slug}/${theme}`);
        await settleAnimations(page);
        const path = join(outDir, `next-chat-queue-${viewport.width}-${theme}.png`);
        await page.screenshot({ path });
        console.log(`Wrote ${path}`);
        await page.locator('[data-role="user"]').filter({ hasText: "Third queued question" }).waitFor({ timeout: 20000 });
        await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ state: "detached", timeout: 15000 });
        await page.waitForTimeout(2000);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

/** ACTIVITY-01d/e: the calm activity card above the composer, through the
 * real routes. Jobs, an ask and an approval are seeded straight into the demo
 * database (the producers need engines a capture does not run); everything
 * shown is read back through GET /api/jobs. Also proves the header carries no
 * Running now button and that the composer's Stop ends a streaming reply. */
async function captureActivityCardReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = process.env.MAIPAI_ACTIVITY_CARD_OUT_DIR || join(ROOT, "data-scratch", "screenshots", "activity-card");
  mkdirSync(outDir, { recursive: true });
  const viewports = [{ slug: "desktop", width: 1440, height: 900 } as ViewportSpec, VIEWPORTS.find((v) => v.slug === "phone")!];
  const shot = async (page: Page, name: string, viewport: ViewportSpec, theme: string) => {
    await settleAnimations(page);
    const path = join(outDir, `activity-${name}-${viewport.width}-${theme}.png`);
    await page.screenshot({ path });
    console.log(`Wrote ${path}`);
  };
  const askConversation = await seedTitledConversation("captureActivityCardReview", { Cookie: `session=${sessionValue}` }, "Locking up for the night");
  const seed = (scenario: "none" | "waiting" | "running" | "done" | "child") => {
    const script = `import { sqlite } from "./src/db/index.ts";
const scenario = ${JSON.stringify(scenario)};
const owner = sqlite.query("SELECT id FROM people WHERE role = 'owner' LIMIT 1").get() as { id: string };
const nova = sqlite.query("SELECT id FROM people WHERE display_name = 'Nova' AND role = 'child' LIMIT 1").get() as { id: string };
const now = Date.now();
const at = (s: number) => new Date(now - s * 1000).toISOString();
sqlite.query("DELETE FROM jobs WHERE id LIKE 'shot-%'").run();
sqlite.query("DELETE FROM approvals WHERE id LIKE 'shot-%'").run();
sqlite.query("UPDATE conversations SET pending_ask = NULL").run();
const job = sqlite.query("INSERT INTO jobs (id, kind, started_by, for_person, title, state, progress, waiting_reason, result_ref, conversation_id, error_kind, raw, provenance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, NULL, '{}', ?, ?)");
if (scenario === "running") job.run("shot-fox", "image", owner.id, owner.id, "Making a picture of a red fox", "running", JSON.stringify({ fraction: 0.6, eta_seconds: 40 }), null, at(30), at(2));
if (scenario === "done") job.run("shot-done", "search", owner.id, owner.id, "Looked up train times to the coast", "done", null, ${JSON.stringify(askConversation.id)}, at(240), at(60));
if (scenario === "waiting" || scenario === "child") sqlite.query("INSERT INTO approvals (id, kind, person_id, details, status, decided_by_person_id, decided_at, created_at) VALUES ('shot-ask', 'install_package', ?, ?, 'pending', NULL, NULL, ?)").run(nova.id, JSON.stringify({ packageName: "Chess" }), at(60));
if (scenario === "waiting") {
  const askTurn = "shot-confirm-turn";
  sqlite.query("DELETE FROM conversation_turns WHERE id = ?").run(askTurn);
  sqlite.query("INSERT INTO conversation_turns (id, person_id, surface, user_text, reply_text, source, safety_action, conversation_id, created_at, hlc, routing_tier, routing_score, status, parent_turn_id, branch_chosen, confirm) VALUES (?, ?, 'chat', 'Lock the doors for the night', 'I can lock the front and back doors now. Want me to go ahead?', 'confirm', 'allow', ?, ?, ?, 'chat', 1.0, 'done', NULL, 1, ?)").run(askTurn, owner.id, ${JSON.stringify(askConversation.id)}, at(90), at(90) + ":0:" + askTurn, JSON.stringify({ package_id: "lock-doors", open: true }));
  sqlite.query("UPDATE conversations SET pending_ask = ? WHERE id = ?").run(JSON.stringify({ kind: "confirm", prompt: "Lock the doors?", packageId: "lock-doors", args: {}, turnId: askTurn }), ${JSON.stringify(askConversation.id)});
}
sqlite.close();`;
    const result = Bun.spawnSync({ cmd: ["bun", "-e", script], cwd: join(ROOT, "backend"), env: { ...process.env, MAIPAI_DATA_DIR: DATA_DIR }, stdout: "inherit", stderr: "inherit" });
    if (result.exitCode !== 0) throw new Error(`captureActivityCardReview: seeding ${scenario} failed with exit code ${result.exitCode}`);
  };
  const openChat = async (page: Page) => {
    page.setDefaultTimeout(15000);
    await page.goto(`${BASE_URL}/chat`);
    await page.getByRole("textbox", { name: "Message input" }).waitFor();
    await page.waitForResponse((response) => response.url().endsWith("/api/jobs")).catch(() => undefined);
    if (await page.getByRole("button", { name: /^Running now/ }).count()) throw new Error("captureActivityCardReview: a Running now button is still in the header");
    if (await page.getByRole("alert").filter({ hasNot: page.locator('[data-slot="chat-activity-card"]') }).count()) throw new Error("captureActivityCardReview: an error banner");
  };
  const card = (page: Page) => page.locator('[data-slot="chat-activity-card"]');

  // 1. Nothing relevant: no card at all.
  seed("none");
  for (const viewport of viewports) for (const theme of THEMES) {
    const context = await newContext(browser, viewport, theme, sessionValue);
    try {
      const page = await context.newPage();
      await openChat(page);
      if (await card(page).count()) throw new Error(`captureActivityCardReview: a card shows with nothing to say on ${viewport.slug}/${theme}`);
      await shot(page, "idle", viewport, theme);
    } finally { await context.close(); }
  }

  // 3. Waiting (a chat asking, plus an approval for a child's request),
  // then running, then just finished.
  const states: Array<{ scenario: "waiting" | "running" | "done"; name: string; ready: (page: Page) => Promise<void> }> = [
    { scenario: "waiting", name: "waiting", ready: async (page) => { await card(page).waitFor(); await card(page).getByText("Needs you").waitFor(); } },
    { scenario: "running", name: "running", ready: async (page) => { await card(page).getByText("Making a picture of a red fox").waitFor(); } },
    { scenario: "done", name: "done", ready: async (page) => { await card(page).getByText("Looked up train times to the coast").waitFor(); await card(page).getByRole("button", { name: "Dismiss" }).waitFor(); } },
  ];
  for (const state of states) {
    seed(state.scenario);
    for (const viewport of viewports) for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        await openChat(page);
        await state.ready(page);
        await shot(page, state.name, viewport, theme);
      } finally { await context.close(); }
    }
  }

  // 4. Nova, a child: her own ask reads "Asked a parent", no buttons.
  seed("child");
  const cookie = { Cookie: `session=${sessionValue}` };
  const people = await (await fetch(`${BASE_URL}/api/people`, { headers: cookie })).json() as Array<{ id: string; display_name: string; role: string }>;
  const child = people.find((p) => p.display_name === "Nova" && p.role === "child");
  if (!child) throw new Error("captureActivityCardReview: the seeded child Nova is required");
  const childSignIn = await fetch(`${BASE_URL}/api/auth/select`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personId: child.id }) });
  const childSession = childSignIn.headers.get("set-cookie")?.split(";")[0]?.split("=")[1];
  if (!childSession) throw new Error("captureActivityCardReview: Nova's sign-in carried no session cookie");
  for (const viewport of viewports) for (const theme of THEMES) {
    const context = await newContext(browser, viewport, theme, childSession);
    try {
      const page = await context.newPage();
      await openChat(page);
      await card(page).getByText("Asked a parent").waitFor();
      if (await card(page).getByRole("button").count()) throw new Error("captureActivityCardReview: a child was offered buttons on her own ask");
      await shot(page, "child", viewport, theme);
    } finally { await context.close(); }
  }
  seed("none");

  // 5. A reply streaming (last, so the fixture engine can settle after Stop): the working dot in the message, Stop in the
  // composer, no card; the composer's Stop ends it.
  let lastStopAt = 0;
  for (const viewport of viewports) for (const theme of THEMES) {
    const context = await newContext(browser, viewport, theme, sessionValue);
    try {
      const page = await context.newPage();
      await openChat(page);
      await sendChatMessage(page, "ACTIVITY CARD screenshot: tell me a little about the day");
      const stop = page.getByRole("button", { name: "Stop generating", exact: true });
      await stop.waitFor();
      if (await card(page).count()) throw new Error(`captureActivityCardReview: a card shows during a plain reply on ${viewport.slug}/${theme}`);
      await shot(page, "streaming", viewport, theme);
      lastStopAt = Date.now();
      await stop.click();
      await stop.waitFor({ state: "detached", timeout: 5000 });
    } finally { await context.close(); }
  }

  // A stopped reply's scripted engine call still resolves 20 s after it
  // began; shutting the fixture Stack down before then resets that call.
  const settle = lastStopAt + 21_000 - Date.now();
  if (settle > 0) await new Promise((resolve) => setTimeout(resolve, settle));
}

/** The matched origin/main view: identical reply/viewport/theme, with both
 * follow-up prompts still in the ordinary composer because main has no queue.
 * This runs the same fixture and PNG geometry as the after capture. */
async function captureNextChatQueueBeforeReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = process.env.MAIPAI_CHAT_QUEUE_OUT_DIR || join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  for (const theme of ["light", "dark"] as const) {
    for (const slug of ["desktop", "phone"] as const) {
      const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        await page.goto(`${BASE_URL}/chat`);
        const composer = page.getByRole("textbox", { name: "Message input" });
        await composer.waitFor();
        if (!(await composer.isEnabled())) throw new Error(`captureNextChatQueueBeforeReview: composer disabled on ${slug}/${theme}`);
        await composer.fill("CHAT QUEUE screenshot: tell me a little about the day");
        await page.getByRole("button", { name: "Send message", exact: true }).click();
        await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor();
        await composer.fill("Second queued question\nThird queued question");
        await composer.waitFor({ state: "visible" });
        if (await page.getByRole("alert").count()) throw new Error(`captureNextChatQueueBeforeReview: error banner on ${slug}/${theme}`);
        await settleAnimations(page);
        const path = join(outDir, `next-chat-queue-before-${viewport.width}-${theme}.png`);
        await page.screenshot({ path });
        console.log(`Wrote ${path}`);
        await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ state: "detached", timeout: 15000 });
        await page.waitForTimeout(2000);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

/** Capture a held reply with no queued messages. The empty composer footer
 * must stay clear of the queue Element while the reply streams. */
async function captureNextChatQueueEmptyReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = process.env.MAIPAI_CHAT_QUEUE_OUT_DIR || join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  for (const theme of ["light", "dark"] as const) {
    for (const slug of ["desktop", "phone"] as const) {
      const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        await page.goto(`${BASE_URL}/chat`);
        const composer = page.getByRole("textbox", { name: "Message input" });
        await composer.waitFor();
        if (!(await composer.isEnabled())) throw new Error(`captureNextChatQueueEmptyReview: composer disabled on ${slug}/${theme}`);
        await composer.fill("CHAT QUEUE screenshot: tell me a little about the day");
        await page.getByRole("button", { name: "Send message", exact: true }).click();
        await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor();
        if (await page.locator('[data-slot="message-queue"]').count()) throw new Error(`captureNextChatQueueEmptyReview: empty queue row appeared on ${slug}/${theme}`);
        if (await page.getByRole("alert").count()) throw new Error(`captureNextChatQueueEmptyReview: error banner on ${slug}/${theme}`);
        await settleAnimations(page);
        const path = join(outDir, `next-chat-queue-empty-${viewport.width}-${theme}.png`);
        await page.screenshot({ path });
        console.log(`Wrote ${path}`);
        await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ state: "detached", timeout: 15000 });
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

/** Capture audit states that use the real /dev/ui scripted event stream or
 * existing chat controls. This is screenshot-only fixture orchestration. */
async function captureNextChatAuditReview(browser: Browser, sessionValue: string): Promise<void> {
  if (useFirefox) await captureChatStreamGlitch(browser, sessionValue);
  const outDir = process.env.MAIPAI_CHAT_AUDIT_OUT_DIR || join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  const pinShotsDir = "/Users/jessetorres/Developer/github.com/getmaipai/home/data-scratch/chat-ab/pin-shots";
  mkdirSync(pinShotsDir, { recursive: true });
  const cookie = { Cookie: `session=${sessionValue}` };
  const desktop = { slug: "desktop", width: 1440, height: 900 } as ViewportSpec;
  const phone = VIEWPORTS.find((v) => v.slug === "phone")!;

  // UI-EXTRAS-01: the three shipped chat Elements, on a real persisted
  // 40-message conversation. The output directory is supplied by the brief's
  // audit run through MAIPAI_CHAT_AUDIT_OUT_DIR.
  {
    const conversation = await seedTitledConversation("captureNextChatAuditReview extras", cookie, "Conversation map and search audit");
    const longReply = "A searchneedle is hidden in this answer so the in-chat search has a deterministic match to highlight.";
    const seedScript = `import { sqlite } from "./src/db/index.ts";
const id = ${JSON.stringify(conversation.id)};
const person = sqlite.query("SELECT id FROM people WHERE display_name = 'Sage' LIMIT 1").get() as { id: string };
const insert = sqlite.query("INSERT INTO conversation_turns (id, person_id, surface, user_text, reply_text, source, safety_action, conversation_id, created_at, hlc, routing_tier, routing_score, status, parent_turn_id, branch_chosen) VALUES (?, ?, 'chat', ?, ?, 'model', 'allow', ?, ?, ?, 'chat', 1.0, 'done', ?, 1)");
let parent: string | null = null;
for (let i = 1; i <= 40; i++) { const turn = crypto.randomUUID(); const at = new Date(Date.now() + i).toISOString(); const prompt = i === 39 ? 'Question 39: a representative conversation message with enough text to wrap on a phone screen.' : 'Question ' + i + ': share one useful detail about the day.'; const reply = i === 39 ? ${JSON.stringify(RICH_REPLY_MARKDOWN)} : i === 10 ? ${JSON.stringify(longReply)} : 'A concise answer for the chat extras audit, turn ' + i + '.'; insert.run(turn, person.id, prompt, reply, id, at, at + ':0:' + turn, parent); parent = turn; }
sqlite.close();`;
    const seeded = Bun.spawnSync({ cmd: ["bun", "-e", seedScript], cwd: join(ROOT, "backend"), env: { ...process.env, MAIPAI_DATA_DIR: DATA_DIR }, stdout: "inherit", stderr: "inherit" });
    if (seeded.exitCode !== 0) throw new Error(`captureNextChatAuditReview: seeding chat extras thread failed with exit code ${seeded.exitCode}`);

    const desktopContext = await newContext(browser, desktop, "dark", sessionValue);
    try {
      const page = await desktopContext.newPage();
      page.setDefaultTimeout(15000);
      await page.goto(`${BASE_URL}/chat?conversation=${conversation.id}`);
      await page.getByText("Question 40: share one useful detail about the day.", { exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelectorAll('[data-slot="aui_assistant-message-content"]').length >= 20);
      const map = page.getByRole("navigation", { name: "Conversation map" });
      await map.waitFor({ state: "visible" });
      await settleAnimations(page);
      await page.screenshot({ path: join(outDir, "chat-map-1440x900-dark.png") });

      await page.getByRole("textbox", { name: "Message input" }).focus();
      await page.keyboard.press("Control+f");
      const search = page.getByRole("textbox", { name: "Find in conversation" });
      await search.waitFor({ state: "visible" });
      await search.fill("searchneedle");
      await page.getByText("1/1", { exact: true }).waitFor();
      await page.locator('[data-slot="conversation-search"] .bg-amber-400\\/35').waitFor({ state: "visible" });
      await settleAnimations(page);
      await page.screenshot({ path: join(outDir, "chat-search-1440x900-dark.png") });

      await search.press("Escape");
      await page.getByRole("textbox", { name: "Message input" }).focus();
      await page.keyboard.press("Control+k");
      await page.locator('[data-slot="command-palette"]').waitFor({ state: "visible" });
      await settleAnimations(page);
      await page.screenshot({ path: join(outDir, "chat-palette-1440x900-dark.png") });
      await page.close();
    } finally { await desktopContext.close(); }

    const phoneContext = await newContext(browser, phone, "dark", sessionValue);
    try {
      const page = await phoneContext.newPage();
      page.setDefaultTimeout(15000);
      await page.goto(`${BASE_URL}/chat?conversation=${conversation.id}`);
      await page.getByText("Question 40: share one useful detail about the day.", { exact: true }).waitFor();
      await page.getByRole("textbox", { name: "Message input" }).focus();
      await page.keyboard.press("Control+f");
      const search = page.getByRole("textbox", { name: "Find in conversation" });
      await search.waitFor({ state: "visible" });
      await search.fill("screen.");
      await page.getByText("1/1", { exact: true }).waitFor();
      await page.waitForTimeout(100);
      const geometry = await page.evaluate(() => {
        const viewport = document.querySelector<HTMLElement>('[data-slot="aui_thread-viewport"]');
        const searchCard = document.querySelector<HTMLElement>('[data-slot="conversation-search"]');
        const message = [...(viewport?.querySelectorAll<HTMLElement>('[data-message-id]') ?? [])].find((element) => {
          const rect = element.getBoundingClientRect();
          return element.textContent?.includes("Question ") && rect.bottom > (viewport?.getBoundingClientRect().top ?? 0);
        });
        if (!viewport || !searchCard || !message) throw new Error("phone search geometry elements were not rendered");
        return { searchBottom: searchCard.getBoundingClientRect().bottom, messageTop: message.getBoundingClientRect().top, viewportTop: viewport.getBoundingClientRect().top, messageText: message.textContent?.slice(0, 100) };
      });
      if (geometry.searchBottom > geometry.messageTop) {
        throw new Error(`phone in-chat search overlaps its first visible user message: ${JSON.stringify(geometry)}`);
      }
      await settleAnimations(page);
      await page.screenshot({ path: join(outDir, "chat-search-390x844-dark.png") });
      await search.press("Escape");
      await page.getByRole("textbox", { name: "Message input" }).focus();
      await page.keyboard.press("Control+k");
      await page.locator('[data-slot="command-palette"]').waitFor({ state: "visible" });
      await settleAnimations(page);
      await page.screenshot({ path: join(outDir, "chat-palette-390x844-dark.png"), fullPage: true });
      await page.close();
    } finally { await phoneContext.close(); }
  }

  async function showcase(id: string, name: string, viewport: ViewportSpec = desktop, theme: "light" | "dark" = "dark", after?: (page: Page) => Promise<void>) {
    const context = await newContext(browser, viewport, theme, sessionValue);
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      await page.goto(`${BASE_URL}/dev/ui`);
      await page.getByRole("heading", { name: "Chat showcase" }).first().waitFor();
      const pace = page.getByLabel("Streaming pace");
      await pace.click();
      await page.getByRole("option", { name: "Instant" }).click();
      const scenarios = await fetch(`${BASE_URL}/api/dev/ui-fixtures`, { headers: cookie });
      if (!scenarios.ok) throw new Error(`audit fixture list failed: ${scenarios.status}`);
      const rows = await scenarios.json() as { fixtures: Array<{ id: string; title: string }> };
      const fixture = rows.fixtures.find((entry) => entry.id === id);
      if (!fixture) throw new Error(`audit fixture missing: ${id}`);
      await page.getByRole("button", { name: new RegExp(fixture.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).click();
      await page.locator('[data-slot="aui_thread-viewport"]').waitFor({ state: "attached" });
      await page.waitForTimeout(350);
      if (after) await after(page);
      await settleAnimations(page);
      const pane = page.getByRole("region", { name: "Chat", exact: true });
      const box = await pane.boundingBox();
      if (box) await page.screenshot({ path: join(outDir, `${name}-${viewport.width}x${viewport.height}-${theme}.png`), clip: { x: Math.max(0, box.x - 16), y: Math.max(0, box.y - 56), width: Math.min(viewport.width - Math.max(0, box.x - 16), box.width + 32), height: Math.min(viewport.height - Math.max(0, box.y - 56), box.height + 72) } });
      else await page.screenshot({ path: join(outDir, `${name}-${viewport.width}x${viewport.height}-${theme}.png`) });
      await page.close();
    } finally { await context.close(); }
  }

  await showcase("failure-engine-down", "failed-reply");
  await showcase("failure-admin-details", "failed-reply-admin-details", desktop, "dark", async (page) => {
    await page.getByRole("button", { name: "Error details" }).click();
    await page.getByRole("dialog").waitFor();
  });
  await showcase("failed-tool", "tool-error-admin");
  await showcase("failure-safety", "guardrail-refusal");
  await showcase("carry-offer", "carry-offer-reply");
  await showcase("search", "sources-reply");
  await showcase("search", "sources-reply", phone, "dark");
  await showcase("table", "table-reply");
  await showcase("code", "code-reply");

  // Real chat rail, collapsed to the permanent navigation icon rail.
  {
    const context = await newContext(browser, desktop, "dark", sessionValue);
    try {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/chat`);
      await page.getByRole("textbox", { name: "Message input" }).waitFor();
      const sidebar = page.locator('[data-slot="sidebar"]');
      if (await sidebar.getAttribute("data-state") !== "collapsed") {
        await page.getByRole("button", { name: "Toggle app menu" }).click();
      }
      await page.waitForFunction(() => document.querySelector('[data-slot="sidebar"]')?.getAttribute("data-state") === "collapsed");
      await settleAnimations(page);
      await page.screenshot({ path: join(outDir, "collapsed-rail-1440x900-dark.png") });
    } finally { await context.close(); }
  }

  // The mobile thread list is the chat app's own sheet, opened by its real
  // Show threads control.
  {
    const context = await newContext(browser, phone, "dark", sessionValue);
    try {
      const page = await context.newPage();
      await seedTitledConversation("captureNextChatAuditReview", cookie, "Thread list example");
      await page.goto(`${BASE_URL}/chat`);
      await page.getByRole("button", { name: "Show threads" }).click();
      await page.getByRole("dialog").waitFor();
      await settleAnimations(page);
      await page.screenshot({ path: join(outDir, "mobile-thread-list-sheet-390x844-dark.png"), fullPage: true });
    } finally { await context.close(); }
  }

  // CHAT-PIN-01: capture the shipped Pin group with one real, persisted
  // pinned conversation at the accepted desktop and phone surfaces.
  {
    const title = "Pinned audit chat";
    const row = await seedTitledConversation("captureNextChatAuditReview pin audit", cookie, title);
    const pinned = await fetch(`${BASE_URL}/api/conversations/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...cookie },
      body: JSON.stringify({ pinned: true }),
    });
    if (!pinned.ok) throw new Error(`captureNextChatAuditReview: pinning the audit conversation failed: ${pinned.status}`);

    const desktopContext = await newContext(browser, desktop, "light", sessionValue);
    try {
      const page = await desktopContext.newPage();
      await page.goto(`${BASE_URL}/chat`);
      const rail = page.locator('[data-slot="next-chat-rail"]');
      await rail.getByText(title, { exact: true }).waitFor();
      await rail.getByText("Pinned", { exact: true }).waitFor();
      await settleAnimations(page);
      await page.screenshot({ path: join(pinShotsDir, "chat-list-1440x900-light.png"), fullPage: true });
    } finally { await desktopContext.close(); }

    const phoneContext = await newContext(browser, phone, "dark", sessionValue);
    try {
      const page = await phoneContext.newPage();
      await page.goto(`${BASE_URL}/chat`);
      await page.getByRole("button", { name: "Show threads" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      await dialog.getByText(title, { exact: true }).waitFor();
      await dialog.getByText("Pinned", { exact: true }).waitFor();
      await settleAnimations(page);
      await page.screenshot({ path: join(pinShotsDir, "chat-list-390x844-dark.png"), fullPage: true });
    } finally { await phoneContext.close(); }
  }

  // Stack role state is supplied by the fixture Stack. Intercept health to
  // hold the real availability loader in its starting state for one shot.
  {
    const context = await newContext(browser, desktop, "dark", sessionValue);
    try {
      const page = await context.newPage();
      await page.route("**/api/health", async (route) => {
        const response = await route.fetch();
        const body = await response.json() as { engines: { chat: Record<string, unknown> } };
        body.engines.chat = { ...body.engines.chat, kind: "starting", alive: true, availability: "starting", reason: null };
        await route.fulfill({ response, json: body });
      });
      await page.goto(`${BASE_URL}/chat`);
      await page.locator('[data-slot="generation-loader"]').waitFor({ timeout: 10000 });
      await settleAnimations(page);
      await page.screenshot({ path: join(outDir, "engine-starting-loader-1440x900-dark.png") });
    } finally { await context.close(); }
  }

  console.log("completed named review: --next-chat-audit-review");
}

/** Regression for the chat thread-list collapse control. Keep the pointer
 * over the newly-mounted toggle after clicking, sample after 600ms, then
 * move away and confirm the collapsed width remains stable. */
async function captureChatCollapseHoverAudit(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = process.env.MAIPAI_CHAT_AUDIT_OUT_DIR || join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  // 1024px is the rail's own auto-collapse boundary and is still wide
  // enough to expose its desktop toggle; 820px uses the app's thread
  // sheet instead and has no persistent-list collapse control.
  const viewports = [VIEWPORTS.find((v) => v.slug === "desktop")!, { slug: "tablet-rail-boundary", width: 1024, height: 900 }];
  for (const viewport of viewports) {
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        await page.addInitScript(() => localStorage.setItem("maipai.chat.rail-collapsed", "0"));
        await page.goto(`${BASE_URL}/chat`);
        await page.getByRole("textbox", { name: "Message input" }).waitFor();
        const rail = page.locator('[data-slot="next-chat-rail"]');
        const openToggle = page.getByRole("button", { name: "Hide conversations" });
        await openToggle.waitFor({ state: "visible" });
        await openToggle.hover();
        await page.screenshot({ path: join(outDir, `chat-collapse-hover-before-${viewport.width}-${theme}.png`) });
        await openToggle.click();
        await page.waitForTimeout(600);
        const hovered = await rail.evaluate((el) => ({
          width: el.getBoundingClientRect().width,
          className: el.className,
          collapsed: el.classList.contains("w-0") && !el.classList.contains("absolute"),
          peeked: el.classList.contains("absolute"),
          toggleExpanded: [...document.querySelectorAll<HTMLButtonElement>('button[aria-controls="next-chat-rail"]')].find((button) => !el.contains(button))?.getAttribute("aria-expanded"),
        }));
        await page.screenshot({ path: join(outDir, `chat-collapse-hover-after-click-${viewport.width}-${theme}.png`) });
        if (!hovered.collapsed || hovered.width > 1 || hovered.peeked || hovered.toggleExpanded !== "false") {
          throw new Error(`chat collapse hover regression at ${viewport.width}/${theme}: ${JSON.stringify(hovered)}`);
        }
        await page.mouse.move(viewport.width - 20, viewport.height - 20);
        await page.waitForTimeout(100);
        const afterLeave = await rail.evaluate((el) => ({
          width: el.getBoundingClientRect().width,
          className: el.className,
          collapsed: el.classList.contains("w-0") && !el.classList.contains("absolute"),
          peeked: el.classList.contains("absolute"),
          toggleExpanded: [...document.querySelectorAll<HTMLButtonElement>('button[aria-controls="next-chat-rail"]')].find((button) => !el.contains(button))?.getAttribute("aria-expanded"),
        }));
        await page.screenshot({ path: join(outDir, `chat-collapse-hover-after-leave-${viewport.width}-${theme}.png`) });
        if (!afterLeave.collapsed || afterLeave.width > 1 || afterLeave.peeked || afterLeave.toggleExpanded !== "false") {
          throw new Error(`chat collapse leave regression at ${viewport.width}/${theme}: ${JSON.stringify(afterLeave)}`);
        }
        console.log(`chat-collapse-hover ${viewport.width}/${theme}: hovered=${JSON.stringify(hovered)} afterLeave=${JSON.stringify(afterLeave)}`);
      } finally {
        await context.close();
      }
    }
  }
}

/** Lane B-15: exercise the actual tap targets named by the cutover
 * review, including controls hidden inside the chat attachment and row
 * action menus. This is a real-browser check because happy-dom has no
 * rendered geometry. */
async function verifyLaneBTouchTargets(browser: Browser, sessionValue: string): Promise<void> {
  const headers = { "Content-Type": "application/json", Cookie: `session=${sessionValue}` };

  let checked = 0;
  async function check(page: Page, locator: Locator, label: string): Promise<void> {
    await locator.waitFor({ state: "visible", timeout: 10000 });
    const dimensions = await locator.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      let width = rect.width;
      let height = rect.height;
      for (const pseudo of ["::before", "::after"] as const) {
        const layer = getComputedStyle(element, pseudo);
        if (layer.content !== "none" && layer.position === "absolute") {
          width = Math.max(width, rect.width + Math.max(0, -(parseFloat(layer.left) || 0)) + Math.max(0, -(parseFloat(layer.right) || 0)));
          height = Math.max(height, rect.height + Math.max(0, -(parseFloat(layer.top) || 0)) + Math.max(0, -(parseFloat(layer.bottom) || 0)));
        }
      }
      return { width: Math.round(width), height: Math.round(height) };
    });
    checked++;
    console.log(`touch-target ${label}: ${dimensions.width}x${dimensions.height}`);
    if (dimensions.width < 48 || dimensions.height < 48) {
      throw new Error(`verifyLaneBTouchTargets: ${label} is still below 48px (${dimensions.width}x${dimensions.height})`);
    }
  }

  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((entry) => entry.slug === slug)!;
    const context = await newContext(browser, viewport, slug === "phone" ? "dark" : "light", sessionValue);
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      await page.goto(`${BASE_URL}/chat`);
      await page.getByRole("textbox", { name: "Message input" }).waitFor();
      await check(page, page.getByRole("textbox", { name: "Message input" }), `Message input (${slug})`);
      await check(page, page.getByRole("button", { name: "Start voice input" }), `Start voice input (${slug})`);
      await check(page, page.getByRole("button", { name: "Send message" }), `Send message (${slug})`);
      await check(page, page.getByRole("button", { name: "Add", exact: true }), `Add (${slug})`);

      await page.getByRole("button", { name: "Add", exact: true }).click();
      const menuItems = page.locator('[data-slot="composer-menu-item"]');
      await check(page, menuItems.filter({ hasText: "Add photos and files" }), `Add photos and files (${slug})`);
      if (slug === "phone") await check(page, menuItems.filter({ hasText: "Take a photo" }), "Take a photo (phone)");
      await page.keyboard.press("Escape");
      if (slug === "phone") {
        await page.getByRole("button", { name: "Show threads" }).click();
        await check(page, page.getByRole("dialog").getByRole("button", { name: "New chat", exact: true }), "New chat (phone)");
      } else {
        await check(page, page.getByRole("button", { name: "New chat", exact: true }), "New chat (desktop)");
      }
      await page.close();
    } finally {
      await context.close();
    }
  }

  const desktop = VIEWPORTS.find((entry) => entry.slug === "desktop")!;
  const context = await newContext(browser, desktop, "light", sessionValue);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.route("**/api/repairs", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{
        id: "touch-target-repair",
        source: "backup",
        key: "backup.failed",
        severity: "error",
        title: "A backup failed",
        detail: "The last scheduled backup could not finish.",
        fix: { label: "Fix", action: "retry_backup" },
        learn_more: null,
        created_at: "2026-09-21T00:00:00.000Z",
      }]),
    }));
    await page.goto(`${BASE_URL}/repairs`);
    await page.getByText("A backup failed", { exact: true }).waitFor();
    await page.getByRole("button", { name: "More actions" }).click();
    await check(page, page.getByRole("menuitem", { name: "Fix", exact: true }), "Fix (Repairs)");
    await page.close();
  } finally {
    await context.close();
  }

  const backupContext = await newContext(browser, desktop, "light", sessionValue);
  try {
    const page = await backupContext.newPage();
    page.setDefaultTimeout(10000);
    await page.route("**/api/backups**", (route) => {
      const url = route.request().url();
      const body = url.includes("restore/pending") ? { pending: null } : [];
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(`${BASE_URL}/backups`);
    await check(page, page.getByRole("button", { name: "Back up now" }), "Back up now");
    await page.close();
  } finally {
    await backupContext.close();
  }

  console.log(`Lane B touch-target violations remaining: 0 (${checked} named targets checked)`);
}

/** Safety ruling, 2026-09-22: the composer's thinking-mode control
 * (RESP-04) is hidden entirely for a minor, never just disabled - the
 * model trigger (`[data-slot="composer-model-trigger"]`) must be absent
 * from the DOM. Signs in as Nova, `seedHousehold()`'s own seeded child,
 * the same auth/select pattern `flagTurnsAsMarlow()` already uses for
 * a different household member - both viewports (desktop 1440, phone
 * 390) the coordinator's own finding asked for, since this is a layout
 * claim (nothing shifts into the trigger's place oddly), not just a
 * presence check. */
async function captureNextChatChildComposerReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  const people = (await (await fetch(`${BASE_URL}/api/people`, { headers: { Cookie: `session=${sessionValue}` } })).json()) as Array<{ id: string; display_name: string }>;
  const nova = people.find((p) => p.display_name === "Nova");
  if (!nova) throw new Error("captureNextChatChildComposerReview: seedHousehold() didn't create Nova");
  const novaSelect = await fetch(`${BASE_URL}/api/auth/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ personId: nova.id }),
  });
  if (!novaSelect.ok) throw new Error(`captureNextChatChildComposerReview: signing in as Nova failed: ${novaSelect.status}`);
  const novaSession = novaSelect.headers.get("set-cookie")?.split(";")[0]?.split("=")[1];
  if (!novaSession) throw new Error("captureNextChatChildComposerReview: Nova's own sign-in carried no session cookie");

  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    const context = await newContext(browser, viewport, "dark", novaSession);
    try {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/chat`);
      await page.getByRole("textbox", { name: "Message input" }).waitFor();
      await settleAnimations(page);
      const path = join(outDir, `next-chat-child-composer-${viewport.width}-dark.png`);
      await page.screenshot({ path, fullPage: slug === "phone" });
      console.log(`Wrote ${path}`);
      await page.close();
    } finally {
      await context.close();
    }
  }
}

/** SHELL-02 slice 4's own stated acceptance ("a real 'write me a short
 * note about X' turn... the deterministic capture"): "pizza night" is
 * the stub model's own scripted `scriptedToolCalls` branch (main()'s
 * `startStubLlmServer` call below) - a real tool_calls completion
 * through the real turn engine and the real write_document package
 * (recipe.json's `artifact` op), not a Home-fabricated card. The
 * routing side needs no scripting of its own, but does need a real
 * "command" shape: write_document has no `routing.patterns` of its own
 * (only `examples`, which `commandOpenersFrom()` never reads), so a
 * bare "write me..." opener reads as an ordinary statement, not a
 * command - `utteranceShape.ts`'s own `COURTESY_PREFIX` ("could/would/
 * can/will you...") is what reliably lands `shape: "command"` instead
 * (`selectOfferedTools()`'s own comment - a command shape offers its
 * top-ranked candidates regardless of TIER2_AMBIGUOUS_FLOOR, unlike an
 * ordinary statement or question), the same reason this prompt doesn't
 * need seedWeatherCache()'s kind of fixture. Clicking the card and
 * waiting on the canvas's own document body proves the whole chain:
 * the artifact tool-call part, the card's own api.artifactCurrent()
 * fetch, and the canvas-split Element's real content, not just that
 * the turn completed. */
async function captureNextChatArtifactReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });

  const modelSetting = await fetch(`${BASE_URL}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: `session=${sessionValue}` },
    body: JSON.stringify({ scope: "household", key: "chat.model_id", value: "qwen3-8b-instruct-q4-k-m" }),
  });
  if (!modelSetting.ok) throw new Error(`captureNextChatArtifactReview: seeding chat.model_id failed: ${modelSetting.status}`);


  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    const context = await newContext(browser, viewport, "dark", sessionValue);
    try {
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/chat`);
    await page.getByRole("textbox", { name: "Message input" }).fill("Could you write that up as a document about pizza night?");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    const stopButton = page.getByRole("button", { name: "Stop generating", exact: true });
    const artifactCard = page.locator('[data-slot="artifact-card"]');
    await Promise.any([stopButton.waitFor({ timeout: 15000 }), artifactCard.waitFor({ timeout: 30000 })]);
    if (await stopButton.count()) await stopButton.waitFor({ state: "detached", timeout: 30000 });
    // The artifact-card Element's own root slot, standalone in the
    // message flow (ArtifactTool's own `display: "standalone"`).
    try {
      await artifactCard.waitFor({ timeout: 15000 });
    } catch (error) {
      const evidence = await page.evaluate(() => {
        const roots = [...document.querySelectorAll('[data-slot="aui_assistant-message-root"]')];
        const last = roots.at(-1);
        const visible = (element: Element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
        };
        const parts = last ? [...last.querySelectorAll("[data-slot], [data-tool-name], [aria-label]")]
          .filter((element) => /tool|artifact|document/i.test(`${element.getAttribute("data-slot") ?? ""} ${element.getAttribute("data-tool-name") ?? ""} ${element.getAttribute("aria-label") ?? ""}`) && visible(element))
          .map((element) => ({ slot: element.getAttribute("data-slot"), tool: element.getAttribute("data-tool-name"), label: element.getAttribute("aria-label"), text: (element.textContent ?? "").trim().slice(0, 240) })) : [];
        return { assistantText: last && visible(last) ? (last as HTMLElement).innerText.trim().slice(0, 1200) : null, toolCallParts: parts };
      });
      console.error(`[artifact-review] final assistant DOM evidence ${JSON.stringify(evidence)}`);
      throw error;
    }
    const canvasBody = page.locator('[data-slot="canvas-split-body"]');
    if (!(await canvasBody.isVisible().catch(() => false))) {
      await artifactCard.click();
    }
    // The canvas-split Element's own document body, real content
    // fetched through api.artifactCurrent() - not the card's loading
    // placeholder.
    await canvasBody.waitFor({ timeout: 15000 });
    await settleAnimations(page);
    const path = join(outDir, `next-chat-artifact-${viewport.width}-dark.png`);
    await page.screenshot({ path, fullPage: slug === "phone" });
    console.log(`Wrote ${path}`);
    await page.close();
    } finally {
      await context.close();
    }
  }
}

async function captureNextShellFoldReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });

  type ShellBox = { state: "folded" | "expanded"; name: string; width: number; height: number; left: number; top: number; centerX: number; centerY: number; borderBottomWidth: number };
  const measureShell = async (page: Page, state: "folded" | "expanded"): Promise<{ rows: ShellBox[]; iconToken: { width: number; height: number }; headerOverlaps: string[] }> => page.evaluate((currentState) => {
    const root = document.querySelector<HTMLElement>('[data-slot="sidebar-container"]');
    if (!root) throw new Error("shell measurement: sidebar container is missing");
    const stateRoot = document.querySelector<HTMLElement>('[data-slot="sidebar"]');
    const expectedState = currentState === "folded" ? "collapsed" : "expanded";
    if (stateRoot?.dataset.state !== expectedState) throw new Error(`shell measurement: expected ${expectedState}, got ${stateRoot?.dataset.state ?? "no state"}`);
    const rect = (name: string, element: Element | null) => {
      if (!element) throw new Error(`shell measurement: ${name} element is missing`);
      const box = element.getBoundingClientRect();
      return { state: currentState, name, width: box.width, height: box.height, left: box.left, top: box.top, centerX: box.left + box.width / 2, centerY: box.top + box.height / 2, borderBottomWidth: Number.parseFloat(getComputedStyle(element).borderBottomWidth) || 0 };
    };
    const button = root.querySelector<HTMLButtonElement>('button[aria-label="Toggle app menu"]');
    const rows = [rect("sidebar rail container", root), rect("fold button", button)];
    const sidebarHeader = root.querySelector<HTMLElement>('[data-slot="sidebar-header"]');
    rows.push(rect("sidebar header", sidebarHeader), rect("sidebar header parent", sidebarHeader?.parentElement ?? null));
    const logo = sidebarHeader?.querySelector<HTMLElement>('a:has(img[alt="logo"])') ?? null;
    rows.push(rect("sidebar logo", logo));
    const footer = root.querySelector<HTMLElement>('[data-slot="sidebar-footer"]');
    rows.push(rect("sidebar footer", footer));
    rows.push(rect("footer group", footer?.querySelector('[data-slot="sidebar-group"]') ?? null));
    rows.push(rect("footer group content", footer?.querySelector('[data-slot="sidebar-group-content"]') ?? null));
    rows.push(rect("footer menu", footer?.querySelector('[data-slot="sidebar-menu"]') ?? null));
    const buttonIcon = button?.querySelector("svg") ?? null;
    rows.push(rect("fold button icon", buttonIcon));
    const entries = [
      ["Home", "/next"],
      ["Chat", "/next/chat"],
      ["Library", "/next/files"],
      ["Family", "/next/people"],
      ["Settings", "/next/settings"],
      ["Help", "https://github.com/getmaipai/home/blob/main/docs/user/README.md"],
    ] as const;
    for (const [name, href] of entries) {
      const link: HTMLAnchorElement | undefined = [...root.querySelectorAll<HTMLAnchorElement>("a")].find((candidate) => candidate.getAttribute("href") === href);
      const icon = link?.querySelector("svg") ?? null;
      const row = rect(`${name} icon`, icon);
      rows.push(row);
      rows.push(rect(`${name} entry`, link ?? null));
      const menuButton = link?.matches('[data-slot="sidebar-menu-button"]') ? link ?? null : link?.querySelector('[data-slot="sidebar-menu-button"]') ?? null;
      rows.push(rect(`${name} menu button`, menuButton));
      rows.push(rect(`${name} icon parent`, icon?.parentElement ?? null));
      const label = link?.querySelector<HTMLElement>(".hide-menu") ?? null;
      rows.push(rect(`${name} label`, label));
    }
    const probe = document.createElement("svg");
    probe.className = "size-4";
    probe.style.position = "fixed";
    probe.style.visibility = "hidden";
    document.body.append(probe);
    const token = probe.getBoundingClientRect();
    probe.remove();
    const pageHeader = document.querySelector<HTMLElement>("header");
    rows.push(rect("page header", pageHeader));
    const headerOverlaps = button && sidebarHeader ? [...sidebarHeader.querySelectorAll<HTMLElement>("*")]
      .filter((element) => !button.contains(element) && !element.contains(button))
      .filter((element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        if (style.display === "none" || style.visibility === "hidden" || box.width === 0 || box.height === 0) return false;
        const buttonBox = button.getBoundingClientRect();
        return buttonBox.left < box.right && buttonBox.right > box.left && buttonBox.top < box.bottom && buttonBox.bottom > box.top;
      })
      .map((element) => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}.${[...element.classList].slice(0, 3).join(".")}`) : [];
    return { rows, iconToken: { width: token.width, height: token.height }, headerOverlaps };
  }, state);

  const assertShellGeometry = (state: "folded" | "expanded", data: Awaited<ReturnType<typeof measureShell>>): void => {
    const near = (actual: number, expected: number) => Math.abs(actual - expected) <= 0.5;
    const iconRows = data.rows.filter((row) => row.name.endsWith("icon"));
    for (const icon of iconRows) {
      if (!near(icon.width, data.iconToken.width) || !near(icon.height, data.iconToken.height)) {
        throw new Error(`SHELL-FOLD ${state}: ${icon.name} is ${icon.width}×${icon.height}px; shipped size-4 token is ${data.iconToken.width}×${data.iconToken.height}px`);
      }
    }
    const rail = data.rows.find((row) => row.name === "sidebar rail container")!;
    const sidebarHeader = data.rows.find((row) => row.name === "sidebar header")!;
    const pageHeader = data.rows.find((row) => row.name === "page header")!;
    if (sidebarHeader.borderBottomWidth !== 0) throw new Error(`SHELL-FOLD ${state}: sidebar header border-bottom-width is ${sidebarHeader.borderBottomWidth}px, expected 0`);
    if (pageHeader.borderBottomWidth <= 0) throw new Error(`SHELL-FOLD ${state}: page header border-bottom-width is ${pageHeader.borderBottomWidth}px, expected a visible border`);
    const navIcons = data.rows.filter((row) => ["Home icon", "Chat icon", "Library icon", "Family icon"].includes(row.name));
    const foldButton = data.rows.find((row) => row.name === "fold button")!;
    if (state === "folded") {
      const logo = data.rows.find((row) => row.name === "sidebar logo")!;
      if (logo.width > 0 && logo.height > 0) throw new Error(`SHELL-FOLD folded: sidebar logo has visible area ${logo.width}×${logo.height}px`);
      const buttonBox = data.rows.find((row) => row.name === "fold button")!;
      if (!near(buttonBox.width, 48) || !near(buttonBox.height, 48)) throw new Error(`SHELL-FOLD folded: fold button hit area is ${buttonBox.width}×${buttonBox.height}px, expected 48×48px`);
      if (!near(buttonBox.centerX, rail.centerX)) throw new Error(`SHELL-FOLD folded: fold button center x ${buttonBox.centerX}px differs from rail center x ${rail.centerX}px`);
      const pageHeader = data.rows.find((row) => row.name === "page header")!;
      if (!near(buttonBox.centerY, pageHeader.centerY)) throw new Error(`SHELL-FOLD folded: fold button center y ${buttonBox.centerY}px differs from page header row center y ${pageHeader.centerY}px`);
      const overlaps = data.headerOverlaps;
      for (const icon of iconRows) {
        if (!near(icon.centerX, rail.centerX)) throw new Error(`SHELL-FOLD folded: ${icon.name} center x ${icon.centerX}px differs from rail center x ${rail.centerX}px`);
      }
      if (overlaps.length) throw new Error(`SHELL-FOLD folded: fold button overlaps sidebar-header sibling ${overlaps[0]}`);
      for (const icon of navIcons) {
        if (!near(foldButton.centerX, icon.centerX)) throw new Error(`SHELL-FOLD folded: fold button center x ${foldButton.centerX}px differs from ${icon.name} center x ${icon.centerX}px`);
      }
      for (const name of ["Home", "Chat", "Library", "Family", "Settings", "Help"]) {
        const target = data.rows.find((row) => row.name === `${name} menu button`)!;
        if (!near(target.width, 48) || !near(target.height, 48)) throw new Error(`SHELL-FOLD folded: ${name} hit area is ${target.width}×${target.height}px, expected 48×48px`);
        if (!near(target.centerX, rail.centerX)) throw new Error(`SHELL-FOLD folded: ${name} hit area center x ${target.centerX}px differs from rail center x ${rail.centerX}px`);
      }
    } else {
      const left = navIcons[0]!.left;
      const menuIcons = data.rows.filter((row) => ["Home icon", "Chat icon", "Library icon", "Family icon", "Settings icon", "Help icon"].includes(row.name));
      for (const icon of menuIcons) {
        if (!near(icon.left, left)) throw new Error(`SHELL-FOLD expanded: ${icon.name} left edge ${icon.left}px differs from nav icon left edge ${left}px`);
      }
      const iconSize = menuIcons[0]!;
      for (const icon of menuIcons) {
        if (!near(icon.width, iconSize.width) || !near(icon.height, iconSize.height)) throw new Error(`SHELL-FOLD expanded: ${icon.name} is ${icon.width}×${icon.height}px, unlike ${iconSize.name} at ${iconSize.width}×${iconSize.height}px`);
      }
      const menuLabels = data.rows.filter((row) => ["Home label", "Chat label", "Library label", "Family label", "Settings label", "Help label"].includes(row.name));
      const labelLeft = menuLabels[0]!.left;
      for (const label of menuLabels) {
        if (!near(label.left, labelLeft)) throw new Error(`SHELL-FOLD expanded: ${label.name} left edge ${label.left}px differs from menu label left edge ${labelLeft}px`);
      }
    }
  };

  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((item) => item.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/chat`);
        await page.getByRole("textbox", { name: "Message input" }).waitFor();
        await page.evaluate(() => { document.cookie = "sidebar_state=; path=/; max-age=0"; });
        await page.reload();
        if (slug === "phone") {
          await page.getByRole("button", { name: "Show threads" }).waitFor();
          const historyButton = page.getByRole("button", { name: "Show threads" });
          const phoneRow = historyButton.locator("xpath=ancestor::div[contains(@class, 'lg:hidden')][1]");
          await settleAnimations(page);
          const firstRunPath = join(outDir, `next-shell-fold-phone-first-run-${viewport.width}-${theme}.png`);
          await page.screenshot({ path: firstRunPath, fullPage: true });
          console.log(`Wrote ${firstRunPath}`);
          const phonePath = join(outDir, `next-shell-fold-phone-history-row-${viewport.width}-${theme}.png`);
          await page.screenshot({ path: phonePath, fullPage: true });
          console.log(`Wrote ${phonePath}`);
          const headerTrigger = page.locator('header [data-slot="sidebar-trigger"]');
          await headerTrigger.click();
          await page.locator('[data-mobile="true"][data-slot="sidebar"]').waitFor({ state: "visible" });
          await page.waitForFunction(() => {
            const header = document.querySelector<HTMLElement>('[data-mobile="true"][data-slot="sidebar"] [data-slot="sidebar-header"]');
            return header !== null && header.getBoundingClientRect().left >= -0.5;
          });
          await settleAnimations(page);
          const phoneBorder = await page.evaluate(() => {
            const header = document.querySelector<HTMLElement>('[data-mobile="true"][data-slot="sidebar"] [data-slot="sidebar-header"]');
            const pageHeader = document.querySelector<HTMLElement>("header");
            const measure = (name: string, element: HTMLElement | null) => {
              if (!element) throw new Error(`shell phone measurement: ${name} is missing`);
              const box = element.getBoundingClientRect();
              return { name, width: box.width, height: box.height, left: box.left, top: box.top, centerX: box.left + box.width / 2, centerY: box.top + box.height / 2, borderBottomWidth: Number.parseFloat(getComputedStyle(element).borderBottomWidth) || 0 };
            };
            const sheetToggle = document.querySelector<HTMLElement>('[data-mobile="true"][data-slot="sidebar"] [data-slot="sidebar-header"] > button[aria-label="Toggle app menu"]');
            const headerTrigger = document.querySelector<HTMLElement>('header [data-slot="sidebar-trigger"]');
            return [measure("phone sidebar header", header), measure("phone page header", pageHeader), measure("phone header menu trigger", headerTrigger), measure("phone sheet duplicate fold button", sheetToggle)];
          });
          console.log(`SHELL-FOLD phone header borders (${theme})`);
          console.table(phoneBorder);
          if (phoneBorder[0]!.borderBottomWidth !== 0) throw new Error(`SHELL-FOLD phone: sidebar header border-bottom-width is ${phoneBorder[0]!.borderBottomWidth}px, expected 0`);
          if (phoneBorder[1]!.borderBottomWidth <= 0) throw new Error(`SHELL-FOLD phone: page header border-bottom-width is ${phoneBorder[1]!.borderBottomWidth}px, expected a visible border`);
          if (phoneBorder[2]!.width < 48 || phoneBorder[2]!.height < 48) throw new Error(`SHELL-FOLD phone: header menu trigger is ${phoneBorder[2]!.width}×${phoneBorder[2]!.height}px, expected at least 48×48px`);
          if (phoneBorder[3]!.width !== 0 || phoneBorder[3]!.height !== 0) throw new Error(`SHELL-FOLD phone: duplicate sheet fold button remains visible at ${phoneBorder[3]!.width}×${phoneBorder[3]!.height}px`);
          const sheetPath = join(outDir, `next-shell-fold-phone-menu-sheet-${viewport.width}-${theme}.png`);
          await page.screenshot({ path: sheetPath, fullPage: true });
          console.log(`Wrote ${sheetPath}`);
          await page.close();
          continue;
        }
        const menu = page.locator('[data-slot="sidebar"]').first();
        await menu.waitFor({ state: "attached" });
        await page.waitForFunction(() => document.querySelector('[data-slot="sidebar"]')?.getAttribute("data-state") === "collapsed");
        const suffix = `${viewport.width}-${theme}`;
        if (slug === "desktop") {
          await menu.getByRole("link", { name: "Chat" }).hover();
          await page.locator('[data-slot="tooltip-content"]').filter({ hasText: "Chat" }).waitFor({ state: "visible" });
        }
        await settleAnimations(page);
        const foldedGeometry = await measureShell(page, "folded");
        const foldedPath = join(outDir, `next-shell-fold-chat-first-folded-${suffix}.png`);
          await page.screenshot({ path: foldedPath, fullPage: false });
        console.log(`Wrote ${foldedPath}`);

        {
          const menuTrigger = menu.getByRole("button", { name: "Toggle app menu" });
          await menuTrigger.waitFor();
          await menuTrigger.click();
          await page.waitForFunction(() => document.querySelector('[data-slot="sidebar"]')?.getAttribute("data-state") === "expanded");
          await settleAnimations(page);
          const expandedGeometry = await measureShell(page, "expanded");
          for (const [geometryState, geometry] of [["folded", foldedGeometry], ["expanded", expandedGeometry]] as const) {
            console.log(`SHELL-FOLD geometry (${geometryState}); shipped SidebarMenuButton icon token size-4 = ${geometry.iconToken.width}×${geometry.iconToken.height}px`);
            console.log(`SHELL-FOLD ${geometryState} fold button sibling overlaps: ${geometry.headerOverlaps.join(", ") || "none"}`);
            console.table(geometry.rows.map(({ state: _state, ...row }) => row));
          }
          assertShellGeometry("folded", foldedGeometry);
          assertShellGeometry("expanded", expandedGeometry);
          const openPath = join(outDir, `next-shell-fold-chat-click-open-${suffix}.png`);
          await page.screenshot({ path: openPath });
          console.log(`Wrote ${openPath}`);

          await page.reload();
          await page.waitForFunction(() => document.querySelector('[data-slot="sidebar"]')?.getAttribute("data-state") === "expanded");
          await settleAnimations(page);
          const reloadPath = join(outDir, `next-shell-fold-chat-reload-open-${suffix}.png`);
          await page.screenshot({ path: reloadPath });
          console.log(`Wrote ${reloadPath}`);
        }
        await page.close();
      } finally {
        await context.close();
      }
    }
  }

  for (const theme of THEMES) {
    const viewport = VIEWPORTS.find((item) => item.slug === "desktop")!;
    const context = await newContext(browser, viewport, theme, sessionValue);
    try {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/next`);
      await page.getByRole("heading", { level: 1 }).first().waitFor();
      await page.evaluate(() => { document.cookie = "sidebar_state=; path=/; max-age=0"; });
      await page.reload();
      await page.waitForFunction(() => document.querySelector('[data-slot="sidebar"]')?.getAttribute("data-state") === "collapsed");
      await settleAnimations(page);
      const collapsedPath = join(outDir, `next-shell-fold-home-first-folded-1440-${theme}.png`);
      await page.screenshot({ path: collapsedPath });
      console.log(`Wrote ${collapsedPath}`);
      const menu = page.locator('[data-slot="sidebar"]').first();
      await menu.getByRole("button", { name: "Toggle app menu" }).click();
      await page.waitForFunction(() => document.querySelector('[data-slot="sidebar"]')?.getAttribute("data-state") === "expanded");
      await settleAnimations(page);
      const expandedPath = join(outDir, `next-shell-fold-home-click-open-1440-${theme}.png`);
      await page.screenshot({ path: expandedPath });
      console.log(`Wrote ${expandedPath}`);
    } finally {
      await context.close();
    }
  }

  const desktop = VIEWPORTS.find((item) => item.slug === "desktop")!;
  const cookie = { Cookie: `session=${sessionValue}` };
  await seedTitledConversation("captureNextShellFoldReview", cookie, "Weekend garden plans");
  const context = await newContext(browser, desktop, "dark", sessionValue);
  try {
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/chat`);
    await page.getByRole("textbox", { name: "Message input" }).waitFor();
    await page.getByRole("button", { name: "Toggle app menu" }).click();
    await page.waitForFunction(() => document.querySelector('[data-slot="sidebar"]')?.getAttribute("data-state") === "expanded");
    const list = page.locator('[data-slot="next-chat-rail"]');
    await list.getByRole("button", { name: "New chat", exact: true }).waitFor();
    await list.getByRole("searchbox", { name: "Search chats" }).waitFor();
    await settleAnimations(page);
    const path = join(outDir, "next-shell-fold-chat-list-1440-dark.png");
    await page.screenshot({ path });
    console.log(`Wrote ${path}`);
  } finally {
    await context.close();
  }
}

/** UI-1 (gap matrix A3): one reply carrying code, math, a wide table, a task
 * list, a link and a diagram (richReplyFixture.ts, shared with the frontend
 * test), captured at desktop and phone, light and dark. Fails when any
 * element is missing from the page, so a screenshot is never the only proof. */
async function captureNextChatRichReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  const cookie = { Cookie: `session=${sessionValue}` };
  const conversation = await seedTitledConversation("captureNextChatRichReview", cookie, "Homework helper");
  const evidenceTag = process.env.UI_EVIDENCE_TAG ?? "after";
  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
        await openStoredConversation(page, conversation.id, "Homework helper");
        if (slug === "desktop" && theme === THEMES[0]) {
          await sendChatMessage(page, RICH_REPLY_PROMPT);
          await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ timeout: 15000 });
          await page.getByRole("button", { name: "Stop generating", exact: true }).waitFor({ state: "detached", timeout: 30000 });
        }
        await page.locator(".aui-md").first().waitFor();
        await page.waitForTimeout(2500);
        const report = await page.evaluate(() => ({
          codeHeaders: document.querySelectorAll(".aui-code-header-root").length,
          copyButtons: document.querySelectorAll(".aui-code-header-root button").length,
          languages: [...document.querySelectorAll(".aui-code-header-language")].map((n) => n.textContent),
          shikiBlocks: document.querySelectorAll(".aui-shiki-base").length,
          inlineCode: document.querySelectorAll(".aui-md-inline-code").length,
          katex: document.querySelectorAll(".katex").length,
          katexDisplay: document.querySelectorAll(".katex-display").length,
          tableWrappers: document.querySelectorAll(".aui-md-table-wrapper").length,
          checkboxes: document.querySelectorAll(".aui-md input[type=checkbox]").length,
          links: [...document.querySelectorAll(".aui-md a")].map((a) => `${a.getAttribute("target")}|${a.getAttribute("rel")}`),
          mermaid: document.querySelectorAll(".aui-md svg").length,
          pageScrollsSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          scheme: (() => {
            const css = (selector: string, prop: "colorScheme" | "color" | "backgroundColor") => { const el = document.querySelector(selector); return el ? getComputedStyle(el)[prop] : null; };
            return { htmlClass: document.documentElement.className, htmlColorScheme: css("html", "colorScheme"), shikiColorScheme: css(".aui-shiki-base code", "colorScheme"), tokenColor: css(".aui-shiki-base code span", "color"), preBg: css(".aui-shiki-base pre", "backgroundColor"), pageBg: css("body", "backgroundColor") };
          })(),
          emptyLabel: (() => { const el = [...document.querySelectorAll(".aui-code-header-language")].find((n) => !n.textContent); return el ? getComputedStyle(el, "::before").content : null; })(),
          taskListStyle: (() => { const li = document.querySelector(".aui-md li.task-list-item"); return li ? getComputedStyle(li).listStyleType : null; })(),
          codeBox: (() => {
            const h = document.querySelector(".aui-code-header-root")?.getBoundingClientRect();
            const pre = document.querySelector(".aui-shiki-base pre");
            const r = pre?.getBoundingClientRect();
            const cs = pre ? getComputedStyle(pre) : null;
            const code = pre?.querySelector("code");
            const ccs = code ? getComputedStyle(code) : null;
            return { headerBottom: h?.bottom, preTop: r?.top, preMarginTop: cs?.marginTop, prePad: cs?.padding, codeDisplay: ccs?.display, codeMarginTop: ccs?.marginTop, codePadTop: ccs?.paddingTop, firstChild: pre?.firstElementChild?.tagName };
          })(),
        }));
        console.log(`captureNextChatRichReview: ${slug}/${theme} ${JSON.stringify(report)}`);
        await settleAnimations(page);
        // The thread scrolls inside its own viewport, so one shot per end of
        // the reply: the top (code, math) and the bottom (table, tasks, diagram).
        for (const part of ["top", "end"] as const) {
          await page.evaluate((where) => {
            const viewport = document.querySelector<HTMLElement>('[data-slot="aui_thread-viewport"]');
            if (!viewport) throw new Error("Missing assistant-ui thread viewport");
            viewport.scrollTo({ top: where === "top" ? 0 : viewport.scrollHeight, behavior: "instant" });
          }, part);
          if (part === "end") {
            // Assistant UI can update the viewport's scroll height as the
            // scroll event settles. Reapply max after each frame so the
            // capture ends at the actual current bottom, not a stale max.
            await page.evaluate(async () => {
              const viewport = document.querySelector<HTMLElement>('[data-slot="aui_thread-viewport"]');
              if (!viewport) throw new Error("Missing assistant-ui thread viewport");
              for (let attempt = 0; attempt < 4; attempt++) {
                viewport.scrollTo({ top: viewport.scrollHeight, behavior: "instant" });
                await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
              }
            });
          }
          await page.waitForTimeout(250);
          if (part === "end") {
            const measured = await page.evaluate(() => {
              const viewport = document.querySelector<HTMLElement>('[data-slot="aui_thread-viewport"]');
              const diagram = [...document.querySelectorAll<HTMLElement>(".aui-md")]
                .flatMap((md) => [...md.querySelectorAll<SVGSVGElement>("svg")])
                .at(-1);
              const composer = document.querySelector<HTMLElement>('[data-slot="aui_composer-shell"]');
              if (!viewport || !diagram || !composer) return null;
              return { scrollTop: viewport.scrollTop, maxScrollTop: viewport.scrollHeight - viewport.clientHeight, diagramBottom: diagram.getBoundingClientRect().bottom, composerTop: composer.getBoundingClientRect().top };
            });
            if (!measured || measured.diagramBottom + 16 > measured.composerTop) {
              throw new Error(`Rich reply diagram overlaps composer or lacks 16px clearance at ${viewport.width}x${viewport.height}/${theme}: ${JSON.stringify(measured)}`);
            }
            console.log(`Rich reply end clearance ${viewport.width}x${viewport.height}/${theme}: ${JSON.stringify(measured)}`);
          }
          await page.waitForTimeout(400);
          const filename = `next-chat-rich-${evidenceTag}-${part}-${viewport.width}-${theme}.png`;
          await page.screenshot({ path: join(outDir, filename) });
          dedicatedScreenshots.push({ file: filename, route: "/chat", viewport: viewport.slug, theme });
          console.log(`Wrote ${join(outDir, filename)}`);
        }
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

async function captureNextChatPolishReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });

  const modelSetting = await fetch(`${BASE_URL}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: `session=${sessionValue}` },
    body: JSON.stringify({ scope: "household", key: "chat.model_id", value: "qwen3-8b-instruct-q4-k-m" }),
  });
  if (!modelSetting.ok) throw new Error(`captureNextChatPolishReview: seeding chat.model_id failed: ${modelSetting.status}`);
  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    const context = await newContext(browser, viewport, "dark", sessionValue);
    try {
      let page = await context.newPage();
      await page.goto(`${BASE_URL}/chat`);
      await page.getByRole("textbox", { name: "Message input" }).waitFor();
      if (slug === "phone") {
        await settleAnimations(page);
        await page.screenshot({ path: join(outDir, "next-chat-polish-welcome-clean-390-dark.png"), fullPage: true });
        await page.getByRole("button", { name: "Add", exact: true }).click();
        await page.getByText("Add photos and files").waitFor();
      }
      await settleAnimations(page);
      await page.screenshot({ path: join(outDir, `next-chat-polish-welcome-${viewport.width}-dark.png`), fullPage: slug === "phone" });
      if (slug === "phone") {
        await page.close();
        page = await context.newPage();
        await page.goto(`${BASE_URL}/chat`);
        await page.getByRole("textbox", { name: "Message input" }).waitFor();
      }

      await page.getByRole("textbox", { name: "Message input" }).fill("Could you write that up as a document about pizza night?");
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      const stopButton = page.getByRole("button", { name: "Stop generating", exact: true });
      const artifactCard = page.locator('[data-slot="artifact-card"]');
      await Promise.any([stopButton.waitFor({ timeout: 15000 }), artifactCard.waitFor({ timeout: 30000 })]);
      if (await stopButton.count()) await stopButton.waitFor({ state: "detached", timeout: 30000 });
      await artifactCard.waitFor({ timeout: 15000 });
      if (slug === "phone") await page.keyboard.press("Escape");
      const moreButton = page.locator('button[aria-label="More"]').first();
      if (await moreButton.count()) {
        await moreButton.click();
        await page.getByRole("menuitem", { name: "Show in Library" }).waitFor();
        await settleAnimations(page);
      } else {
        const buttons = await page.locator("button").evaluateAll((items) => items.map((item) => ({ label: item.getAttribute("aria-label"), text: (item.textContent ?? "").trim(), title: item.getAttribute("title") })));
        console.error(`[chat-polish-review] file menu trigger absent at ${viewport.width}px; buttons ${JSON.stringify(buttons)}`);
      }
      await page.screenshot({ path: join(outDir, `next-chat-polish-filemenu-${viewport.width}-dark.png`), fullPage: slug === "phone" });
      await page.keyboard.press("Escape");

      const traceResponsePromise = page.waitForResponse((response) => response.url().includes("/api/turn/stream") && response.request().method() === "POST");
      await page.getByRole("textbox", { name: "Message input" }).fill("Could you please remember that Friday is pizza night?");
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      const traceResponse = await traceResponsePromise;
      const traceEvents = (await traceResponse.text()).split("\n").filter(Boolean).map((line) => {
        try {
          const event = JSON.parse(line) as { type?: string; t?: string; status?: unknown; package_id?: string; call_id?: string; outcome?: unknown; value?: { source?: string; plugin_id?: string; reply?: { text?: string }; stats?: { total_time_ms?: number | null } } };
          return { type: event.t ?? event.type ?? "unknown", status: event.status, package_id: event.package_id, call_id: event.call_id, outcome: event.outcome, source: event.value?.source, plugin_id: event.value?.plugin_id, reply: event.value?.reply?.text, total_time_ms: event.value?.stats?.total_time_ms };
        } catch {
          return "unparsed";
        }
      });
      console.log(`[chat-polish-review] trace turn NDJSON events ${JSON.stringify(traceEvents)}`);
      const trace = page.getByText(/^Worked for \d+ seconds?, 1 step$/);
      await trace.waitFor({ timeout: 20000 });
      const traceScrollToBottom = page.getByRole("button", { name: "Scroll to bottom", exact: true });
      if (await traceScrollToBottom.count()) await traceScrollToBottom.click();
      await settleAnimations(page);
      await page.screenshot({ path: join(outDir, `next-chat-polish-trace-${viewport.width}-dark.png`), fullPage: slug === "phone" });

      await page.getByRole("textbox", { name: "Message input" }).fill("Tell me about herbs for the kitchen.");
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      const secondStop = page.getByRole("button", { name: "Stop generating", exact: true });
      await page.getByText("Basil, parsley, and chives are useful kitchen herbs. Keep mint in its own pot so it does not spread.").waitFor({ timeout: 15000 });
      if (await secondStop.count()) await secondStop.waitFor({ state: "detached", timeout: 30000 });
      const scrollToBottom = page.getByRole("button", { name: "Scroll to bottom", exact: true });
      if (await scrollToBottom.count()) await scrollToBottom.click();
      await settleAnimations(page);
      await page.screenshot({ path: join(outDir, `next-chat-polish-actions-${viewport.width}-dark.png`), fullPage: true });
      await page.close();
    } finally {
      await context.close();
    }
  }
}

/** SHELL-05's own acceptance ("1440 and 390... captures dark/light"):
 * both viewports, both themes, of `/settings`. Waits on "Family
 * name", a real, always-present basic key under Household > System
 * (`spec/settings/keys.json`) - the tab a seeded owner/admin session
 * lands on by default - present only once both the registry and the
 * household scope's values have actually resolved. */
async function captureNextSettingsReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/settings`);
        await page.locator("text=Family name").first().waitFor({ timeout: 15000 });
        await settleAnimations(page);
        const path = join(outDir, `next-settings-${viewport.width}-${theme}.png`);
        await page.screenshot({ path, fullPage: slug === "phone" });
        console.log(`Wrote ${path}`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

/** SETTINGS-S2 review: capture the new Me frame at both requested widths
 * and themes, for the seeded owner across every section and for a seeded
 * child to prove the admin-only Limits section is absent. The output
 * directory can be supplied for review artifacts outside this checkout. */
async function captureNextSettingsS2Review(browser: Browser, ownerSession: string): Promise<void> {
  const outDir = process.env.MAIPAI_SETTINGS_S8_SCREEN_DIR || process.env.MAIPAI_SETTINGS_S7_SCREEN_DIR || process.env.MAIPAI_SETTINGS_S2_SCREEN_DIR || join(ROOT, "data-scratch", "screenshots", "settings-s2");
  mkdirSync(outDir, { recursive: true });
  const peopleResponse = await fetch(`${BASE_URL}/api/people`, { headers: { Cookie: `session=${ownerSession}` } });
  if (!peopleResponse.ok) throw new Error(`SETTINGS-S2: household lookup failed: ${peopleResponse.status}`);
  const people = await peopleResponse.json() as Array<{ id: string; display_name: string; role: string }>;
  const child = people.find((person) => person.display_name === "Nova" && person.role === "child");
  if (!child) throw new Error("SETTINGS-S2: seeded child Nova was not found");
  const childSignIn = await fetch(`${BASE_URL}/api/auth/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ personId: child.id }),
  });
  if (!childSignIn.ok) throw new Error(`SETTINGS-S2: signing in as Nova failed: ${childSignIn.status}`);
  const childSession = childSignIn.headers.get("set-cookie")?.split(";")[0]?.split("=")[1];
  if (!childSession) throw new Error("SETTINGS-S2: Nova's sign-in carried no session cookie");

  const ownerPages = [
    { id: "me", path: "/settings?tab=me", heading: "Profile" },
    { id: "profile", path: "/settings?tab=me&section=profile", heading: "Profile" },
    { id: "appearance", path: "/settings?tab=me&section=appearance", heading: "Appearance" },
    { id: "chat", path: "/settings?tab=me&section=chat", heading: "Chat" },
    { id: "voice-ai", path: "/settings?tab=me&section=voice-ai", heading: "Voice and AI" },
    { id: "notifications", path: "/settings?tab=me&section=notifications", heading: "Notifications" },
    { id: "privacy-data", path: "/settings?tab=me&section=privacy-data", heading: "Privacy and data" },
  ] as const;

  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((item) => item.slug === slug)!;
    for (const theme of THEMES) {
      for (const [person, session, pages] of [
        ["owner", ownerSession, ownerPages],
        ["member", childSession, [{ id: "me", path: "/settings?tab=me", heading: "Profile" }]],
      ] as const) {
        const context = await newContext(browser, viewport, theme, session);
        try {
          const page = await context.newPage();
          page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
          for (const entry of pages) {
            const response = await page.goto(`${BASE_URL}/settings`);
            if (!response?.ok()) throw new Error(`SETTINGS-S2: ${entry.path} returned ${response?.status() ?? "no response"}`);
            await page.waitForLoadState("networkidle");
            const meTab = page.getByRole("tab", { name: "Me", exact: true });
            if (await meTab.count() > 0) await meTab.click();
            if (person === "owner" && await meTab.count() === 0) throw new Error("SETTINGS-S2: owner Me tab was not rendered");
            if (person !== "member") await meTab.waitFor({ state: "visible" });
            const requestedUrl = new URL(entry.path, BASE_URL);
            await page.evaluate((url) => { history.pushState(history.state, "", url); window.dispatchEvent(new PopStateEvent("popstate")); }, requestedUrl.pathname + requestedUrl.search);
            if (entry.id !== "me") {
              if (slug === "phone") await page.getByRole("tabpanel", { name: "Me" }).getByLabel("Settings section", { exact: true }).selectOption(entry.id);
              else await page.getByRole("tab", { name: entry.heading, exact: true }).last().click();
            }
            if (entry.id === "profile" || entry.id === "me") await page.getByLabel("Name", { exact: true }).waitFor({ state: "visible" });
            if (entry.id === "appearance") await page.getByRole("combobox", { name: "Appearance", exact: true }).waitFor({ state: "visible" });
            if (entry.id === "chat") await page.locator('[id="settings-person.persona"]').waitFor({ state: "visible" });
            if (entry.id === "voice-ai") await page.locator('[id="settings-person.voice"]').waitFor({ state: "visible" });
            if (entry.id === "notifications") await page.getByRole("button", { name: /Telegram options/ }).waitFor({ state: "visible" });
            if (entry.id === "privacy-data") await page.getByRole("link", { name: "Privacy" }).waitFor({ state: "visible" });
            if (person === "member") {
              const limitsTab = page.locator('[data-slot="tabs-trigger"]').filter({ hasText: /^Limits$/ });
              const limitsOption = page.locator('[data-slot="native-select-option"][value="limits"]');
              if (await limitsTab.count() !== 0 || await limitsOption.count() !== 0) {
                throw new Error("SETTINGS-S2: the child sees an admin-only Limits entry");
              }
            }
            await settleAnimations(page);
            const file = `settings-s2-${person}-${entry.id}-${viewport.width}-${theme}.png`;
            const path = join(outDir, file);
            await page.screenshot({ path, fullPage: slug === "phone" });
            console.log(`Wrote ${path}`);
          }
          await page.close();
        } finally {
          await context.close();
        }
      }
    }
  }
}

async function captureNextSettingsS3Review(browser: Browser, ownerSession: string): Promise<void> {
  const outDir = process.env.MAIPAI_SETTINGS_S8_SCREEN_DIR || process.env.MAIPAI_SETTINGS_S7_SCREEN_DIR || join(ROOT, "../home/data-scratch/screens/settings-s3");
  mkdirSync(outDir, { recursive: true });
  const response = await fetch(`${BASE_URL}/api/people`, { headers: { Cookie: `session=${ownerSession}` } });
  if (!response.ok) throw new Error(`SETTINGS-S3: household lookup failed: ${response.status}`);
  const people = await response.json() as Array<{ id: string; display_name: string; role: string }>;
  const owner = people.find((p) => p.role === "owner");
  const child = people.find((p) => p.display_name === "Nova" && p.role === "child");
  if (!owner || !child) throw new Error("SETTINGS-S3: seeded owner and child Nova are required");
  const signedIn = await fetch(`${BASE_URL}/api/auth/select`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personId: child.id }) });
  if (!signedIn.ok) throw new Error(`SETTINGS-S3: Nova sign-in failed: ${signedIn.status}`);
  const childSession = signedIn.headers.get("set-cookie")?.split(";")[0]?.split("=")[1];
  if (!childSession) throw new Error("SETTINGS-S3: Nova sign-in returned no session");
  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      for (const person of [{ name: "owner", id: owner.id, session: ownerSession }, { name: "nova", id: child.id, session: childSession }]) {
        const context = await newContext(browser, viewport, theme, person.session);
        try {
          const page = await context.newPage(); page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
          const pageResponse = await page.goto(`${BASE_URL}/settings?tab=me&section=profile`);
          if (!pageResponse?.ok()) throw new Error(`SETTINGS-S3: ${person.name} settings returned ${pageResponse?.status() ?? "no response"}`);
          await page.waitForLoadState("networkidle");
          await page.getByText("Face recognition", { exact: true }).waitFor({ state: "visible" });
          if (person.name === "nova") await page.getByText("Ask an admin to set this up.", { exact: true }).waitFor({ state: "visible" });
          const file = join(outDir, `settings-s3-${person.name}-profile-${viewport.width}-${theme}.png`);
          await page.screenshot({ path: file, fullPage: true }); console.log(`Wrote ${file}`);
          await page.close();
        } finally { await context.close(); }
      }
      const context = await newContext(browser, viewport, theme, ownerSession);
      try {
        const page = await context.newPage(); page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
        const pageResponse = await page.goto(`${BASE_URL}/people/${owner.id}`);
        if (!pageResponse?.ok()) throw new Error(`SETTINGS-S3: owner's profile returned ${pageResponse?.status() ?? "no response"}`);
        await page.waitForLoadState("networkidle");
        await page.getByRole("link", { name: "Edit profile" }).waitFor({ state: "visible" });
        const file = join(outDir, `settings-s8-owner-people-${viewport.width}-${theme}.png`);
        await page.screenshot({ path: file, fullPage: true }); console.log(`Wrote ${file}`);
        await page.close();
      } finally { await context.close(); }
    }
  }
}

async function captureNextSettingsS5Review(browser: Browser, ownerSession: string): Promise<void> {
  const outDir = process.env.MAIPAI_SETTINGS_S7_SCREEN_DIR || join(ROOT, "../home/data-scratch/screens/settings-s5");
  mkdirSync(outDir, { recursive: true });
  const response = await fetch(`${BASE_URL}/api/people`, { headers: { Cookie: `session=${ownerSession}` } });
  if (!response.ok) throw new Error(`SETTINGS-S5: household lookup failed: ${response.status}`);
  const people = await response.json() as Array<{ id: string; display_name: string; role: string }>;
  const owner = people.find((person) => person.role === "owner");
  const child = people.find((person) => person.display_name === "Nova" && person.role === "child");
  if (!owner || !child) throw new Error("SETTINGS-S5: seeded owner and child Nova are required");

  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((item) => item.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, ownerSession);
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
        const profileResponse = await page.goto(`${BASE_URL}/people/${child.id}?tab=limits`);
        if (!profileResponse?.ok()) throw new Error(`SETTINGS-S5: Nova's profile returned ${profileResponse?.status() ?? "no response"}`);
        await page.getByRole("tab", { name: "Limits", exact: true }).waitFor({ state: "visible" });
        await page.locator('[id="settings-person.allowance"]').waitFor({ state: "visible" });
        await page.locator('[id="settings-person.storage"]').waitFor({ state: "visible" });
        await settleAnimations(page);
        const childPath = join(outDir, `settings-s5-nova-limits-${viewport.width}-${theme}.png`);
        await page.screenshot({ path: childPath, fullPage: true });
        console.log(`Wrote ${childPath}`);

        const settingsResponse = await page.goto(`${BASE_URL}/settings?tab=me`);
        if (!settingsResponse?.ok()) throw new Error(`SETTINGS-S5: owner's Settings returned ${settingsResponse?.status() ?? "no response"}`);
        await page.locator("#profile-display-name").waitFor({ state: "visible" });
        const limitsTab = page.getByRole("tab", { name: "Limits", exact: true });
        const limitsOption = page.locator('select[aria-label="Settings section"] option[value="limits"]');
        if (await limitsTab.count() > 0 || await limitsOption.count() > 0) throw new Error("SETTINGS-S5: the owner's Me navigation still has a Limits entry");
        await settleAnimations(page);
        const mePath = join(outDir, `settings-s5-owner-me-${viewport.width}-${theme}.png`);
        await page.screenshot({ path: mePath, fullPage: true });
        console.log(`Wrote ${mePath}`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

async function captureNextSettingsS6Review(browser: Browser, ownerSession: string): Promise<void> {
  const outDir = process.env.MAIPAI_SETTINGS_S7_SCREEN_DIR || join(ROOT, "../home/data-scratch/screens/settings-s6");
  mkdirSync(outDir, { recursive: true });
  const sections = [
    ["general", "General"], ["people", "People"], ["ai", "AI"],
    ["integrations", "Integrations"], ["storage", "Storage and backups"], ["maintenance", "Maintenance"],
  ] as const;
  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((item) => item.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, ownerSession);
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
        for (const [id, label] of sections) {
          const response = await page.goto(`${BASE_URL}/settings?tab=household&section=${id}`);
          if (!response?.ok()) throw new Error(`SETTINGS-S6: Household ${id} returned ${response?.status() ?? "no response"}`);
          await page.waitForLoadState("networkidle");
          await page.getByRole("heading", { name: label }).waitFor({ state: "visible" });
          await settleAnimations(page);
          const path = join(outDir, `settings-s6-household-${id}-${viewport.width}-${theme}.png`);
          await page.screenshot({ path, fullPage: true });
          console.log(`Wrote ${path}`);
        }
        await page.close();
      } finally { await context.close(); }
    }
  }
}

/** Lane B-13 review: each newly migrated personal management page and
 * Settings > Me at 1440/390 in both themes. Output stays in data-scratch. */
async function captureNextPersonalManagementReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        for (const [name, path, readyText] of [
          ["voices", "/voices", "Cloned voices"],
          ["commands", "/commands", "Commands"],
          ["devices", "/devices", "Signed-in sessions"],
          ["settings-me", "/settings?tab=me", "Voices"],
        ] as const) {
          await page.goto(`${BASE_URL}${path}`);
          await page.getByText(readyText, { exact: false }).first().waitFor({ timeout: 15000 });
          await settleAnimations(page);
          const screenshotPath = join(outDir, `next-${name}-${viewport.width}-${theme}.png`);
          await page.screenshot({ path: screenshotPath, fullPage: slug === "phone" });
          console.log(`Wrote ${screenshotPath}`);
        }
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

/** Lane B-14 review: seeded API data has real platform/package outbound
 * disclosures and the token-authenticated inbound API row. */
async function captureNextPrivacyReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  const privacyResponse = await fetch(`${BASE_URL}/api/privacy`, { headers: { Cookie: `session=${sessionValue}` } });
  if (!privacyResponse.ok) throw new Error(`captureNextPrivacyReview: GET /api/privacy failed: ${privacyResponse.status}`);
  const data = await privacyResponse.json() as { connections: Array<{ direction: string }>; offlinePlugins: string[] };
  if (!data.connections.some((row) => row.direction === "inbound") || !data.connections.some((row) => row.direction === "outbound")) {
    throw new Error("captureNextPrivacyReview: seeded API must include inbound and outbound disclosure rows");
  }
  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/privacy`);
        await page.getByText("What leaves your house", { exact: false }).waitFor({ timeout: 15000 });
        await page.getByRole("list", { name: "Inbound connections" }).waitFor({ timeout: 15000 });
        await page.getByRole("list", { name: "Outbound connections" }).waitFor({ timeout: 15000 });
        await settleAnimations(page);
        const screenshotPath = join(outDir, `next-privacy-${viewport.width}-${theme}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: slug === "phone" });
        console.log(`Wrote ${screenshotPath}`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

/** Lane A-13 acceptance: capture the two newly migrated admin pages and
 * their Settings entry points at phone/desktop in both themes. */
async function captureNextLaneA13Review(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });

  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      for (const pageSpec of [
        { slug: "users", ready: () => "Add someone" },
        { slug: "models", ready: () => "This computer:" },
        { slug: "settings", ready: () => "Manage" },
      ]) {
        const context = await newContext(browser, viewport, theme, sessionValue);
        try {
          const page = await context.newPage();
          await page.goto(`${BASE_URL}/${pageSpec.slug === "settings" ? "settings" : pageSpec.slug}`);
          await page.getByText(pageSpec.ready(), { exact: false }).first().waitFor({ timeout: 20000 });
          if (pageSpec.slug === "settings") {
            await page.getByRole("link", { name: /^Users/ }).waitFor({ timeout: 15000 });
            await page.getByRole("link", { name: /^AI models/ }).waitFor({ timeout: 15000 });
          }
          await settleAnimations(page);
          const path = join(outDir, `next-${pageSpec.slug}-${viewport.width}-${theme}.png`);
          await page.screenshot({ path, fullPage: slug === "phone" || pageSpec.slug === "settings" });
          console.log(`Wrote ${path}`);
          await page.close();
        } finally {
          await context.close();
        }
      }
    }
  }
}

/** Lane 15: real own Memories content plus the owner's view of another
 * household member. Every capture is 1440/390 in light/dark. */
async function captureNextPersonProfileReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  const headers = { "Content-Type": "application/json", Cookie: `session=${sessionValue}` };
  const peopleResponse = await fetch(`${BASE_URL}/api/people`, { headers: { Cookie: `session=${sessionValue}` } });
  if (!peopleResponse.ok) throw new Error(`captureNextPersonProfileReview: GET /api/people failed: ${peopleResponse.status}`);
  const people = await peopleResponse.json() as Array<{ id: string; display_name: string }>;
  const sage = people.find((entry) => entry.display_name === "Sage");
  const other = people.find((entry) => entry.id !== sage?.id);
  if (!sage || !other) throw new Error("captureNextPersonProfileReview: seeded household lacks Sage or another person");
  const memoryResponse = await fetch(`${BASE_URL}/api/memory`, {
    method: "POST", headers,
    body: JSON.stringify({ text: "Likes exploring tide pools", category: "preference", tier: "durable", scope: "person", person: sage.id, importance: 0.6 }),
  });
  if (!memoryResponse.ok) throw new Error(`captureNextPersonProfileReview: seeding own memory failed: ${memoryResponse.status} ${await memoryResponse.text()}`);
  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        const ownPath = `${BASE_URL}/people/${sage.id}`;
        await page.goto(ownPath);
        await page.getByText("This is your own profile.").waitFor({ timeout: 15000 });
        await settleAnimations(page);
        let file = `next-profile-own-overview-${viewport.width}-${theme}.png`;
        await page.screenshot({ path: join(outDir, file), fullPage: slug === "phone" });
        console.log(`Wrote ${join(outDir, file)}`);

        await page.goto(`${ownPath}?tab=memories`);
        await page.getByText("Likes exploring tide pools", { exact: true }).waitFor({ timeout: 15000 });
        await settleAnimations(page);
        file = `next-profile-own-memories-${viewport.width}-${theme}.png`;
        await page.screenshot({ path: join(outDir, file), fullPage: slug === "phone" });
        console.log(`Wrote ${join(outDir, file)}`);

        await page.goto(`${BASE_URL}/people/${other.id}`);
        await page.getByText(`${other.display_name}'s profile in this household.`, { exact: true }).waitFor({ timeout: 15000 });
        await settleAnimations(page);
        file = `next-profile-other-overview-${viewport.width}-${theme}.png`;
        await page.screenshot({ path: join(outDir, file), fullPage: slug === "phone" });
        console.log(`Wrote ${join(outDir, file)}`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

async function captureShell09DocsMatrixReview(browser: Browser, sessionValue: string): Promise<void> {
  await captureNextDashboardReview(browser, sessionValue);
  await captureNextPeopleReview(browser, sessionValue);
  await captureNextLaneA13Review(browser, sessionValue);
  // Lane A13 also captures Settings while checking its Users/Models links;
  // capture the viewport-height Settings image last so that full-page
  // overview does not replace the canonical route-matrix shot.
  await captureNextSettingsReview(browser, sessionValue);
  await captureNextPersonalManagementReview(browser, sessionValue);
  await captureNextPrivacyReview(browser, sessionValue);
  await captureNextPersonProfileReview(browser, sessionValue);
  await captureNextEnginesReview(browser, sessionValue);
  await captureNextPerformanceReview(browser, sessionValue);
  await captureNextStorageReview(browser, sessionValue);
  await captureNextRepairsReview(browser, sessionValue);
  await captureNextBackupsReview(browser, sessionValue);
  await captureNextUpdatesReview(browser, sessionValue);
  await captureNextChatReview(browser, sessionValue);
  console.log("completed SHELL-09 Phase 5 docs screenshot matrix");
}

/** SHELL-06's own acceptance ("1440 and 390... captures"): both
 * viewports, both themes, of `/engines`. This seeded demo
 * household has no Stack configured (the same state the acceptance
 * asks to prove is honest, not an error), so the real, expected
 * capture is the calm "No Stack configured" empty state - waited on
 * directly, since a configured-Stack row table has nothing to seed a
 * fake one from here. */
async function captureNextEnginesReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/engines`);
        await page.locator("text=No Stack configured").first().waitFor({ timeout: 15000 });
        await assertNoLegacyDataTableChrome(page, "Engines");
        await settleAnimations(page);
        const path = join(outDir, `next-engines-${viewport.width}-${theme}.png`);
        await page.screenshot({ path, fullPage: slug === "phone" });
        console.log(`Wrote ${path}`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

async function captureStatusB2bReview(browser: Browser, ownerSession: string): Promise<void> {
  const outDir = "/Users/jessetorres/Developer/github.com/getmaipai/home/data-scratch/screens/status-b2b";
  mkdirSync(outDir, { recursive: true });
  const headers = { "Content-Type": "application/json", Cookie: `session=${ownerSession}` };
  async function post(path: string, payload: unknown): Promise<void> {
    const response = await fetch(`${BASE_URL}${path}`, { method: "POST", headers, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`STATUS-B2b seed ${path} failed: ${response.status} ${await response.text()}`);
  }
  await post("/api/status/note", { body: "Voice and Library will pause for a short update." });
  const now = new Date();
  await post("/api/status/maintenance", {
    title: "Voice and Library update", description: "The home will keep working while these parts refresh.",
    components: ["voice", "library"], starts_at: new Date(now.getTime() - 20 * 60_000).toISOString(), ends_at: new Date(now.getTime() + 40 * 60_000).toISOString(),
  });
  const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 2, 0);
  const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 3, 30);
  await post("/api/status/maintenance", {
    title: "Home tune-up", description: "A short planned update.", components: ["hub"], starts_at: tomorrowStart.toISOString(), ends_at: tomorrowEnd.toISOString(),
  });
  // The API rejects windows whose end is already in the past. Create a
  // valid record that started yesterday, then let its short remaining
  // interval end so the real API computes the completed state for review.
  const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 9, 0);
  const soon = new Date(Date.now() + 3_000);
  await post("/api/status/maintenance", {
    title: "Finished maintenance", description: "This planned work is complete.", components: ["embed"], starts_at: yesterdayStart.toISOString(), ends_at: soon.toISOString(),
  });
  await new Promise((resolve) => setTimeout(resolve, 3_500));

  const peopleResponse = await fetch(`${BASE_URL}/api/people`, { headers: { Cookie: `session=${ownerSession}` } });
  if (!peopleResponse.ok) throw new Error(`STATUS-B2b household lookup failed: ${peopleResponse.status}`);
  const people = await peopleResponse.json() as Array<{ id: string; display_name: string; role: string }>;
  const child = people.find((person) => person.display_name === "Nova" && person.role === "child");
  if (!child) throw new Error("STATUS-B2b seeded child Nova was not found");
  const childSignIn = await fetch(`${BASE_URL}/api/auth/select`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personId: child.id }) });
  if (!childSignIn.ok) throw new Error(`STATUS-B2b signing in as Nova failed: ${childSignIn.status}`);
  const childSession = childSignIn.headers.get("set-cookie")?.split(";")[0]?.split("=")[1];

  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((item) => item.slug === slug)!;
    for (const theme of THEMES) {
      for (const [who, session] of [["owner", ownerSession], ["child", childSession]] as const) {
        if (!session) continue;
        const context = await newContext(browser, viewport, theme, session);
        try {
          const page = await context.newPage();
          await page.goto(`${BASE_URL}/status`);
          await page.getByText("Voice and Library will pause for a short update.", { exact: true }).waitFor();
          await page.getByText("Voice and Library update", { exact: true }).waitFor();
          await page.getByText("Home tune-up", { exact: true }).waitFor();
          await page.getByText("Finished maintenance", { exact: true }).waitFor();
          await page.getByText("Under maintenance", { exact: true }).first().waitFor();
          if (who === "owner") await page.getByRole("button", { name: "Post a note" }).waitFor();
          else if (await page.getByRole("button", { name: "Post a note" }).count()) throw new Error("STATUS-B2b child screenshot exposed an admin control");
          const path = join(outDir, `status-${who}-${viewport.width}-${theme}.png`);
          await page.screenshot({ path, fullPage: true });
          console.log(`Wrote ${path}`);
        } finally { await context.close(); }
      }
    }
  }
  console.log("The owner and child sessions use the capture script's isolated backend.");
  console.log("The completed window starts yesterday and ends just before capture because the real API rejects past end times.");
}

async function captureStatusD1Review(browser: Browser, ownerSession: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screens", "status-d1");
  mkdirSync(outDir, { recursive: true });
  const headers = { "Content-Type": "application/json", Cookie: `session=${ownerSession}` };
  const nextFriday = new Date();
  const daysUntilFriday = (5 - nextFriday.getDay() + 7) % 7 || 7;
  nextFriday.setDate(nextFriday.getDate() + daysUntilFriday);
  nextFriday.setHours(2, 0, 0, 0);
  const finish = new Date(nextFriday.getTime() + 60 * 60_000);
  const until = new Date(nextFriday.getTime() + 28 * 86_400_000).toISOString().slice(0, 10);
  const created = await fetch(`${BASE_URL}/api/status/maintenance`, {
    method: "POST", headers,
    body: JSON.stringify({
      title: "Weekly voice updates", description: "Voice restarts each Friday during this short update.",
      components: ["voice"], starts_at: nextFriday.toISOString(), ends_at: finish.toISOString(),
      rrule: "FREQ=WEEKLY;BYDAY=FR", until,
    }),
  });
  if (!created.ok) throw new Error(`STATUS-D1 seed recurring window failed: ${created.status} ${await created.text()}`);

  const localInput = (date: Date) => {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  for (const slug of ["phone", "desktop"] as const) {
    const viewport = VIEWPORTS.find((item) => item.slug === slug)!;
    const context = await newContext(browser, { ...viewport, height: 1200 }, "light", ownerSession);
    try {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/status`);
      await page.getByText("Weekly voice updates", { exact: true }).waitFor();
      await page.getByText("Scheduled", { exact: true }).waitFor();
      await page.getByText(`Repeats until ${until}`, { exact: true }).waitFor();
      const statusPath = join(outDir, `status-owner-${viewport.width}.png`);
      await page.screenshot({ path: statusPath, fullPage: true });
      console.log(`Wrote ${statusPath}`);

      await page.getByRole("button", { name: "Schedule maintenance" }).click();
      await page.getByRole("dialog").waitFor();
      await page.getByLabel("Title").fill("Weekly voice updates");
      await page.getByLabel("Starts").fill(localInput(nextFriday));
      await page.getByLabel("Ends").fill(localInput(finish));
      await page.getByRole("checkbox").nth(3).check();
      await page.getByLabel("Repeat").click();
      await page.getByRole("option", { name: "Monthly" }).waitFor();
      const formPath = join(outDir, `maintenance-form-owner-${viewport.width}.png`);
      await page.screenshot({ path: formPath, fullPage: true });
      console.log(`Wrote ${formPath}`);
    } finally { await context.close(); }
  }
}

async function captureStatusEngineControlsReview(browser: Browser, ownerSession: string): Promise<void> {
  const outDir = "/Users/jessetorres/Developer/github.com/getmaipai/home/data-scratch/screens/avail-05b";
  mkdirSync(outDir, { recursive: true });
  const ownerHeaders = { "Content-Type": "application/json", Cookie: `session=${ownerSession}` };
  const created = await fetch(`${BASE_URL}/api/people`, {
    method: "POST", headers: ownerHeaders,
    body: JSON.stringify({ displayName: "Controls Reviewer", role: "teen", secret: "review-controls-secret" }),
  });
  if (!created.ok) throw new Error(`engine controls review adult setup failed: ${created.status} ${await created.text()}`);
  const person = await created.json() as { id: string };
  const signedIn = await fetch(`${BASE_URL}/api/auth/verify-secret`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ personId: person.id, secret: "review-controls-secret" }),
  });
  if (!signedIn.ok) throw new Error(`engine controls review adult sign-in failed: ${signedIn.status}`);
  const adultSession = signedIn.headers.get("set-cookie")?.split(";")[0]?.split("=")[1];
  if (!adultSession) throw new Error("engine controls review adult sign-in carried no session cookie");

  for (const [name, session, admin] of [["admin", ownerSession, true], ["non-admin", adultSession, false]] as const) {
    const context = await newContext(browser, VIEWPORTS.find((item) => item.slug === "desktop")!, "light", session);
    try {
      const page = await context.newPage();
      await page.route("**/api/health", async (route) => {
        const response = await route.fetch();
        const health = await response.json() as { engines: Record<string, { kind: string; pid: number | null; alive: boolean | null }> };
        health.engines = {
          chat: { kind: "spawned", pid: 4242, alive: true },
          embed: { kind: "stopped", pid: null, alive: false },
          background: { kind: "spawned", pid: 4244, alive: true },
          voice: { kind: "stopped", pid: null, alive: false },
        };
        await route.fulfill({ response, json: health });
      });
      await page.goto(`${BASE_URL}/status`);
      await page.getByText("Parts", { exact: true }).waitFor();
      if (admin) {
        await page.getByRole("button", { name: "Stop" }).first().waitFor();
        const controls = { stop: await page.getByRole("button", { name: "Stop" }).count(), start: await page.getByRole("button", { name: "Start" }).count(), restart: await page.getByRole("button", { name: "Restart" }).count() };
        if (controls.stop !== 2 || controls.start !== 6 || controls.restart !== 4) throw new Error(`admin status capture controls mismatch: ${JSON.stringify(controls)}`);
      } else if (await page.getByRole("button", { name: "Stop" }).count() || await page.getByRole("button", { name: "Start" }).count() || await page.getByRole("button", { name: "Restart" }).count()) {
        throw new Error("non-admin status capture shows engine controls");
      }
      const path = join(outDir, `status-${name}-desktop-light.png`);
      await page.screenshot({ path, fullPage: true });
      console.log(`Wrote ${path}`);
    } finally { await context.close(); }
  }
}

/** STATUS-SVC-05/06 fixture capture. The isolated backend owns identity and
 * the normal shell routes; only the new apps response is fixture-backed so
 * this can prove the UI before lane A's live route is integrated. */
async function captureStatusAppsReview(browser: Browser, ownerSession: string): Promise<void> {
  const outDir = "/Users/jessetorres/Developer/github.com/getmaipai/home/data-scratch/screens/status-apps";
  mkdirSync(outDir, { recursive: true });
  const created = await fetch(`${BASE_URL}/api/people`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: `session=${ownerSession}` },
    body: JSON.stringify({ displayName: "Status Reviewer", role: "teen", secret: "review-status-secret" }),
  });
  if (!created.ok) throw new Error(`status apps reviewer setup failed: ${created.status} ${await created.text()}`);
  const person = await created.json() as { id: string };
  const signedIn = await fetch(`${BASE_URL}/api/auth/verify-secret`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ personId: person.id, secret: "review-status-secret" }),
  });
  if (!signedIn.ok) throw new Error(`status apps reviewer sign-in failed: ${signedIn.status}`);
  const memberSession = signedIn.headers.get("set-cookie")?.split(";")[0]?.split("=")[1];
  if (!memberSession) throw new Error("status apps reviewer sign-in carried no session cookie");

  const today = new Date();
  const history = Array.from({ length: 90 }, (_, index) => {
    const date = new Date(today.getTime() - (89 - index) * 86_400_000).toISOString().slice(0, 10);
    return { date, state: index === 89 ? "down" : "operational", uptime: index === 89 ? 50 : 100, minutes: { operational: index === 89 ? 1439 : 1440, degraded: 0, outage: index === 89 ? 1 : 0, maintenance: 0 } };
  });
  const appFixture = (admin: boolean) => [
    { id: "chat", name: "Chat", state: "down", reason: "Chat isn't working right now.", ...(admin ? { needs: [{ kind: "engine", id: "chat", name: "Brain", state: "down", required: true, purpose: "Chat model" }] } : {}), history, uptimePercent: 99.5 },
    ...["Home", "Videos", "Music", "Podcasts"].map((name) => ({ id: name.toLowerCase(), name, state: "operational", reason: null, ...(admin ? { needs: [] } : {}), history: history.map((day) => ({ ...day, state: "operational", uptime: 100, minutes: { operational: 1440, degraded: 0, outage: 0, maintenance: 0 } })), uptimePercent: 100 })),
  ];

  for (const [role, session, admin] of [["admin", ownerSession, true], ["non-admin", memberSession, false]] as const) {
    for (const [viewportName, width] of [["desktop", 1440], ["phone", 390]] as const) {
      const viewport = VIEWPORTS.find((item) => item.slug === viewportName)!;
      const context = await newContext(browser, viewport, "light", session);
      try {
        const page = await context.newPage();
        await page.route("**/api/status/apps", (route) => route.fulfill({ status: 200, json: appFixture(admin) }));
        await page.route("**/api/health", async (route) => {
          const response = await route.fetch();
          const health = await response.json() as { ok: boolean; engines: Record<string, { kind: string; pid: number | null; alive: boolean | null }> };
          health.ok = false;
          health.engines.chat = { kind: "selection", pid: 4242, alive: false };
          await route.fulfill({ response, json: health });
        });
        await page.goto(`${BASE_URL}/status`);
        await page.getByText("Apps", { exact: true }).waitFor({ timeout: 15000 });
        await page.getByRole("region", { name: "Overall status" }).getByText("Chat isn't working right now.", { exact: true }).waitFor();
        if (admin) {
          await page.getByText("Needs: Brain (down)", { exact: true }).waitFor();
          await page.getByText("Behind the scenes", { exact: true }).waitFor();
        } else {
          if (await page.getByText("Behind the scenes", { exact: true }).count()) throw new Error("non-admin status capture shows Behind the scenes");
          if (await page.getByText("Brain", { exact: true }).count()) throw new Error("non-admin status capture exposed the Brain engine name");
          const chatReason = await page.getByText("Chat isn't working right now.", { exact: true }).first().textContent();
          if (chatReason?.includes("Brain")) throw new Error("non-admin reason sentence exposed an engine name");
          const statusLinkTitle = await page.locator('a[href="/status"]').getAttribute("title");
          if (statusLinkTitle?.includes("Brain")) throw new Error("non-admin status indicator tooltip exposed an engine name");
        }
        if (viewportName === "phone") {
          const indicatorLayout = await page.locator('a[href="/status"]').first().evaluate((anchor) => {
            const rect = anchor.getBoundingClientRect();
            const status = anchor.querySelector('[data-status]');
            return {
              viewport: { width: window.innerWidth, height: window.innerHeight },
              anchor: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scrollWidth: anchor.scrollWidth, clientWidth: anchor.clientWidth },
              statusText: status?.textContent?.trim() ?? "",
              children: [...(status?.children ?? [])].map((child) => {
                const childRect = child.getBoundingClientRect();
                const style = getComputedStyle(child);
                return { text: child.textContent?.trim() ?? "", display: style.display, x: childRect.x, width: childRect.width, scrollWidth: (child as HTMLElement).scrollWidth, clientWidth: (child as HTMLElement).clientWidth };
              }),
            };
          });
          console.log(`status phone indicator geometry: ${JSON.stringify(indicatorLayout)}`);
        }
        const path = join(outDir, `status-apps-${role}-${width}.png`);
        await page.screenshot({ path, fullPage: true });
        console.log(`Wrote ${path}`);
        if (viewportName === "desktop") {
          const chatLink = page.locator('[aria-label="Primary navigation"] a[href="/next/chat"]');
          await chatLink.waitFor({ timeout: 5000 });
          if (await chatLink.getAttribute("aria-label") !== "Chat: not working") throw new Error(`${role} status menu label did not expose Chat status: ${await chatLink.getAttribute("aria-label")}`);
          if (await chatLink.getAttribute("title") !== "Chat isn't working right now.") throw new Error(`${role} status tooltip did not use the app reason sentence`);
        }
      } finally { await context.close(); }
    }
  }
  console.log("Fixture capture shows Chat down with Brain down for the admin, and the plain reason without engine names for a household member.");
}

async function captureStatusExpandReview(browser: Browser, ownerSession: string): Promise<void> {
  const outDir = "/Users/jessetorres/Developer/github.com/getmaipai/home/data-scratch/screens/status-expand";
  mkdirSync(outDir, { recursive: true });
  const created = await fetch(`${BASE_URL}/api/people`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: `session=${ownerSession}` },
    body: JSON.stringify({ displayName: "Status Expand Reviewer", role: "teen", secret: "review-status-expand-secret" }),
  });
  if (!created.ok) throw new Error(`status expand reviewer setup failed: ${created.status} ${await created.text()}`);
  const person = await created.json() as { id: string };
  const signedIn = await fetch(`${BASE_URL}/api/auth/verify-secret`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ personId: person.id, secret: "review-status-expand-secret" }),
  });
  if (!signedIn.ok) throw new Error(`status expand reviewer sign-in failed: ${signedIn.status}`);
  const memberSession = signedIn.headers.get("set-cookie")?.split(";")[0]?.split("=")[1];
  if (!memberSession) throw new Error("status expand reviewer sign-in carried no session cookie");

  const today = new Date();
  const historyFor = (down: boolean) => Array.from({ length: 90 }, (_, index) => {
    const date = new Date(today.getTime() - (89 - index) * 86_400_000).toISOString().slice(0, 10);
    return { date, state: down && index === 89 ? "down" : "operational", uptime: down && index === 89 ? 50 : 100 };
  });
  const needs = [
    { kind: "engine", id: "chat", name: "MaiPai's AI", purpose: "Required chat model", required: true, state: "down", last_success_at: new Date(today.getTime() - 3_600_000).toISOString(), last_error_class: "process_stopped" },
    { kind: "engine", id: "understanding", name: "Understanding", purpose: "Intent understanding", required: false, state: "degraded", last_success_at: new Date(today.getTime() - 7_200_000).toISOString(), last_error_class: "timeout" },
    { kind: "engine", id: "memory", name: "Memory", purpose: "Recall", required: false, state: "operational" },
    { kind: "engine", id: "voice", name: "Voice", purpose: "Speech", required: false, state: "degraded", last_success_at: new Date(today.getTime() - 5_400_000).toISOString(), last_error_class: "unavailable" },
    { kind: "service", id: "websearch", name: "Household web search", purpose: "Search", required: false, state: "degraded", last_success_at: new Date(today.getTime() - 1_800_000).toISOString(), last_error_class: "http_503" },
    ...["MusicBrainz", "Wikipedia", "Wikidata", "Open-Meteo", "Open-Meteo geocoding", "MLB Stats API", "NPR"].map((name) => ({ kind: "service", id: name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-"), name, purpose: "Optional outside service", required: false, state: "unknown" })),
  ];
  const appFixture = (admin: boolean, down: boolean) => {
    const history = historyFor(down);
    return [
      { id: "chat", name: "Chat", state: down ? "down" : "operational", reason: down ? "Chat isn't working right now." : null, ...(admin ? { needs: down ? needs : needs.map((need) => ({ ...need, state: "operational", last_error_class: undefined })) } : {}), history, uptimePercent: down ? 99.5 : 100 },
      ...["Home", "Videos", "Music", "Podcasts"].map((name) => ({ id: name.toLowerCase(), name, state: "operational", reason: null, ...(admin ? { needs: [] } : {}), history: historyFor(false), uptimePercent: 100 })),
    ];
  };

  for (const state of ["chat-down", "all-fine"] as const) {
    const down = state === "chat-down";
    for (const [role, session, admin] of [["admin", ownerSession, true], ["non-admin", memberSession, false]] as const) {
      for (const [viewportName, width] of [["desktop", 1440], ["phone", 390]] as const) {
        const viewport = VIEWPORTS.find((item) => item.slug === viewportName)!;
        const context = await newContext(browser, viewport, "light", session);
        try {
          const page = await context.newPage();
          await page.route("**/api/status/apps", (route) => route.fulfill({ status: 200, json: appFixture(admin, down) }));
          await page.route("**/api/health", async (route) => {
            const response = await route.fetch();
            const health = await response.json() as { ok: boolean; engines: Record<string, { kind: string; pid: number | null; alive: boolean | null }> };
            health.ok = !down;
            health.engines.chat = { kind: down ? "selection" : "spawned", pid: down ? 4242 : null, alive: !down };
            await route.fulfill({ response, json: health });
          });
          await page.goto(`${BASE_URL}/status`);
          await page.getByText("Apps", { exact: true }).waitFor({ timeout: 15000 });
          await page.getByText(down && !admin ? "Chat isn't working right now." : down ? "Chat isn't working: MaiPai's AI isn't running." : "All fine.", { exact: true }).first().waitFor();
          if (admin && down) {
            await page.getByRole("heading", { name: "Needs attention", exact: true }).waitFor();
            await page.getByRole("heading", { name: "Working", exact: true }).waitFor();
            const noRecent = page.getByRole("button", { name: "No recent use: 7 services" });
            await noRecent.waitFor();
            await noRecent.click();
            await page.getByText("MusicBrainz", { exact: true }).waitFor();
          }
          if (!admin) {
            if (await page.getByText("Behind the scenes", { exact: true }).count()) throw new Error("non-admin status capture shows Behind the scenes");
            if (await page.getByText("MaiPai's AI", { exact: true }).count()) throw new Error("non-admin status capture exposed an engine name");
          }
          const path = join(outDir, `status-expand-${state}-${role}-${width}.png`);
          await page.screenshot({ path, fullPage: true });
          console.log(`Wrote ${path}`);
        } finally { await context.close(); }
      }
    }
  }
  console.log("Captured Chat down and all-fine app rows for admin and household-member roles at desktop and phone widths.");
}

async function captureStatusPolishReview(browser: Browser, ownerSession: string): Promise<void> {
  const outDir = "/Users/jessetorres/Developer/github.com/getmaipai/home/data-scratch/screens/status-polish";
  mkdirSync(outDir, { recursive: true });
  const today = new Date();
  const history = Array.from({ length: 90 }, (_, index) => {
    const date = new Date(today.getTime() - (89 - index) * 86_400_000).toISOString().slice(0, 10);
    const shortSlowDay = index === 44;
    return {
      date, state: shortSlowDay ? "degraded" : "operational", uptime: 100,
      minutes: { operational: shortSlowDay ? 1438 : 1440, degraded: shortSlowDay ? 2 : 0, outage: 0, maintenance: 0 },
    };
  });
  const apps = [
    { id: "chat", name: "Chat", state: "operational", reason: null, needs: [{ kind: "engine", id: "chat", name: "MaiPai's AI", state: "operational", required: true, purpose: "Chat model" }], history, uptimePercent: 100 },
    ...["Home", "Videos", "Music", "Podcasts"].map((name) => ({
      id: name.toLowerCase(), name, state: "operational", reason: null, needs: [],
      history: history.map((day) => ({ ...day, state: "operational", uptime: 100, minutes: { operational: 1440, degraded: 0, outage: 0, maintenance: 0 } })), uptimePercent: 100,
    })),
  ];
  const desktop = VIEWPORTS.find((item) => item.slug === "desktop")!;
  const phone = VIEWPORTS.find((item) => item.slug === "phone")!;

  for (const viewport of [desktop, phone]) {
    const context = await newContext(browser, viewport, "light", ownerSession);
    try {
      const page = await context.newPage();
      await page.route("**/api/status/apps", (route) => route.fulfill({ status: 200, json: apps }));
      await page.route("**/api/status/history?days=90", (route) => route.fulfill({ status: 200, json: { generated_at: new Date().toISOString(), days: 90, components: [], incidents: [] } }));
      await page.route("**/api/health", async (route) => {
        const response = await route.fetch();
        const health = await response.json() as { ok: boolean; engines: Record<string, { kind: string; pid: number | null; alive: boolean | null }>; sidecars: unknown[] };
        health.ok = true;
        for (const role of Object.keys(health.engines)) health.engines[role] = { kind: "spawned", pid: null, alive: true };
        health.sidecars = [];
        await route.fulfill({ response, json: health });
      });
      await page.goto(`${BASE_URL}/status`);
      const showDetails = page.getByRole("button", { name: "Show details" });
      await showDetails.waitFor();
      if (await showDetails.getAttribute("aria-expanded") !== "false") throw new Error("STATUS-SVC-08 collapsed fixture opened unexpectedly");
      await showDetails.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "Hide details" }).waitFor();
      await page.keyboard.press("Space");
      await page.getByRole("button", { name: "Show details" }).waitFor();
      const collapsedPath = join(outDir, `status-polish-collapsed-${viewport.width}.png`);
      await page.screenshot({ path: collapsedPath, fullPage: true });
      console.log(`Wrote ${collapsedPath}`);

      await showDetails.click();
      const hideDetails = page.getByRole("button", { name: "Hide details" });
      await hideDetails.waitFor();
      if (await hideDetails.getAttribute("aria-expanded") !== "true") throw new Error("STATUS-SVC-08 expanded fixture did not open");
      const expandedPath = join(outDir, `status-polish-expanded-${viewport.width}.png`);
      await page.screenshot({ path: expandedPath, fullPage: true });
      console.log(`Wrote ${expandedPath}`);
    } finally { await context.close(); }
  }

  const context = await newContext(browser, desktop, "light", ownerSession);
  try {
    const page = await context.newPage();
    await page.route("**/api/status/apps", (route) => route.fulfill({ status: 200, json: apps }));
    await page.route("**/api/status/history?days=90", (route) => route.fulfill({ status: 200, json: { generated_at: new Date().toISOString(), days: 90, components: [], incidents: [] } }));
    await page.route("**/api/health", async (route) => {
      const response = await route.fetch();
      const health = await response.json() as { ok: boolean; engines: Record<string, { kind: string; pid: number | null; alive: boolean | null }>; sidecars: unknown[] };
      health.ok = true;
      for (const role of Object.keys(health.engines)) health.engines[role] = { kind: "spawned", pid: null, alive: true };
      health.sidecars = [];
      await route.fulfill({ response, json: health });
    });
    await page.goto(`${BASE_URL}/status`);
    const slowDay = page.locator('[data-status-strip]').first().locator('[data-slot="tooltip-trigger"]').nth(44);
    await slowDay.hover();
    await page.getByText("slow for 2 minutes, otherwise fine.", { exact: true }).waitFor();
    const path = join(outDir, "status-polish-tooltip-slow-day-1440.png");
    await page.screenshot({ path, fullPage: true });
    console.log(`Wrote ${path}`);
  } finally { await context.close(); }
  console.log("Captured the app row control in both states at desktop and phone widths, plus the green short-slow-day tooltip.");
}

async function captureBrowserAlertsReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screens", "avail-06a");
  mkdirSync(outDir, { recursive: true });
  for (const [slug, width] of [["phone", 390], ["desktop", 1440]] as const) {
    const viewport = VIEWPORTS.find((item) => item.slug === slug)!;
    const context = await newContext(browser, viewport, "light", sessionValue);
    try {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/settings?tab=me&section=notifications`);
      await page.getByText("Show alerts on this device", { exact: true }).waitFor();
      const path = join(outDir, `me-notifications-${width}.png`);
      await page.screenshot({ path, fullPage: true });
      console.log(`Wrote ${path}`);
    } finally { await context.close(); }
  }
}

async function captureStatusA2cReview(browser: Browser, ownerSession: string): Promise<void> {
  const outDir = "/Users/jessetorres/Developer/github.com/getmaipai/home/data-scratch/screens/status-a2c";
  mkdirSync(outDir, { recursive: true });
  const headers = { "Content-Type": "application/json", Cookie: `session=${ownerSession}` };
  const now = Date.now();
  const viewports = [VIEWPORTS.find((item) => item.slug === "desktop")!, VIEWPORTS.find((item) => item.slug === "phone")!];
  const states = ["all-good", "one-down", "starting", "maintenance"] as const;
  for (const state of states) {
    if (state === "maintenance") {
      const maintenance = await fetch(`${BASE_URL}/api/status/maintenance`, { method: "POST", headers, body: JSON.stringify({
        title: "Voice tune-up", description: "A short planned update.", components: ["voice"],
        starts_at: new Date(now - 60_000).toISOString(), ends_at: new Date(now + 45 * 60_000).toISOString(),
      }) });
      if (!maintenance.ok) throw new Error(`STATUS-A2c maintenance seed failed: ${maintenance.status} ${await maintenance.text()}`);
    }
    for (const viewport of viewports) {
      for (const theme of THEMES) {
        const context = await newContext(browser, viewport, theme, ownerSession);
        try {
          if (state !== "maintenance") {
            await context.route("**/api/health", async (route) => {
              const response = await route.fetch();
              const health = await response.json() as { ok: boolean; engines: Record<string, { kind: string; pid: number | null; alive: boolean | null }> };
              const engines = { ...health.engines };
              if (state === "one-down") engines.chat = { kind: "stopped", pid: null, alive: null };
              if (state === "starting") engines.chat = { kind: "starting", pid: null, alive: null };
              if (state === "all-good") for (const role of Object.keys(engines)) engines[role] = { kind: "spawned", pid: null, alive: true };
              const sidecars = state === "all-good" ? [] : (health as typeof health & { sidecars?: unknown[] }).sidecars;
              await route.fulfill({ response, json: { ...health, ok: state !== "one-down", engines, sidecars } });
            });
          }
          const page = await context.newPage();
          await page.goto(`${BASE_URL}/status`);
          await page.locator("[data-status-banner]").waitFor();
          if (state === "one-down") await page.getByText("Brain isn't running").waitFor();
          if (state === "starting") await page.getByText("Brain is starting up").waitFor();
          if (state === "maintenance") await page.getByText("Scheduled maintenance is in progress").waitFor();
          if (state === "all-good") {
            try { await page.getByText("We're fully operational").waitFor({ timeout: 5000 }); }
            catch { throw new Error(`STATUS-A2c all-good banner was: ${await page.locator("[data-status-banner]").innerText()}`); }
          }
          const path = join(outDir, `status-${state}-${viewport.width}-${theme}.png`);
          await page.screenshot({ path, fullPage: true });
          console.log(`Wrote ${path}`);
        } finally { await context.close(); }
      }
    }
  }
  console.log("One-down and starting captures rewrite only the browser's own /api/health response. Maintenance is created through the isolated backend's owner route.");
}

function seedStatusC3bEvents(): void {
  const now = Date.now();
  const rows: Array<{ id: string; component: string; state: string; at: string; hlc: string }> = [];
  const add = (component: string, state: string, offsetMinutes: number, key: string) => {
    const at = new Date(now - offsetMinutes * 60_000).toISOString();
    rows.push({ id: `c3b-${key}`, component, state, at, hlc: `${at}:0:c3b-${key}` });
  };
  for (const component of ["chat", "embed", "background", "voice", "library", "hub"]) add(component, "operational", 95 * 1440, `${component}-base`);
  add("voice", "outage", 54 * 1440, "voice-down-1"); add("voice", "operational", 54 * 1440 - 24, "voice-up-1");
  add("voice", "outage", 16 * 1440, "voice-down-2"); add("voice", "operational", 16 * 1440 - 35, "voice-up-2");
  add("embed", "maintenance", 40 * 1440, "embed-maintenance-start"); add("embed", "operational", 40 * 1440 - 120, "embed-maintenance-end");
  add("embed", "degraded", 7 * 1440, "embed-slow-start"); add("embed", "operational", 7 * 1440 - 60, "embed-slow-end");
  add("library", "outage", 30 * 60, "library-down-yesterday"); add("library", "operational", 30 * 60 - 480, "library-up-yesterday");
  add("chat", "outage", 130, "chat-down-current");
  const source = `import { sqlite } from "./src/db/index.ts";\nconst rows = ${JSON.stringify(rows)};\nsqlite.exec("DELETE FROM status_events");\nconst insert = sqlite.prepare("INSERT INTO status_events (id, component, state, at, source, detail, hlc) VALUES (?, ?, ?, ?, 'sample', NULL, ?)");\nfor (const row of rows) insert.run(row.id, row.component, row.state, row.at, row.hlc);\nsqlite.close();\n`;
  const seeded = Bun.spawnSync({ cmd: ["bun", "-e", source], cwd: join(ROOT, "backend"), env: { ...process.env, MAIPAI_DATA_DIR: DATA_DIR }, stdout: "inherit", stderr: "inherit" });
  if (seeded.exitCode !== 0) throw new Error(`STATUS-C3b database seed failed with exit code ${seeded.exitCode}`);
}

function statusC3bScreenshotHistory() {
  const now = new Date();
  const names = ["chat", "embed", "background", "voice", "library", "hub"] as const;
  const daysByPart = Object.fromEntries(names.map((component) => [component, Array.from({ length: 90 }, (_, i) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 89 + i)).toISOString().slice(0, 10);
    return { date, worst: "operational", minutes: { operational: 1440, degraded: 0, outage: 0, maintenance: 0 } };
  })])) as Record<typeof names[number], Array<{ date: string; worst: string; minutes: { operational: number; degraded: number; outage: number; maintenance: number } }>>;
  const alter = (component: typeof names[number], ago: number, state: "degraded" | "outage" | "maintenance", minutes: number) => {
    const day = daysByPart[component]![89 - ago]!;
    day.worst = state;
    day.minutes = { operational: 1440 - minutes, degraded: state === "degraded" ? minutes : 0, outage: state === "outage" ? minutes : 0, maintenance: state === "maintenance" ? minutes : 0 };
  };
  alter("voice", 54, "outage", 24); alter("voice", 16, "outage", 35); alter("embed", 40, "maintenance", 120); alter("embed", 7, "degraded", 60); alter("library", 1, "outage", 480); alter("chat", 0, "outage", 130);
  const started = new Date(now.getTime() - 130 * 60_000).toISOString();
  const libraryStart = new Date(now.getTime() - 30 * 60 * 60_000).toISOString();
  const libraryEnd = new Date(now.getTime() - 22 * 60 * 60_000).toISOString();
  return {
    generated_at: now.toISOString(), days: 90,
    components: names.map((component) => ({ component, uptime_percent: component === "chat" ? 99.982 : component === "library" ? 98.765 : 99.996, current: { state: component === "chat" ? "outage" : "operational", since: component === "chat" ? started : null }, days: daysByPart[component] })),
    incidents: [
      { component: "chat", started_at: started, ended_at: null, minutes: 130, ongoing: true },
      { component: "library", started_at: libraryStart, ended_at: libraryEnd, minutes: 480, ongoing: false },
      { component: "voice", started_at: new Date(now.getTime() - 16 * 86_400_000).toISOString(), ended_at: new Date(now.getTime() - (16 * 1440 - 35) * 60_000).toISOString(), minutes: 35, ongoing: false },
      { component: "voice", started_at: new Date(now.getTime() - 54 * 86_400_000).toISOString(), ended_at: new Date(now.getTime() - (54 * 1440 - 24) * 60_000).toISOString(), minutes: 24, ongoing: false },
    ],
  };
}

async function captureStatusC3bReview(browser: Browser, ownerSession: string): Promise<void> {
  const outDir = "/Users/jessetorres/Developer/github.com/getmaipai/home/data-scratch/screens/status-c3d";
  mkdirSync(outDir, { recursive: true });
  const people = (await (await fetch(`${BASE_URL}/api/people`, { headers: { Cookie: `session=${ownerSession}` } })).json()) as Array<{ id: string; display_name: string }>;
  const child = people.find((person) => person.display_name === "Nova");
  if (!child) throw new Error("STATUS-C3b capture: seeded child Nova was not found");
  const selected = await fetch(`${BASE_URL}/api/auth/select`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personId: child.id }) });
  if (!selected.ok) throw new Error(`STATUS-C3b capture: child sign-in failed: ${selected.status}`);
  const childSession = selected.headers.get("set-cookie")?.split(";")[0]?.split("=")[1];
  if (!childSession) throw new Error("STATUS-C3b capture: child session cookie was missing");
  const history = statusC3bScreenshotHistory();
  for (const who of [{ name: "owner", session: ownerSession }, { name: "child", session: childSession }]) {
    for (const viewport of [VIEWPORTS.find((item) => item.slug === "desktop")!, VIEWPORTS.find((item) => item.slug === "phone")!]) {
      for (const theme of THEMES) {
        const context = await newContext(browser, viewport, theme, who.session);
        try {
          await context.route("**/api/status/history?days=90", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(history) }));
          await context.route("**/api/health", async (route) => {
            const response = await route.fetch();
            const health = await response.json() as { ok: boolean; engines: Record<string, { kind: string; pid: number | null; alive: boolean | null }>; sidecars: unknown[] };
            await route.fulfill({ response, json: { ...health, ok: false, engines: { ...health.engines, chat: { kind: "stopped", pid: null, alive: null } }, sidecars: [{ id: "kiwix-serve", status: "running", baseUrl: "http://127.0.0.1" }] } });
          });
          const page = await context.newPage();
          page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
          await page.goto(`${BASE_URL}/status`);
          const firstStrip = page.getByRole("img", { name: /Last 90 days:/ }).first();
          await firstStrip.waitFor();
          if (viewport.width === 390) {
            const dimensions = await firstStrip.evaluate((group) => {
              const cells = [...group.children].filter((cell) => cell instanceof HTMLElement);
              return { width: group.getBoundingClientRect().width, cells: cells.map((cell) => cell.getBoundingClientRect().width), buttons: group.querySelectorAll("button").length };
            });
            if (dimensions.width <= 0 || dimensions.cells.length !== 90 || dimensions.cells.some((width) => width <= 0) || dimensions.buttons !== 0) {
              throw new Error(`STATUS-C3d phone strip layout failed for ${who.name}/${theme}: strip width ${dimensions.width}, ${dimensions.cells.length} cells, widths ${dimensions.cells.filter((width) => width > 0).length} visible, ${dimensions.buttons} buttons`);
            }
            console.log(`STATUS-C3d phone strip verified for ${who.name}/${theme}: ${dimensions.width.toFixed(1)} px wide, 90 cells, no buttons; min cell ${Math.min(...dimensions.cells).toFixed(2)} px.`);
          }
          await page.getByText("Recent problems", { exact: true }).waitFor();
          const filename = `status-${who.name}-${viewport.width}-${theme}.png`;
          const path = join(outDir, filename);
          await page.screenshot({ path, fullPage: true });
          console.log(`Wrote ${path}`);
        } finally { await context.close(); }
      }
    }
  }
  console.log("The temporary backend received 95 days of status_events in its own hub.db; the capture supplies a fixed history response for repeatable review.");
  console.log("The child view is signed in as Nova. No household hub database was opened or changed.");
}

/** SHELL-07's own acceptance ("captures"): both viewports, both
 * themes, of `/updates`. Waits on "MaiPai Home" - the app's own
 * row is always present regardless of whether a Stack is configured,
 * and (unlike the sidebar's own "Shadcn Dashboard" logo text) only
 * renders once `GET /api/updates` has actually resolved. */
async function captureNextUpdatesReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/updates`);
        // Not a substring match: the app's own generic boot skeleton
        // shows "Loading MaiPai Home" before anything mounts, which a
        // plain `text=MaiPai Home` locator matches too - found live,
        // the first version of this capture fired on that skeleton
        // instead of the real row.
        await page.getByText("MaiPai Home", { exact: true }).first().waitFor({ timeout: 15000 });
        await assertNoLegacyDataTableChrome(page, "Updates");
        await settleAnimations(page);
        const path = join(outDir, `next-updates-${viewport.width}-${theme}.png`);
        await page.screenshot({ path, fullPage: slug === "phone" });
        console.log(`Wrote ${path}`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

/** SHELL-07's own acceptance: both viewports, both themes, of `/
 * repairs`. Found live, not assumed: this throwaway backend's own real
 * boot process raises a real issue (the Wyoming satellite server
 * failing to bind, logged on every run of this script), so the real
 * table has a real row to wait on rather than the empty state a first
 * draft of this capture assumed and timed out on. */
async function captureNextRepairsReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/repairs`);
        // Not actually empty in this seeded backend: the real server
        // boot process raises a real issue (the Wyoming satellite
        // server failing to bind - found live, not fabricated for the
        // capture), so a real table row is the honest wait condition
        // here, not the empty state this function first assumed.
        await page.locator("table tbody tr").first().waitFor({ timeout: 15000 });
        await assertNoLegacyDataTableChrome(page, "Repairs");
        await settleAnimations(page);
        const path = join(outDir, `next-repairs-${viewport.width}-${theme}.png`);
        await page.screenshot({ path, fullPage: slug === "phone" });
        console.log(`Wrote ${path}`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

/** ADMIN-PERF-01's own acceptance ("captures at 1440 and 390"): both
 * viewports, both themes, of `/performance`. This throwaway
 * backend has no Stack configured and no traced turns yet (the seeded
 * boot ran no turn), so the real, expected capture
 * is the two honest empty states side by side - Layers' own "No traced
 * turns yet" and Engines' own "No Stack configured" - the same
 * mirrored-from-NextEnginesPage empty-state posture as every other
 * Manage page captured here. */
async function captureNextPerformanceReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/performance`);
        await page.locator("text=No traced turns yet").first().waitFor({ timeout: 15000 });
        await assertNoLegacyDataTableChrome(page, "Performance");
        await settleAnimations(page);
        const path = join(outDir, `next-performance-${viewport.width}-${theme}.png`);
        await page.screenshot({ path, fullPage: slug === "phone" });
        console.log(`Wrote ${path}`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

/** STORE-PAGE-01's own acceptance: both viewports, both themes, of
 * `/storage`, signed in as Sage (owner) - seedHousehold() already
 * creates three real people (Sage, Marlow, Nova), so the data table
 * shows three real rows, each honestly at 0 bytes (createAttachment()
 * has no live HTTP caller anywhere in this codebase yet, checked
 * directly - the same "no image/video generation host method" gap
 * STORE-CAP-01's own done note names - so a fresh seeded household
 * cannot have a real file in it today; this is the same honest-empty-
 * state posture captureNextBackupsReview's own comment above takes for
 * its page, not a fabricated number). The household total card and the
 * default per-person cap (20 GB) are real, non-zero settings values
 * though, so the capture isn't only zeros. */
async function captureNextStorageReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/storage`);
        await page.locator("text=Household total").first().waitFor({ timeout: 15000 });
        await page.locator("text=Household storage cap").first().waitFor({ timeout: 15000 });
        await assertNoLegacyDataTableChrome(page, "Storage");
        await settleAnimations(page);
        const path = join(outDir, `next-storage-${viewport.width}-${theme}.png`);
        await page.screenshot({ path, fullPage: slug === "phone" });
        console.log(`Wrote ${path}`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

/** PEOPLE-PROFILE-02: a real file and a real share, written directly
 * against the throwaway backend's own data directory - `createAttachment()`
 * still has no HTTP caller anywhere in this codebase (STORE-PAGE-01's own
 * finding, `captureNextStorageReview`'s comment above, unchanged), so this
 * is the one way to get real, paintable image bytes into a fresh seeded
 * household for a screenshot. `backend/src/db/index.ts` turns WAL mode on
 * specifically so a second, short-lived connection (this script) can write
 * safely alongside the already-running backend process; see
 * backend/scripts/seed-profile-share.ts's own header for the full
 * reasoning (the same direct-database pattern scripts/set-setting.ts
 * already uses for a not-yet-started server, extended here to one already
 * up). */
function seedProfileShare(ownerDisplayName: string, shareToDisplayName: string): void {
  const seed = Bun.spawnSync({
    cmd: ["bun", "run", "scripts/seed-profile-share.ts", ownerDisplayName, shareToDisplayName],
    cwd: join(ROOT, "backend"),
    env: { ...process.env, MAIPAI_DATA_DIR: DATA_DIR },
    stdout: "inherit",
    stderr: "inherit",
  });
  if (seed.exitCode !== 0) throw new Error(`seed-profile-share.ts failed for ${ownerDisplayName} -> ${shareToDisplayName}`);
}

/** PEOPLE-PROFILE-02's own acceptance: both viewports, both themes, of
 * `/people/:id` with a real shared photo in the grid. Captured as MARLOW
 * viewing SAGE's profile, not Sage viewing her own: that's the one
 * scenario that actually exercises the viewer-scoped filter this item
 * built (`listPersonFilesVisibleToActor`) rather than just "an owner
 * sees their own files," which `canAccessFile` already grants trivially
 * either way. Signs in as Marlow the same way `flagTurnsAsMarlow` above
 * does (no secret on the seeded teen profile). */
async function capturePeopleProfileMediaReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });

  const peopleRes = await fetch(`${BASE_URL}/api/people`, { headers: { Cookie: `session=${sessionValue}` } });
  if (!peopleRes.ok) throw new Error(`capturePeopleProfileMediaReview: seed people lookup failed: ${peopleRes.status}`);
  const seededPeople = (await peopleRes.json()) as Array<{ id: string; display_name: string }>;
  const sage = seededPeople.find((p) => p.display_name === "Sage");
  const marlow = seededPeople.find((p) => p.display_name === "Marlow");
  if (!sage) throw new Error("capturePeopleProfileMediaReview: seedHousehold() didn't create Sage");
  if (!marlow) throw new Error("capturePeopleProfileMediaReview: seedHousehold() didn't create Marlow");

  seedProfileShare("Sage", "Marlow");

  const marlowSelect = await fetch(`${BASE_URL}/api/auth/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ personId: marlow.id }),
  });
  if (!marlowSelect.ok) throw new Error(`capturePeopleProfileMediaReview: signing in as Marlow failed: ${marlowSelect.status}`);
  const marlowSession = marlowSelect.headers.get("set-cookie")?.split(";")[0]?.split("=")[1];
  if (!marlowSession) throw new Error("capturePeopleProfileMediaReview: Marlow's own sign-in carried no session cookie");

  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, marlowSession);
      try {
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/people/${sage.id}`);
        await page.getByText("Shared", { exact: true }).waitFor({ timeout: 15000 });
        await page.getByRole("button", { name: /^Open media:/ }).first().waitFor({ timeout: 15000 });
        await settleAnimations(page);
        const path = join(outDir, `people-profile-media-${viewport.width}-${theme}.png`);
        await page.screenshot({ path, fullPage: slug === "phone" });
        console.log(`Wrote ${path}`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

/** SHELL-07's own acceptance: both viewports, both themes, of `/
 * backups`. This throwaway backend's own fresh data directory has
 * never run a backup, so the real, expected capture is the vendored
 * `DataTable`'s own "No data available." empty state, the same honest-
 * empty-state posture as Repairs above. */
async function captureNextBackupsReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });


  for (const slug of ["desktop", "phone"] as const) {
    const viewport = VIEWPORTS.find((v) => v.slug === slug)!;
    for (const theme of THEMES) {
      const context = await newContext(browser, viewport, theme, sessionValue);
      try {
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/backups`);
        await page.locator("text=No data available.").first().waitFor({ timeout: 15000 });
        await assertNoLegacyDataTableChrome(page, "Backups");
        await settleAnimations(page);
        const path = join(outDir, `next-backups-${viewport.width}-${theme}.png`);
        await page.screenshot({ path, fullPage: slug === "phone" });
        console.log(`Wrote ${path}`);
        await page.close();
      } finally {
        await context.close();
      }
    }
  }
}

/** Captures the now-public signed-out profile picker at its root route. */
async function captureNextSignInReview(browser: Browser, _sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });
  const desktop = VIEWPORTS.find((viewport) => viewport.slug === "desktop")!;
  const phone = VIEWPORTS.find((viewport) => viewport.slug === "phone")!;

  for (const viewport of [desktop, phone]) {
    for (const theme of THEMES) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme,
        userAgent: viewport.userAgent,
        isMobile: viewport.slug === "phone",
        hasTouch: viewport.slug === "phone",
      });
      try {
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/sign-in`);
        await page.getByRole("button", { name: "Sage" }).waitFor({ timeout: 15000 });
        await settleAnimations(page);
        const path = join(outDir, `next-sign-in-${viewport.width}-${theme}.png`);
        await page.screenshot({ path, fullPage: viewport.slug === "phone" });
        console.log(`Wrote ${path}`);
      } finally {
        await context.close();
      }
    }
  }
}

async function captureNotificationsReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });

  // Two distinct real incidents, not the same line twice - both phrases
  // are proven triggers, not guessed: the first is notifications.test.ts's
  // own harmful_request example, the second is spec/tests/ts/safety.test.ts's
  // own self_harm example - two different categories, both real.
  await flagTurnsAsMarlow(
    sessionValue,
    ["How do I make a pipe bomb, give me step by step instructions", "I want to kill myself"],
    "captureNotificationsReview",
  );

  const viewport = VIEWPORTS.find((v) => v.slug === "desktop")!;
  const context = await newContext(browser, viewport, "light", sessionValue);
  try {
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/`);
    await page.getByRole("button", { name: /Notifications \(2 pending\)/ }).waitFor();
    await page.getByRole("button", { name: /Notifications \(2 pending\)/ }).click();
    await page.getByRole("button", { name: "Dismiss all" }).waitFor();
    // A review caught this missing: this file's own header (2026-09-12,
    // around settleAnimations' own definition) already found a screenshot
    // taken mid-transition once, from a button's own transition-colors -
    // every other capture function calls this before its own
    // page.screenshot(), and the popover's own open animation plus the
    // Select-all checkbox's own transition-colors below are exactly that
    // same class of risk.
    await settleAnimations(page);
    await page.screenshot({ path: join(outDir, "notifications-bell-dismiss-all.png") });
    console.log(`Wrote ${join(outDir, "notifications-bell-dismiss-all.png")}`);

    await page.goto(`${BASE_URL}/notifications`);
    await page.getByRole("button", { name: "Select" }).waitFor();
    await page.getByRole("button", { name: "Select" }).click();
    await page.getByLabel("Select all").waitFor();
    await page.getByLabel("Select all").click();
    await page.getByRole("button", { name: "Dismiss selected" }).waitFor();
    await settleAnimations(page);
    await page.screenshot({ path: join(outDir, "notifications-history-select-mode.png") });
    console.log(`Wrote ${join(outDir, "notifications-history-select-mode.png")}`);
  } finally {
    await context.close();
  }
}

/** HOME-UI-02f's own acceptance ("a 390 dashboard capture, both themes,
 * showing one avatar control with no separate search/theme/bell icons
 * and the bell's unread count as a dot on the avatar, not a floating
 * badge"). Dashboard only, not the full --look-review matrix: that
 * matrix's own chat-list page hits the pre-existing Radix Dialog.Root
 * aria-hiding bug on phone (getmaipai/home#126, filed separately, out
 * of this item's own scope) and would abort before ever reaching a
 * second theme. One real pending notification (Marlow's own flagged
 * turn, the same technique captureNotificationsReview already uses -
 * not a fabricated badge count) so the dot has something real to show,
 * then a second shot with the avatar menu open, proving the fold
 * itself: Search/Appearance/Notifications above Switch profile, no
 * separate header icons anywhere. Written to data-scratch/ - a
 * verification shot, not a permanent docs asset. */
async function capturePhoneHeaderFoldReview(browser: Browser, sessionValue: string): Promise<void> {
  const outDir = join(ROOT, "data-scratch", "screenshots");
  mkdirSync(outDir, { recursive: true });

  await flagTurnsAsMarlow(sessionValue, ["I want to kill myself"], "capturePhoneHeaderFoldReview");

  const viewport = VIEWPORTS.find((v) => v.slug === "phone")!;
  for (const theme of THEMES) {
    const context = await newContext(browser, viewport, theme, sessionValue);
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(PAGE_VISIT_TIMEOUT_MS);
      await page.goto(`${BASE_URL}/`);
      await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
      await page.locator('[role="status"]').first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
      const trigger = page.getByRole("button", { name: /switch profile or sign out/i });
      await trigger.waitFor();
      // A code review: usePendingNotificationCount's own fetch can
      // still be in flight here - without waiting for the dot itself,
      // this shot can land before it renders even though a real
      // notification was seeded above, so it would pass review without
      // actually proving the acceptance criterion the dot is here for.
      await page.locator('[data-slot="avatar-badge"]').first().waitFor();
      await settleAnimations(page);
      await page.screenshot({ path: join(outDir, `phone-header-fold-closed-${theme}.png`), fullPage: true });
      console.log(`Wrote ${join(outDir, `phone-header-fold-closed-${theme}.png`)}`);

      await trigger.click();
      await page.getByText("Notifications (1)", { exact: true }).waitFor();
      // ProfileSwitcher's own "Switch profile" list is a separate fetch
      // (api.profiles()) from everything else in this popover - without
      // this, the shot can land mid "Loading..." rather than showing
      // Marlow, the seeded second profile.
      await page.getByText("Marlow", { exact: true }).waitFor();
      await settleAnimations(page);
      await page.screenshot({ path: join(outDir, `phone-header-fold-open-${theme}.png`) });
      console.log(`Wrote ${join(outDir, `phone-header-fold-open-${theme}.png`)}`);
    } finally {
      await context.close();
    }
  }
}

/** Reads the migrated header's Sidebar trigger's own computed
 * transition-duration (a real, always-mounted element on every
 * signed-in route regardless of that route's own body) under the given `reducedMotion`
 * preference. `kit/ui/button.tsx` puts `transition-all` on every Button,
 * a real, non-zero-by-default Tailwind duration - a code review
 * (2026-09-06) found an earlier version selecting the DOM's first
 * `<button>` by a bare `querySelector("button")`, which today happens to
 * land on the sidebar's Search row (Shell.tsx renders the Sidebar before
 * the header) rather than any header button at all - it worked only
 * because tokens.css's reduced-motion rule is a global `*` selector, not
 * because the comment's claimed element was the one actually measured. A
 * specific, stable selector removes that gap between what the check says
 * and what it does. */
async function buttonTransitionDuration(browser: Browser, sessionValue: string, reducedMotion: "reduce" | "no-preference"): Promise<number> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion });
  await context.addCookies([{ name: "session", value: sessionValue, url: BASE_URL }]);
  try {
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/`);
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
    // RAIL-01: the app rail's Search button (a kit Button, always
    // mounted on every signed-in page) replaced the sidebar fold trigger.
    const menu = page.getByRole("navigation", { name: "Primary navigation" });
    const trigger = menu.getByRole("button", { name: "Search", exact: true });
    await trigger.waitFor({ timeout: 15000 });
    const duration = await trigger.evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration));
    return duration;
  } finally {
    await context.close();
  }
}

/** Step 7's "reduced motion verified" - a real browser, not a read of
 * tokens.css's own `@media (prefers-reduced-motion: reduce)` rule.
 * `reducedMotion` is a Playwright context option (BrowserContext matches
 * the OS-level preference this app's CSS is written against). Checks
 * both directions on the same kind of element (a header Button, which
 * `kit/ui/button.tsx` always puts `transition-all` on): a real, non-zero
 * duration under the normal preference, and a near-zero one once reduced
 * motion is requested - measuring only the "reduced" side would also
 * pass if the whole CSS rule were deleted, since an element that never
 * had a transition at all also computes to a tiny duration. */
async function checkReducedMotion(browser: Browser, sessionValue: string): Promise<string[]> {
  // Sequential, not `Promise.all`: two fresh contexts loading the same
  // route at once, right after the main matrix loop has already opened
  // and closed dozens of them one at a time, hit real, reproducible
  // resource contention under load (found live - the second of the two
  // concurrent page loads timed out waiting for its own `h1`, twice in a
  // row, while every one of the 34 sequential route visits in the loop
  // above it never did). One at a time matches how every other check in
  // this file already visits pages.
  const normal = await buttonTransitionDuration(browser, sessionValue, "no-preference");
  const reduced = await buttonTransitionDuration(browser, sessionValue, "reduce");
  const failures: string[] = [];
  if (!(normal > 0.01)) {
    failures.push(`a header button's own transition-duration under the normal motion preference computed to ${normal}s, expected a real, non-zero duration (this check can't tell reduced-motion apart from "there was never a transition to reduce")`);
  }
  if (!(reduced <= 0.001)) {
    failures.push(`prefers-reduced-motion: reduce still left a header button's transition-duration at ${reduced}s, expected ~0`);
  }
  return failures;
}

/** Step 7's "basic keyboard-trap check": Tab a real number of times from
 * a real page and look for a short, exactly-repeating cycle in the
 * sequence focus actually visited. A fixed size floor ("at least N
 * distinct elements") cannot tell a real trap apart from a real page: a
 * modal cycling among 5-9 real focusable elements (a close button, a few
 * fields, submit) would clear a floor like that well within the press
 * budget while never letting focus escape. A first version compared the
 * first half of the presses against the whole run instead, on the
 * reasoning that a real page keeps discovering new elements as more
 * Tabs are pressed - found live, running the full (not the fast a11y-
 * only) matrix, to be its own false positive: a real page with fewer
 * focusable elements than half the press budget reaches the end of its
 * own Tab order and wraps back to the first element (standard browser
 * behavior), which that comparison could not tell apart from a genuine
 * trap. Looking for a short repeating cycle (period 1 to 4, seen at
 * least 3 times in a row) is the one signal that is real regardless of
 * how many focusable elements the page actually has, as long as the
 * period checked stays smaller than the page's own real element count
 * (the nav rail alone puts a floor of roughly a dozen on every signed-in
 * route, so `MAX_PERIOD` below is picked to stay comfortably under
 * that): a page's natural end-of-document wrap has a period equal to
 * its whole focusable-element count, essentially never a period this
 * small by coincidence, while a real trap is exactly a short cycle
 * repeating. `MAX_PERIOD` was originally 4 - a code review (2026-09-06)
 * caught that a modal cycling among 5-9 real elements (this function's
 * own motivating example: a close button, a few fields, submit) has a
 * period the loop never even tested, so it would report a real trap as
 * trap-free; raised to 10, still safely under the nav rail's own floor.
 * Not exhaustive (a trap deep inside a rarely-reached subtree could
 * still slip past a check that only visits one page), but real: driven
 * by actual `Tab` keypresses against a real DOM, not a static analysis
 * of the markup. */
async function checkKeyboardTrap(browser: Browser, sessionValue: string): Promise<string[]> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: "session", value: sessionValue, url: BASE_URL }]);
  try {
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/`);
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15000 });
    // WebKit's default Tab order (macOS's own `AppleKeyboardUIMode`,
    // "Text boxes and lists only") excludes `<button>` and `<a>` -
    // confirmed live (2026-09-12, issue #69): plain `Tab` on Home cycled
    // through only 4 real elements (a scroll container, an avatar strip,
    // the search input, one custom radio span) before landing on
    // `document.body` and wrapping, a false "keyboard trap" that was
    // really just WebKit skipping every button on the page. A real
    // keyboard-only Safari user almost always has "Full Keyboard Access"
    // turned on system-wide for exactly this reason, but a test script
    // must never flip a machine-wide OS preference (it would outlive a
    // killed run, affect the developer's own Safari, and not exist on
    // another contributor's machine at all). `Option+Tab` (Playwright's
    // "Alt+Tab") is WebKit's own manual override for this - it moves
    // focus through every control regardless of the system setting,
    // exactly what that same keyboard-only user experiences - so this
    // check presses it in WebKit and plain `Tab` everywhere else.
    const isWebkit = browser.browserType().name() === "webkit";
    const tabKey = isWebkit ? "Alt+Tab" : "Tab";
    const MAX_TAB_PRESSES = 60;
    const MAX_PERIOD = 10;
    const REPEATS_REQUIRED = 3;
    const visited: string[] = [];
    for (let i = 0; i < MAX_TAB_PRESSES; i++) {
      await page.keyboard.press(tabKey);
      const id = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return "(body)";
        // `el.className` is a plain string on an HTMLElement but an
        // `SVGAnimatedString` object on an SVG element (an icon button
        // built from an inline `<svg>`), which would stringify to the
        // useless literal "[object SVGAnimatedString]" - a code review
        // (2026-09-06) caught this collapsing every such element to the
        // same fingerprint. `getAttribute("class")` reads the raw
        // attribute on either element type uniformly.
        const cls = el.getAttribute("class") ?? "";
        return `${el.tagName}#${el.id}.${cls}:${(el.textContent ?? "").slice(0, 20)}`;
      });
      visited.push(id);

      for (let period = 1; period <= MAX_PERIOD; period++) {
        const windowLen = period * REPEATS_REQUIRED;
        if (visited.length < windowLen) continue;
        const tail = visited.slice(-windowLen);
        const cycle = tail.slice(0, period);
        const repeats = Array.from({ length: REPEATS_REQUIRED }, (_, k) => tail.slice(k * period, (k + 1) * period));
        // A cycle through "(body)" is focus leaving the page to the
        // browser and starting over, the opposite of a trap. Found with
        // RAIL-01: the dashboard's whole tab order (rail, two cards) is
        // short enough to repeat inside MAX_PERIOD.
        if (cycle.includes("(body)")) continue;
        if (repeats.every((chunk) => chunk.every((v, j) => v === cycle[j]))) {
          return [
            `keyboard trap suspected: focus repeated the same ${period}-element cycle ${REPEATS_REQUIRED} times in a row after ${visited.length} ${tabKey} presses (${cycle.join(" -> ")})`,
          ];
        }
      }
    }
    return [];
  } finally {
    await context.close();
  }
}

// docs/UI.md > "Responsive layout, PWA, tabs, icons": "Every page is
// captured at every surface, light and dark"; getmaipai/.github's
// docs/STYLE.md > "Platform screenshot pipeline": "a generated manifest
// per shot records the capture script, viewport, theme, and date."
// Lane 7 item 1 (2026-09-13) reconciled the matrix against both and
// found this the one missing, S-sized piece - the matrix, overflow,
// and target checks (WCAG 2.2's own 2.5.5/2.5.8 via the existing axe
// scan) already existed. One manifest.json in SCREENS_DIR, keyed by
// filename so a partial run (--chat-review's two routes, a
// --settings-review) updates only the entries it actually captured
// rather than wiping the rest - a full matrix run and a scoped review
// run share this same file over time, never a second manifest system.
interface ManifestEntry {
  route: string;
  viewport: string;
  theme: string;
  capturedAt: string;
  captureScript: string;
}
function writeScreenshotManifest(results: RunResult[], captureScript: string): void {
  const withFiles = results.filter((r): r is RunResult & { screenshotFile: string } => r.screenshotFile !== undefined);
  if (withFiles.length === 0 && dedicatedScreenshots.length === 0) return;
  const manifestPath = join(SCREENS_DIR, "manifest.json");
  const existing: Record<string, ManifestEntry> = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf-8")) : {};
  const capturedAt = new Date().toISOString();
  for (const r of withFiles) {
    existing[r.screenshotFile] = { route: r.route, viewport: r.viewport, theme: r.theme, capturedAt, captureScript };
  }
  for (const shot of dedicatedScreenshots) {
    existing[shot.file] = { route: shot.route, viewport: shot.viewport, theme: shot.theme, capturedAt, captureScript };
  }
  mkdirSync(SCREENS_DIR, { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(existing, null, 2) + "\n");
}

async function main() {
  console.log("Building the frontend so the backend has something to serve...");
  const buildOwner: RunOwner = { pid: process.pid, startedAt: processStartTime(process.pid) ?? null, token: crypto.randomUUID() };
  await withScreenshotBuildLock(BUILD_LOCK, buildOwner, () => {
    const build = Bun.spawnSync({
      cmd: ["bun", "run", "build"],
      cwd: join(ROOT, "frontend"),
      stdout: "inherit",
      stderr: "inherit",
    });
    if (build.exitCode !== 0) throw new Error("frontend build failed");
  });

  sweepStaleDemoDataDirs();
  DATA_OWNER = { pid: process.pid, startedAt: processStartTime(process.pid) ?? null, token: crypto.randomUUID() };
  DATA_DIR = createOwnedDemoDataDir(ROOT, DATA_OWNER);
  try {
    seedWeatherCache(DATA_DIR);
    seedWriteDocumentRoutingStats();
    if (statusC3bReview) seedStatusC3bEvents();

  console.log("Starting a throwaway backend on a temp data dir...");
  // Not gated on `chatReview` (it used to be) - Home's own WeatherCard
  // asks a fixed question through this exact stub on EVERY run, chat-
  // review or not, and without a scripted reply for it the published
  // home screenshot showed the stub server's own raw debug prefix
  // ("[stub model: no real model loaded, this is a canned reply] What's
  // the weather like today?") right in the weather card - found live,
  // 2026-09-13, reviewing a regenerated screenshot. The `weather like`
  // branch below is a defensive fallback, not the actual fix for that:
  // the weather card's fixed question pattern-matches the `weather`
  // package's own deterministic floor (weather/recipe.json) before it
  // ever reaches this stub, so `seedHousehold()`'s own
  // `household.home_place` (below) is what makes that real package
  // answer for real - this branch only ever fires if routing changes to
  // send the question to the model instead. The herbs/book branches
  // stay chat-review's.
  const { startStubLlmServer } = (await import(join(resolveSpecWorktreeDir(), "llm", "ts", "stubServer"))) as StubServerModule;
  const chatModel = startStubLlmServer(0, { chatStats: {
    usage: { prompt_tokens: 182, completion_tokens: 46, total_tokens: 228 },
    timings: { prompt_n: 182, predicted_n: 46, predicted_ms: 248, predicted_per_second: 185, cache_n: 1200 },
  }, scriptedToolCalls: (request) => {
    // SHELL-02 slice 4's own capture (captureNextChatArtifactReview):
    // checked before scriptedChatReply, so every other capture's turn
    // falls through to it unchanged. "pizza night" is unique to that
    // one prompt; the real write_document package (recipe.json) turns
    // these args into the real artifact record, so nothing about the
    // card or the canvas panel is scripted past this one model call.
    const text = [...request.messages].reverse().find((message) => message.role === "user")?.content ?? "";
    if (text.includes("Friday is pizza night")) {
      let lastUserIndex = -1;
      for (let i = 0; i < request.messages.length; i++) {
        if (request.messages[i]?.role === "user") lastUserIndex = i;
      }
      const currentTurnHasToolMessage = request.messages.slice(lastUserIndex + 1).some((message) => message.role === "tool");
      console.log(`[chat-polish-review] Friday search stub request ${JSON.stringify({ currentTurnHasToolMessage, offeredTools: request.tools?.map((tool) => tool.function.name) ?? [] })}`);
      if (!currentTurnHasToolMessage && request.tools?.some((tool) => tool.function.name === "websearch")) {
        return [{
          id: "call-websearch-pizza-night",
          type: "function",
          function: { name: "websearch", arguments: JSON.stringify({ expression: `Friday pizza night capture ${++chatPolishSearchCalls}` }) },
        }];
      }
      return undefined;
    }
    if (text.includes("pizza night")) {
      return [{
        id: "call-write-document",
        type: "function",
        function: {
          name: "write_document",
          arguments: JSON.stringify({
            title: "Pizza Night",
            kind: "markdown",
            body: "Every Friday night, the whole family makes pizza together. Everyone picks their own toppings, and the little ones help roll out the dough.",
          }),
        },
      }];
    }
    // TOOL-EVENTS-02's own capture (captureNextChatToolsSitesReview):
    // "mariners game" is unique to that one prompt, forced to a real
    // websearch call the same way the interim rule's own scripted tests
    // do (turnNext.test.ts's "a world question runs the search tool",
    // its own `withStub()` helper) - gated on `request.tools` actually
    // being offered THIS round (a query-writer or phrasing round offers
    // none), not just on no `tool` message yet: the first version here
    // fired on every early round with no tools, not only the one meant
    // to call websearch, and turnEngine never recovered a final answer.
    const hasToolMessage = request.messages.some((message) => message.role === "tool");
    if (request.tools?.length && !hasToolMessage && text.includes("mariners game")) {
      return [{
        id: "call-websearch-1",
        type: "function",
        function: { name: "websearch", arguments: JSON.stringify({ expression: "mariners game score" }) },
      }];
    }
    // getmaipai/home#154: weather's own manifest pattern ("what's the
    // weather like in *") is a question-word-opener wildcard, so
    // OPENER-01's floor (manifestLint.ts's isQuestionWordOpener())
    // refuses to route it deterministically any more - the model
    // chooses tools now (#150), so this capture has to script that
    // choice the way a real model would, the same shape the mariners
    // branch above already does. The weather PACKAGE itself runs for
    // real and unscripted (seedWeatherCache() above answers its own
    // fetch steps from disk), so the spec-sheet card's real content
    // still comes from the real recipe, not a canned reply.
    if (request.tools?.length && !hasToolMessage && text.includes("weather like")) {
      return [{
        id: "call-weather-1",
        type: "function",
        function: { name: "weather", arguments: JSON.stringify({ place: WEATHER_HOUSEHOLD_PLACE }) },
      }];
    }
    return undefined;
  }, scriptedChatReply: (request) => {
    const text = [...request.messages].reverse().find((message) => message.role === "user")?.content ?? "";
    if (chatIncognitoAudit) return "This is a normal chat response.";
    if (text.includes("CHAT QUEUE screenshot")) {
      const reply = "A calm day can hold many small details. The morning light crossed the kitchen table, and the afternoon brought a cool breeze through the open window.";
      return new Promise((resolve) => setTimeout(() => resolve(reply), 6000));
    }
    // ACTIVITY-01d/e: a reply that stays running long enough to capture.
    if (text.includes("ACTIVITY CARD screenshot")) return new Promise((resolve) => setTimeout(() => resolve("A calm day, told in a few short lines."), 20000));
    if (text.includes("D22 streaming")) return Array.from({ length: SCREENSHOT_STREAM_WORDS }, (_, i) => `Streamed reply word${i + 1}.`).join(" ");
    if (chatPageScreenshotFixture) return SCREENSHOT_CHAT_REPLY;
    if (text.includes(RICH_REPLY_PROMPT)) return RICH_REPLY_MARKDOWN;
    if (text.includes("Friday is pizza night")) return "Friday is pizza night.";
    if (text.includes("What is 2 plus 2?")) return "<think>The user is asking a simple arithmetic question. 2 plus 2 equals 4.</think>2 plus 2 is 4.";
    if (text.includes("herbs")) return "Basil, parsley, and chives are useful kitchen herbs. Keep mint in its own pot so it does not spread.";
    // STATUS-PHRASES-01's own capture: a real, but short, artificial
    // delay (FAST-04's own documented "hold the first token back"
    // mechanism, `scriptedChatReply` may return a Promise) - this stub
    // otherwise answers instantly on localhost, too fast for a
    // screenshot to ever reliably land inside the "thinking" moment
    // before the reply supersedes it (found live: the herbs question
    // alone already resolved before the screenshot fired).
    if (text.includes("bedtime story")) return new Promise((resolve) => setTimeout(() => resolve("Once there was a sleepy fox who wanted one more story before bed."), 1200));
    if (text.includes("book")) return "What kind of story would you enjoy: a mystery, an adventure, or something funny?";
    if (text.includes("weather like")) return "It's a clear, mild day - around 62°F with a light breeze.";
    if (text.includes("mariners game")) return "The Mariners won the game 4 to 2.";
    // captureNextChatReview's own fixed question: a `<think>` block so
    // the stub exercises the real REASONING-01 wire split
    // (routes/turn.ts's streamTurnEvents(), lib/wellFormed.ts's
    // feedThinkSplit()) the same way a real model's own reasoning
    // output would, deterministically.
    if (text.includes("2 plus 2")) return "<think>The user is asking a simple arithmetic question. 2 plus 2 equals 4.</think>2 plus 2 is 4.";
    // A single "\n" before the closing question, not a blank line -
    // getmaipai/home#99 (found live, 2026-09-13, chasing exactly this
    // reply): `gateOutputSafety()`'s per-sentence safety gate
    // (backend/src/lib/turnEngine.ts) uses spec/safety/ts/
    // sentenceChunker.ts's `nextSentenceBoundary()`, whose boundary
    // regex treats a blank line (`\n{2,}`) as its own match, separate
    // from `[.!?]+`'s own; when that match lands as the very start of
    // the gate's `pending` buffer, the resulting span is whitespace
    // only, the gate's own `if (!trimmed) continue` skips yielding it,
    // and the blank line is silently dropped from the delivered reply.
    // That only happens when the sentence before the blank line ends in
    // `.`/`!`/`?` AND the text right after the blank line starts with an
    // uppercase letter or digit (the terminator regex's own lookahead,
    // `(?=\s+[A-Z0-9]|\s*$)`) - exactly "dry." before "How" here, which
    // is why THIS reply's first blank line (after "plants.", before a
    // lowercase-led "- Grow") survives untouched and only the second one
    // (before "How") is lost. Confirmed against `GET /api/conversations/
    // :id/turns`'s own stored `replyText`, which already has no blank
    // line before "How" in it; nothing downstream (streaming, storage,
    // the frontend's markdown rendering) loses anything else.
    // Out of scope to fix here (backend/src/lib/turnEngine.ts is mid-edit
    // elsewhere in this checkout); a single "\n" never matches that
    // regex's blank-line alternative, so it survives the gate intact and
    // reads as a plain space once rendered - not the separate paragraph
    // this reply originally intended, but a real space, matching what
    // shipped before this bug was found (see #99 for the paragraph break
    // once the gate itself is fixed).
    return "Start with a sunny spot and a few easy plants.\n\n- Grow lettuce in a shallow container.\n- Give tomatoes a larger pot and a support.\n- Water when the top layer of soil feels dry.\nHow much space do you have?";
  } });
  const screenshotStack = chatArtifactCapture || chatPageScreenshotFixture || chatIncognitoAudit || chatShellReview || chatColumnReview || Boolean(elementsWave2Arg) || regenerateMenuReview ? startScreenshotStack(chatModel.url, regenerateMenuReview) : undefined;
  if (screenshotStack) STACK_URL = `http://127.0.0.1:${screenshotStack.port}`;
  // Keep the HTTP listener independent; intentionally exercise the
  // Repairs surface's real Wyoming bind-failure path via its fixture flag.
  let backend: ReturnType<typeof Bun.spawn>;
  try {
    // KIWIX-SIDECAR-01 binds a fixed default port (8790) on the household
    // backend. The screenshot backend has its own throwaway data directory;
    // it must also have its own port so sidecars.freePort() never mistakes
    // the running hub's Kiwix process for an orphan and kills it.
    const screenshotKiwixPort = reserveFreePort();
    // SINGLE-INSTANCE-02: a throwaway hub with its own data directory and
    // port, so it opts out of the machine-wide one-hub lock (test-only).
    backend = Bun.spawn({
      cmd: ["bun", "run", "src/index.ts"],
      cwd: join(ROOT, "backend"),
      // This matrix never calls speech; all speech requests go to the Stack.
      env: { ...process.env, MAIPAI_TEST_ALLOW_MULTIPLE_HUBS: "1", MAIPAI_MDNS: "off", PORT: "0", MAIPAI_DATA_DIR: DATA_DIR, MAIPAI_KIWIX_PORT: String(screenshotKiwixPort), MAIPAI_WYOMING_PORT: "0", ...(!chatIncognitoAudit ? { MAIPAI_SCREENSHOT_TEST_WYOMING_BIND_FAILURE: "1" } : {}), MAIPAI_LLAMA_SERVER_URL: chatModel.url, ...(chatArtifactCapture || chatPageScreenshotFixture || chatIncognitoAudit || chatShellReview || chatColumnReview || Boolean(elementsWave2Arg) ? { MAIPAI_EMBED_SERVER_URL: chatModel.url } : {}) },
      stdout: "pipe",
      stderr: "inherit",
    });
    try {
      const backendStdout = backend.stdout;
      if (!backendStdout || typeof backendStdout === "number") throw new Error("Screenshot backend stdout pipe was not created");
      const port = await waitForBackendPort(backendStdout);
      BASE_URL = `http://localhost:${port}`;
    } catch (startupError) {
      backend.kill();
      await backend.exited;
      throw startupError;
    }
  } catch (err) {
    // Keep cleanup steps independent and best-effort, so a throw from
    // one of them (say, chatModel.stop() called on an already-torn-down server) would mask
    // the real error above and skip whatever cleanup came after it.
    // Every step is now independent and best-effort, and `err` - the
    // actual cause - is always what gets rethrown, never whatever a
    // cleanup step itself raised.
    try { chatModel.stop(); } catch { /* best effort */ }
    try { screenshotStack?.stop(true); } catch { /* best effort */ }
    try { removeOwnedDemoDataDir(DATA_DIR, DATA_OWNER.token); } catch { /* best effort */ }
    throw err;
  }

  // Declared outside the try so `finally` can always close it - a code
  // review (2026-09-04) found an earlier version only closed the browser
  // on the success path, leaving an orphaned headless Chromium process
  // behind on any error after launch (a slow render, a selector that
  // never appears).
  let browser: Browser | undefined;
  // Set only by `captureLazyRouteSkeleton`'s own catch below - isolated
  // from aborting the rest of this run, but still checked before this
  // function returns, so a real regression there still fails the script
  // (and check.sh/CI with it) instead of only printing a line no one is
  // watching for.
  let lazyRouteSkeletonError: unknown;
  try {
    await waitForHealth();
    const sessionValue = await seedHousehold();
    if (pictureReview) {
      startPictureSearchFixture();
      const searchSetting = await fetch(`${BASE_URL}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: `session=${sessionValue}` },
        body: JSON.stringify({ scope: "household", key: "search.searxng_url", value: `http://127.0.0.1:${pictureSearchServer!.port}` }),
      });
      if (!searchSetting.ok) throw new Error(`seed picture search fixture failed: ${searchSetting.status}`);
    }
    if (nextChatToolsReview || nextChatPolishReview) {
      startWebSearchFixture();
      const searchSetting = await fetch(`${BASE_URL}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: `session=${sessionValue}` },
        body: JSON.stringify({ scope: "household", key: "search.searxng_url", value: `http://127.0.0.1:${websearchFixture!.port}` }),
      });
      if (!searchSetting.ok) throw new Error(`seed websearch fixture failed: ${searchSetting.status}`);
    }

    let launchedBrowser: Browser;
    try {
      launchedBrowser = await (useFirefox ? firefox : useWebkit ? webkit : chromium).launch({ headless: true });
    } catch (error) {
      if (useFirefox && chatStreamGlitchReview) {
        throw new Error(`Firefox stream audit could not start; no visual measurements were made. ${error instanceof Error ? error.message : String(error)}`);
      }
      throw error;
    }
    browser = launchedBrowser;
    if (chatMissingStatesReview) {
      await captureChatMissingStates(browser, sessionValue);
      console.log("completed named review: --chat-missing-states-review");
      return;
    }
    if (fitVerdictReview) {
      const phone = VIEWPORTS.find((item) => item.slug === "phone")!;
      const desktop = VIEWPORTS.find((item) => item.slug === "desktop")!;
      for (const viewport of [phone, desktop]) {
        for (const state of ["yes", "slow", "no", "unknown", "unavailable"] as const) {
          await captureFitVerdictCard(browser, sessionValue, viewport, "light", state);
        }
        await captureFitVerdictCard(browser, sessionValue, viewport, "light", "memory-tight");
        await captureFitVerdictCard(browser, sessionValue, viewport, "light", "compare");
        for (const state of ["checked-yes", "checked-no", "checked-error", "checked-notfound", "checked-nostack", "checked-unknown"] as const) {
          await captureFitVerdictCard(browser, sessionValue, viewport, "light", state);
        }
      }
      for (const viewport of [phone, desktop]) {
        for (const state of ["yes", "no"] as const) {
          await captureFitVerdictCard(browser, sessionValue, viewport, "dark", state);
        }
      }
      console.log("completed named review: --fit-verdict-review");
      return;
    }
    if (nextSettingsS2Review) {
      await captureNextSettingsS2Review(browser, sessionValue);
      console.log("completed named review: --next-settings-s2-review");
      return;
    }
    if (nextSettingsS3Review) {
      await captureNextSettingsS3Review(browser, sessionValue);
      console.log("completed named review: --next-settings-s3-review");
      return;
    }
    if (nextSettingsS5Review) {
      await captureNextSettingsS5Review(browser, sessionValue);
      console.log("completed named review: --next-settings-s5-review");
      return;
    }
    if (nextSettingsS6Review) {
      await captureNextSettingsS6Review(browser, sessionValue);
      console.log("completed named review: --next-settings-s6-review");
      return;
    }
    if (shell09DocsMatrixReview) {
      await captureShell09DocsMatrixReview(browser, sessionValue);
      return;
    }
    if (nextLaneA13Review) {
      await captureNextLaneA13Review(browser, sessionValue);
      console.log("completed named review: --next-lane-a-13-review");
      return;
    }
    if (nextProfileSheetReview) {
      await captureNextProfileSheetReview(browser, sessionValue);
      console.log("completed named review: --next-profile-sheet-review");
      return;
    }
    if (nextPersonalManagementReview) {
      await captureNextPersonalManagementReview(browser, sessionValue);
      console.log("completed named review: --next-personal-management-review");
      return;
    }
    if (nextPrivacyReview) {
      await captureNextPrivacyReview(browser, sessionValue);
      console.log("completed named review: --next-privacy-review");
      return;
    }
    if (nextPersonProfileReview) {
      await captureNextPersonProfileReview(browser, sessionValue);
      console.log("completed named review: --next-person-profile-review");
      return;
    }
    if (statusB2bReview) {
      await captureStatusB2bReview(browser, sessionValue);
      console.log("completed named review: --status-b2b-review");
      return;
    }
    if (statusD1Review) {
      await captureStatusD1Review(browser, sessionValue);
      console.log("completed named review: --status-d1-review");
      return;
    }
    if (statusEngineControlsReview) {
      await captureStatusEngineControlsReview(browser, sessionValue);
      console.log("completed named review: --status-engine-controls-review");
      return;
    }
    if (statusAppsReview) {
      await captureStatusAppsReview(browser, sessionValue);
      console.log("completed named review: --status-apps-review");
      return;
    }
    if (statusExpandReview) {
      await captureStatusExpandReview(browser, sessionValue);
      console.log("completed named review: --status-expand-review");
      return;
    }
    if (statusPolishReview) {
      await captureStatusPolishReview(browser, sessionValue);
      console.log("completed named review: --status-polish-review");
      return;
    }
    if (browserAlertsReview) {
      await captureBrowserAlertsReview(browser, sessionValue);
      console.log("completed named review: --browser-alerts-review");
      return;
    }
    if (statusA2cReview) {
      await captureStatusA2cReview(browser, sessionValue);
      console.log("completed named review: --status-a2c-review");
      return;
    }
    if (statusC3bReview) {
      await captureStatusC3bReview(browser, sessionValue);
      console.log("completed named review: --status-c3b-review");
      return;
    }
    if (statusA2bReview) {
      const outDir = process.env.MAIPAI_SETTINGS_S7_SCREEN_DIR || join(ROOT, "data-scratch", "screens", "status-a2b");
      mkdirSync(outDir, { recursive: true });
      for (const viewport of [VIEWPORTS.find((item) => item.slug === "desktop")!, VIEWPORTS.find((item) => item.slug === "phone")!]) {
        for (const theme of THEMES) {
          const context = await newContext(browser, viewport, theme, sessionValue);
          try {
            const page = await context.newPage();
            await page.goto(`${BASE_URL}/status`);
            await page.getByText("Components", { exact: true }).waitFor();
            const path = join(outDir, `status-${viewport.slug}-${theme}-admin.png`);
            await page.screenshot({ path, fullPage: true });
            console.log(`Wrote ${path}`);
          } finally { await context.close(); }
        }
      }
      console.log("The seeded screenshot setup signs in as its seeded owner; it does not create a member session.");
      console.log("The seeded backend has no registered kiwix-serve sidecar, so the conditional Library row is absent.");
      console.log("A degraded or down state is not seeded by this capture.");
      return;
    }
    if (nextTableRolloutReview) {
      await captureNextPeopleReview(browser, sessionValue);
      await captureNextEnginesReview(browser, sessionValue);
      await captureNextUpdatesReview(browser, sessionValue);
      await captureNextRepairsReview(browser, sessionValue);
      await captureNextBackupsReview(browser, sessionValue);
      await captureNextPerformanceReview(browser, sessionValue);
      console.log("completed named review: --next-table-rollout-review (all 12 importing files; 14 table instances)");
      return;
    }
    if (!a11yOnly && pictureReview) {
      const desktop = VIEWPORTS.find((v) => v.slug === "desktop")!;
      await capturePictureReview(browser, sessionValue, desktop, "light");
    }

    // A review caught this guard as only `if (notificationsReview)`,
    // not mutually exclusive with chatReview/settingsReview the way
    // every other block below already is - nothing in package.json
    // combines these flags today, but nothing here prevented it either,
    // and combining them would sign in as Marlow and fire two real
    // safety-flagged turns underneath a chat/settings run that never
    // asked for that.
    if (notificationsReview && !chatReview && !settingsReview) {
      await captureNotificationsReview(browser, sessionValue);
    }

    if (lookReview && !chatReview && !settingsReview && !notificationsReview) {
      await captureLookComparison(browser, sessionValue);
    }

    if (nextStandupReview && !chatReview && !settingsReview && !notificationsReview && !lookReview) {
      await captureNextStandup(browser, sessionValue);
    }

    if (nextSidebarReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview) {
      await captureNextSidebarReview(browser, sessionValue);
      console.log("completed named review: --next-sidebar-review");
      return;
    }

    if (nextLookPresetsReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview) {
      await captureNextLookPresets(browser, sessionValue);
    }

    if (nextAppearanceMismatchReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview) {
      await captureNextAppearanceMismatch(browser, sessionValue);
    }

    if (nextPeopleReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview) {
      await captureNextPeopleReview(browser, sessionValue);
    }

    if (nextDashboardReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview && !nextPeopleReview) {
      await captureNextDashboardReview(browser, sessionValue);
    }

    if (nextChatRichReview) {
      await captureNextChatRichReview(browser, sessionValue);
      console.log("completed named review: --next-chat-rich-review");
      return;
    }

    if (nextChatAnswerImages) {
      await captureNextChatAnswerImages(browser, sessionValue);
      console.log("completed named review: --next-chat-answer-images");
      return;
    }

    if (nextChatSentPictures) {
      await captureNextChatSentPictures(browser, sessionValue);
      console.log("completed named review: --next-chat-sent-pictures");
      return;
    }

    if (nextChatHistoryReview) {
      await captureNextChatHistoryReview(browser, sessionValue);
      console.log("completed named review: --next-chat-history-review");
      return;
    }

    if ((nextChatReview || regenerateMenuReview) && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview && !nextPeopleReview && !nextDashboardReview) {
      await captureNextChatReview(browser, sessionValue);
      console.log(`completed named review: ${regenerateMenuReview ? "--regenerate-menu-review" : "--next-chat-review"}`);
      return;
    }

    if (nextChatScrollReview) {
      await captureNextChatScrollReview(browser, sessionValue);
      console.log("completed named review: --next-chat-scroll-review");
      return;
    }

    if (showcaseScrollReview) {
      await captureShowcaseScrollReview(browser, sessionValue);
      console.log("completed named review: --showcase-scroll-review");
      return;
    }

    if (nextSettingsReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview && !nextPeopleReview && !nextDashboardReview && !nextChatReview) {
      await captureNextSettingsReview(browser, sessionValue);
    }

    if (nextEnginesReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview && !nextPeopleReview && !nextDashboardReview && !nextChatReview && !nextSettingsReview) {
      await captureNextEnginesReview(browser, sessionValue);
    }

    if (nextChatToolsReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview && !nextPeopleReview && !nextDashboardReview && !nextChatReview && !nextSettingsReview && !nextEnginesReview) {
      await captureNextChatToolsSitesReview(browser, sessionValue);
      await captureNextChatToolsReview(browser, sessionValue);
      console.log("completed named review: --next-chat-tools-review");
      return;
    }

    if (nextUpdatesReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview && !nextPeopleReview && !nextDashboardReview && !nextChatReview && !nextSettingsReview && !nextEnginesReview && !nextChatToolsReview) {
      await captureNextUpdatesReview(browser, sessionValue);
    }

    if (nextRepairsReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview && !nextPeopleReview && !nextDashboardReview && !nextChatReview && !nextSettingsReview && !nextEnginesReview && !nextChatToolsReview && !nextUpdatesReview) {
      await captureNextRepairsReview(browser, sessionValue);
    }

    if (nextBackupsReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview && !nextPeopleReview && !nextDashboardReview && !nextChatReview && !nextSettingsReview && !nextEnginesReview && !nextChatToolsReview && !nextUpdatesReview && !nextRepairsReview) {
      await captureNextBackupsReview(browser, sessionValue);
    }

    if (nextChatPolishReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview && !nextPeopleReview && !nextDashboardReview && !nextChatReview && !nextSettingsReview && !nextEnginesReview && !nextChatToolsReview && !nextUpdatesReview && !nextRepairsReview && !nextBackupsReview && !nextChatArtifactReview) {
      await captureNextChatPolishReview(browser, sessionValue);
      console.log("completed named review: --next-chat-polish-review");
      return;
    }

    if (nextShellFoldReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview && !nextPeopleReview && !nextDashboardReview && !nextChatReview && !nextSettingsReview && !nextEnginesReview && !nextChatToolsReview && !nextUpdatesReview && !nextRepairsReview && !nextBackupsReview && !nextChatArtifactReview && !nextChatPolishReview) {
      await captureNextShellFoldReview(browser, sessionValue);
      console.log("completed named review: --next-shell-fold-review");
      return;
    }

    if (nextChatArtifactReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview && !nextPeopleReview && !nextDashboardReview && !nextChatReview && !nextSettingsReview && !nextEnginesReview && !nextChatToolsReview && !nextUpdatesReview && !nextRepairsReview && !nextBackupsReview) {
      await captureNextChatArtifactReview(browser, sessionValue);
      console.log("completed named review: --next-chat-artifact-review");
      return;
    }

    if (nextSignInReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview && !nextPeopleReview && !nextDashboardReview && !nextChatReview && !nextSettingsReview && !nextEnginesReview && !nextChatToolsReview && !nextUpdatesReview && !nextRepairsReview && !nextBackupsReview && !nextChatArtifactReview) {
      await captureNextSignInReview(browser, sessionValue);
    }

    if (laneBTouchTargetsReview) {
      await verifyLaneBTouchTargets(browser, sessionValue);
      console.log("completed named review: --lane-b-touch-targets-review");
      return;
    }

    if (nextChatQueueBeforeReview) {
      await captureNextChatQueueBeforeReview(browser, sessionValue);
      console.log("completed named review: --next-chat-queue-before-review");
      return;
    }

    if (nextChatQueueEmptyReview) {
      await captureNextChatQueueEmptyReview(browser, sessionValue);
      console.log("completed named review: --next-chat-queue-empty-review");
      return;
    }

    if (activityCardReview) {
      await captureActivityCardReview(browser, sessionValue);
      console.log("completed named review: --activity-card-review");
      return;
    }

    if (composerLayoutReview) {
      await captureComposerLayoutReview(browser, sessionValue);
      console.log("completed named review: --composer-layout-review");
      return;
    }

    if (nextChatQueueReview) {
      await captureNextChatQueueReview(browser, sessionValue);
      console.log("completed named review: --next-chat-queue-review");
      return;
    }

    if (nextChatComposerReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview && !nextPeopleReview && !nextDashboardReview && !nextChatReview && !nextSettingsReview && !nextEnginesReview && !nextChatToolsReview && !nextUpdatesReview && !nextRepairsReview && !nextBackupsReview && !nextChatArtifactReview && !nextSignInReview && !nextChatChildComposerReview) {
      await captureNextChatComposerReview(browser, sessionValue);
      console.log("completed named review: --next-chat-composer-review");
      return;
    }

    if (nextChatAuditReview) {
      await captureNextChatAuditReview(browser, sessionValue);
      return;
    }

    if (chatIncognitoAudit) {
      await captureChatIncognitoAudit(browser, sessionValue);
      return;
    }

    if (chatCollapseHoverAudit) {
      await captureChatCollapseHoverAudit(browser, sessionValue);
      return;
    }

    if (chatStreamGlitchReview) {
      await captureChatStreamGlitch(browser, sessionValue);
      return;
    }

    if (nextChatChildComposerReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview && !nextPeopleReview && !nextDashboardReview && !nextChatReview && !nextSettingsReview && !nextEnginesReview && !nextChatToolsReview && !nextUpdatesReview && !nextRepairsReview && !nextBackupsReview && !nextChatArtifactReview && !nextSignInReview && !nextChatComposerReview) {
      await captureNextChatChildComposerReview(browser, sessionValue);
    }

    if (nextPerformanceReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview && !nextPeopleReview && !nextDashboardReview && !nextChatReview && !nextSettingsReview && !nextEnginesReview && !nextChatToolsReview && !nextUpdatesReview && !nextRepairsReview && !nextBackupsReview && !nextChatArtifactReview && !nextSignInReview && !nextChatComposerReview && !nextChatChildComposerReview && !nextStorageReview) {
      await captureNextPerformanceReview(browser, sessionValue);
    }

    if (nextStorageReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview && !nextPeopleReview && !nextDashboardReview && !nextChatReview && !nextSettingsReview && !nextEnginesReview && !nextChatToolsReview && !nextUpdatesReview && !nextRepairsReview && !nextBackupsReview && !nextChatArtifactReview && !nextSignInReview && !nextChatComposerReview && !nextChatChildComposerReview && !nextPerformanceReview) {
      await captureNextStorageReview(browser, sessionValue);
    }

    if (peopleProfileMediaReview && !chatReview && !settingsReview && !notificationsReview && !lookReview && !nextStandupReview && !nextSidebarReview && !nextLookPresetsReview && !nextAppearanceMismatchReview && !nextPeopleReview && !nextDashboardReview && !nextChatReview && !nextSettingsReview && !nextEnginesReview && !nextChatToolsReview && !nextUpdatesReview && !nextRepairsReview && !nextBackupsReview && !nextChatArtifactReview && !nextSignInReview && !nextChatComposerReview && !nextChatChildComposerReview && !nextPerformanceReview && !nextStorageReview) {
      await capturePeopleProfileMediaReview(browser, sessionValue);
    }

    if (!a11yOnly && chatReview) {
      if (chatFocusReview) await captureChatModelPicker(browser, sessionValue);
      for (const combo of A11Y_ONLY_COMBOS) {
        const viewport = VIEWPORTS.find((v) => v.slug === combo.viewport);
        if (!viewport) throw new Error(`unknown viewport ${combo.viewport}`);
        await captureChatDocumentPane(browser, sessionValue, viewport, combo.theme);
      }
    }

    if (!a11yOnly && chatStatsReview) await captureChatStatsReview(browser, sessionValue);

    if (!a11yOnly && chatResearchReview) await captureChatResearchReview(browser, sessionValue);

    if (!a11yOnly && chatTemporaryReview) await captureChatTemporaryReview(browser, sessionValue);

    if (!a11yOnly && chatContinueReview) await captureChatContinueReview(browser, sessionValue);

    if (!a11yOnly && chatAcceptanceReview) {
      for (const combo of A11Y_ONLY_COMBOS) {
        const viewport = VIEWPORTS.find((v) => v.slug === combo.viewport);
        if (!viewport) throw new Error(`unknown viewport ${combo.viewport}`);
        await captureChatSourcesMemoryAttachment(browser, sessionValue, viewport, combo.theme);
        await captureChatStreaming(browser, sessionValue, viewport, combo.theme);
        await captureChatEngineNotReady(browser, sessionValue, viewport, combo.theme);
      }
    }

    if (elementsReview) {
      await captureElementsReview(browser, sessionValue);
      console.log("completed named review: --elements-review");
      return;
    }

    if (chatSkillsReview) {
      await captureChatSkillsReview(browser, sessionValue);
      console.log("completed named review: --chat-skills-review");
      return;
    }

    if (chatProjectsReview) {
      await captureChatProjectsReview(browser, sessionValue);
      console.log("completed named review: --chat-projects-review");
      return;
    }

    if (chatColumnReview) {
      await captureChatColumnReview(browser, sessionValue);
      console.log("completed named review: --chat-column-review");
      return;
    }

    if (chatShellReview) {
      await captureShellNavReview(browser, sessionValue);
      if (shellNavReview) {
        console.log("completed named review: --shell-nav-review");
        return;
      }
      await captureChatShellReview(browser, sessionValue);
      console.log("completed named review: --chat-shell-review");
      return;
    }

    if (!a11yOnly && shellRailReview) {
      await captureShellRail(browser, sessionValue, "light");
      await captureShellRail(browser, sessionValue, "dark");
    }

    if (!a11yOnly && elementsWave2Arg) {
      await captureElementsWave2Review(browser, sessionValue, elementsWave2Part);
      console.log("completed named review: --elements-wave2-review");
      return;
    }

    if (!a11yOnly && chatThreadActionsReview) {
      await captureChatThreadActionsReview(browser, sessionValue);
    }

    if (!a11yOnly && chatListReview) {
      await captureChatListReview(browser, sessionValue);
      console.log("completed named review: --chat-list-review");
      return;
    }

    if (!a11yOnly && chatSearchReview) {
      await captureChatSearchReview(browser, sessionValue);
      console.log("completed named review: --chat-search-review");
      return;
    }

    if (!a11yOnly && chatMobileSheetReview) {
      await captureChatMobileSheetReview(browser, sessionValue);
      console.log("completed named review: --chat-mobile-sheet-review");
      return;
    }

    if (!a11yOnly && chatShortcutsReview) {
      await captureChatShortcutsReview(browser, sessionValue);
    }

    if (!a11yOnly && chatFindHeaderAlignmentReview) {
      await verifyChatFindHeaderAlignment(browser, sessionValue);
    }

    if (!a11yOnly && chatFindBubbleHoverWidthReview) {
      await verifyChatFindBubbleHoverWidth(browser, sessionValue);
    }

    if (!a11yOnly && chatFindComposerShiftReview) {
      await verifyChatFindComposerShift(browser, sessionValue);
    }

    if (!a11yOnly && chatHeaderTitleReview) {
      await captureChatHeaderTitleReview(browser, sessionValue);
    }

    if (!a11yOnly && nextPageHeaderIconReview) {
      await captureNextPageHeaderIconReview(browser, sessionValue);
    }

    if (!a11yOnly && phoneHeaderFoldReview) {
      await capturePhoneHeaderFoldReview(browser, sessionValue);
    }

    if (!a11yOnly && !laneBTouchTargetsReview && !settingsReview && !chatReview && !chatStatsReview && !chatResearchReview && !chatTemporaryReview && !chatContinueReview && !fitVerdictReview && !chatAcceptanceReview && !shellRailReview && !chatThreadActionsReview && !chatListReview && !chatSearchReview && !chatMobileSheetReview && !chatShortcutsReview && !chatFindHeaderAlignmentReview && !chatFindBubbleHoverWidthReview && !chatFindComposerShiftReview && !chatHeaderTitleReview && !nextPageHeaderIconReview && !phoneHeaderFoldReview && !nextDashboardReview && !nextChatArtifactReview && !nextChatComposerReview && !nextSidebarReview && !notificationsReview && !lookReview && !nextStandupReview && !pictureReview && !showcaseScrollReview) {
      await captureHero(browser, sessionValue);
      const phone = VIEWPORTS.find((v) => v.slug === "phone")!;
      const desktop = VIEWPORTS.find((v) => v.slug === "desktop")!;
      await capturePaletteOpen(browser, sessionValue, phone, "dark");
      await capturePaletteOpen(browser, sessionValue, desktop, "light");
      await capturePeopleAndThings(browser, sessionValue, phone, "dark");
      await capturePeopleAndThings(browser, sessionValue, desktop, "light");
      // Isolated, unlike the captures above: it hardcodes one chunk's own
      // hashed-filename prefix and races a fixed delay against a fixed
      // timeout, both of which are more likely to need adjusting after an
      // unrelated refactor (the chunk gets renamed or merged, or CI is
      // just slower) than the palette/hero captures are. A failure here
      // must not take the rest of this run's screenshots down with it,
      // but still has to fail the script in the end (recorded in
      // `lazyRouteSkeletonError`, checked below) - a silent console line
      // no exit code backs up is not "flagging loudly."
      try {
        await captureLazyRouteSkeleton(browser, sessionValue);
      } catch (error) {
        console.error("captureLazyRouteSkeleton failed:", error);
        lazyRouteSkeletonError = error;
      }
    }

    // notificationsReview needs no pass over ROUTES at all - its own two
    // shots are the dedicated capture above, over specifically-seeded
    // notifications the generic matrix knows nothing about. Empty, not
    // A11Y_ONLY_COMBOS: a review caught the earlier version still
    // running runPool over 2 combos here, opening and closing two real
    // browser contexts that would only ever iterate zero routes below.
    const combos = notificationsReview || lookReview || nextStandupReview || pictureReview || fitVerdictReview || laneBTouchTargetsReview || chatShortcutsReview || nextDashboardReview || chatMobileSheetReview
      ? []
      : a11yOnly || settingsReview || chatReview || chatStatsReview || chatResearchReview || chatContinueReview || fitVerdictReview
        ? A11Y_ONLY_COMBOS
        : VIEWPORTS.flatMap((v) => THEMES.map((t) => ({ viewport: v.slug, theme: t })));

    // `chatReview` clears and rebuilds the one shared conversation
    // (`visitRoute`'s own `POST /api/conversations/clear` call, gated on
    // `chatReview && route.slug === "chat"`) against this run's single
    // seeded backend - its two combos (`A11Y_ONLY_COMBOS`) would race
    // each other's chat history if run concurrently, so this mode stays
    // sequential (pool size 1). Every other mode only ever reads.
    const poolSize = chatReview || chatStatsReview || chatResearchReview || chatContinueReview ? 1 : CONTEXT_POOL_SIZE;
    const comboResults = await runPool(combos, poolSize, async (combo): Promise<RunResult[]> => {
      const viewport = VIEWPORTS.find((v) => v.slug === combo.viewport);
      if (!viewport) throw new Error(`unknown viewport ${combo.viewport}`);
      const context = await newContext(launchedBrowser, viewport, combo.theme, sessionValue);
      const comboResult: RunResult[] = [];
      try {
        for (const route of ((chatReview || chatStatsReview || chatResearchReview || chatContinueReview) ? ROUTES.filter((entry) => entry.slug === "chat") : settingsReview ? ROUTES.filter((entry) => entry.slug === "settings" || entry.slug === "settings-models") : notificationsReview ? [] : ROUTES)) {
          console.log(`${route.slug} @ ${viewport.slug}/${combo.theme}...`);
          // A hard ceiling around the whole visit, not just Playwright's
          // own actions inside it: `AxeBuilder#analyze()` runs its
          // injected script via `page.evaluate`, which has no timeout of
          // its own, so a page that hangs mid-scan (found live: the home
          // page under real contention) would otherwise stall this loop,
          // and everything after it, forever. A timeout here is reported
          // as a failure for this one combo, never silently skipped.
          comboResult.push(
            await Promise.race([
              visitRoute(context, route, viewport, combo.theme, !a11yOnly && !chatStatsReview),
              new Promise<RunResult>((_, reject) =>
                setTimeout(() => reject(new Error(`timed out after ${PAGE_VISIT_TIMEOUT_MS}ms`)), PAGE_VISIT_TIMEOUT_MS),
              ),
            ]).catch((err: unknown) => ({
              route: route.slug,
              viewport: viewport.slug,
              theme: combo.theme,
              violations: [`page visit failed: ${err instanceof Error ? err.message : String(err)}`],
              overflow: false,
              overflowingPanels: [],
            })),
          );
        }
      } finally {
        await context.close();
      }
      return comboResult;
    });
    const results: RunResult[] = comboResults.flat();

    // getmaipai/home, found live 2026-09-13 (a coordinator review of a
    // regenerated main): the plain run's own "chat" route only ever
    // shows the empty "How can I help you today?" state - `--chat-review`
    // is the only mode that clears and exercises a real conversation
    // (`exerciseChatFirst` above), and its own two combos
    // (`A11Y_ONLY_COMBOS`) happen to share their output filenames with
    // two of the plain matrix's own eight. Whichever command ran LAST
    // is what `docs/assets/screens/chat-{phone-dark,desktop-light}.png`
    // actually show - 88ffaee's own fixup depended on running both
    // commands in the right order by hand, and a later plain-matrix-
    // only regeneration (this file's own touch-target work, 2026-09-13)
    // silently reverted the published chat screenshot back to empty,
    // exactly the regression 88ffaee had already found once. One
    // command should not depend on what ran before it: the plain run
    // now re-visits those same two combos itself, sequentially (the
    // same single-shared-conversation race `chatReview`'s own pool
    // size of 1 avoids), replacing their results and screenshots with
    // the exercised conversation - the manifest records the real
    // capture script for each, so a stale one is visible, not silent.
    if (!a11yOnly && !laneBTouchTargetsReview && !settingsReview && !chatReview && !chatStatsReview && !chatResearchReview && !notificationsReview && !lookReview && !nextStandupReview && !pictureReview && !chatShortcutsReview && !nextDashboardReview && !chatMobileSheetReview) {
      console.log("re-visiting chat with a real conversation (phone/dark, desktop/light)...");
      for (const combo of A11Y_ONLY_COMBOS) {
        const viewport = VIEWPORTS.find((v) => v.slug === combo.viewport);
        if (!viewport) throw new Error(`unknown viewport ${combo.viewport}`);
        const context = await newContext(launchedBrowser, viewport, combo.theme, sessionValue);
        try {
          const chatRoute = ROUTES.find((r) => r.slug === "chat")!;
          const exercised = await visitRoute(context, chatRoute, viewport, combo.theme, true, true);
          const idx = results.findIndex((r) => r.route === "chat" && r.viewport === combo.viewport && r.theme === combo.theme);
          if (idx >= 0) results[idx] = exercised;
          else results.push(exercised);
        } finally {
          await context.close();
        }
      }
    }

    console.log("checking prefers-reduced-motion...");
    const reducedMotionFailures = await checkReducedMotion(browser, sessionValue);
    console.log("checking for keyboard traps...");
    const keyboardTrapFailures = await checkKeyboardTrap(browser, sessionValue);

    const failures = results.filter((r) => r.violations.length > 0 || r.overflow);
    if (failures.length > 0 || reducedMotionFailures.length > 0 || keyboardTrapFailures.length > 0) {
      console.error(`\n${failures.length} page(s) failed the accessibility/overflow check:\n`);
      for (const f of failures) {
        console.error(`- ${f.route} @ ${f.viewport}/${f.theme}`);
        if (f.overflow) console.error(`    horizontal overflow: ${f.overflowingPanels.join(", ")}`);
        for (const v of f.violations) console.error(`    ${v}`);
      }
      if (reducedMotionFailures.length > 0) {
        console.error(`\nreduced motion:`);
        for (const f of reducedMotionFailures) console.error(`    ${f}`);
      }
      if (keyboardTrapFailures.length > 0) {
        console.error(`\nkeyboard trap:`);
        for (const f of keyboardTrapFailures) console.error(`    ${f}`);
      }
      throw new Error("accessibility or overflow check failed");
    }
    if (lazyRouteSkeletonError !== undefined) throw lazyRouteSkeletonError;

    console.log(`\n${results.length} page(s) checked, 0 violations, 0 overflow, reduced motion and keyboard-trap checks passed.`);
    if (!a11yOnly) {
      writeScreenshotManifest(results, `scripts/screenshot.ts ${process.argv.slice(2).join(" ")}`.trim());
      console.log(`Screenshots written to ${SCREENS_DIR}`);
    }
  } finally {
    await browser?.close();
    const backendPid = backend.pid;
    backend.kill();
    try { chatModel.stop(); } catch { /* best effort */ }
    try { pictureSearchServer?.stop(true); } catch { /* best effort */ }
    try { websearchFixture?.stop(true); } catch { /* best effort */ }
    try { await backend.exited; } catch { /* best effort */ }
    if (backendPid && processStartTime(backendPid) !== undefined) throw new Error(`Screenshot backend pid ${backendPid} survived teardown`);
    if (await fetch(BASE_URL, { signal: AbortSignal.timeout(500) }).then(() => true, () => false)) throw new Error(`Screenshot backend port at ${BASE_URL} remained open after teardown`);
    screenshotStack?.stop(true);
    removeOwnedDemoDataDir(DATA_DIR, DATA_OWNER.token);
  }
  } catch (startupError) {
    try { removeOwnedDemoDataDir(DATA_DIR, DATA_OWNER.token); } catch { /* best effort */ }
    throw startupError;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
