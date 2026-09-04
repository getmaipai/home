// Registers a real DOM (happy-dom) for `bun test`, the same shape
// backend/tests/preload.ts uses for its own test-only setup. Needed for
// @testing-library/react component tests (kit/settings/SettingField.test.tsx):
// bun's default test environment has no `document`/`window` at all.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { expect } from "bun:test";
import * as matchers from "@testing-library/jest-dom/matchers";

GlobalRegistrator.register();
expect.extend(matchers);
