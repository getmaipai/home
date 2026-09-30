// Registers a real DOM (happy-dom) for `bun test`, the same shape
// backend/tests/preload.ts uses for its own test-only setup. Needed for
// @testing-library/react component tests (kit/settings/SettingField.test.tsx):
// bun's default test environment has no `document`/`window` at all.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { plugin } from "bun";
import { expect } from "bun:test";
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
};

GlobalRegistrator.register();
Object.assign(globalThis, nativeStreams);

expect.extend(matchers);

// Image imports in the kit (`import user1 from "./user-1.png"`) resolve to
// the file's path, the way the Vite build does. Bun's own default does the
// same, except that once its transpiler cache is warm a single-file run of a
// test that reaches one of them (NextChatPage.test.tsx) parses the PNG's
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
