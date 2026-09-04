// bun:test has no built-in jest-dom matcher types; @testing-library/jest-dom
// ships this exact augmentation at node_modules/@testing-library/jest-dom/
// types/bun.d.ts but doesn't expose it through package.json's "exports" map,
// so it isn't resolvable by path - this is the same augmentation, copied.
import type { expect } from "bun:test";
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

export {};
declare module "bun:test" {
  interface Matchers<T = unknown>
    extends TestingLibraryMatchers<ReturnType<typeof expect.stringContaining>, T> {}
}
