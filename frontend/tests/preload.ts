// Registers a real DOM (happy-dom) for `bun test`, the same shape
// backend/tests/preload.ts uses for its own test-only setup. Needed for
// @testing-library/react component tests (kit/settings/SettingField.test.tsx):
// bun's default test environment has no `document`/`window` at all.
import "./runTemp";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { plugin } from "bun";
import { afterEach, expect, mock } from "bun:test";
import * as matchers from "@testing-library/jest-dom/matchers";

// happy-dom's own ReadableStream/WritableStream/TransformStream are
// incomplete (no real `getReader()`-backed piping) - fine for
// @testing-library/react's DOM needs, but a real streaming library
// (assistant-stream, step 4's chatThreadListAdapter.ts) built against
// the actual web-streams spec breaks the moment GlobalRegistrator
// replaces these globals with happy-dom's versions. Captured before
// registration and restored right after: Bun's own native
// implementations, not happy-dom's, for every test in the suite.
const nativeStreams = {
  ReadableStream: globalThis.ReadableStream,
  WritableStream: globalThis.WritableStream,
  TransformStream: globalThis.TransformStream,
  // pipeTo({signal}) in the native streams (assistant-stream's decoder uses
  // it) rejects happy-dom's AbortSignal, so the pair stays native too.
  AbortController: globalThis.AbortController,
  AbortSignal: globalThis.AbortSignal,
};

GlobalRegistrator.register();
Object.assign(globalThis, nativeStreams);

expect.extend(matchers);

// Image imports in the kit (`import user1 from "./user-1.png"`) resolve to
// the file's path, the way the Vite build does. Bun's own default does the
// same, except that once its transpiler cache is warm a single-file run of a
// test that reaches one of them (ChatPage.test.tsx) parses the PNG's
// bytes as JavaScript and dies at import ("Unexpected", user-1.png:1:1).
// Registering the loader here means the answer no longer depends on what
// the cache happens to hold (FLAKE-195).
plugin({
  name: "image-assets",
  setup(build) {
    build.onLoad({ filter: /\.(png|jpe?g|gif|webp|avif|svg)$/ }, (args) => ({
      contents: `export default ${JSON.stringify(args.path)};`,
      loader: "js",
    }));
  },
});

// getmaipai/home#218: one bun process runs every test file of a shard, so a
// component a test left mounted keeps polling and fetching, and those requests
// land on the next file's global fetch mock (EnginesPage.test.tsx counted 4
// calls it never made). After every test the rendered tree is unmounted.
// Imported here, after the DOM above exists, because the library reads
// `document` when it loads (a static import would be hoisted above the DOM).
const { cleanup } = await import("@testing-library/react");
// One bun process runs every file of a shard, so a test that stubs a timer
// global and restores only some of them breaks every later timer test
// (micStream.test.ts restored setTimeout but not clearTimeout, and the gate
// shard failed 5 timer tests in other files; one file alone passed). The
// natives are captured here; any test that leaves one replaced is failed by
// name, and the global is put back so the damage stops with that test.
const nativeTimers = {
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
};
afterEach(() => {
  cleanup();
  const leaked = (Object.keys(nativeTimers) as (keyof typeof nativeTimers)[]).filter((k) => globalThis[k] !== nativeTimers[k]);
  for (const k of leaked) (globalThis as Record<string, unknown>)[k] = nativeTimers[k];
  if (leaked.length > 0) throw new Error(`This test left ${leaked.join(", ")} replaced. Restore the real ${leaked.length > 1 ? "ones" : "one"} in afterEach (or call jest.useRealTimers()) so later test files get working timers.`);
});

// MEDIA-POLISH-01: the kit Player now draws on Home's media pages in tests (the watch page, the docked mini bar). Media Chrome's
// custom elements build CSS happy-dom cannot parse, so the run swaps them for the kit's own stub, as the kit's test run does
// (@maipai/ui tests/mediaChromeStub.tsx). Media Chrome's drawing is checked in a real browser.
const { mediaChromeStub } = await import("@maipai/ui/tests/mediaChromeStub");
mock.module("media-chrome/react", () => mediaChromeStub);
