import { describe, expect, test } from "bun:test";
import { isRootStillResolving, shouldRedirectRootToNext, signOutDestination } from "./oldShellRedirect";

// SHELL-FLAG-01: the three redirects, both ways (flag on and off),
// isolated from App.tsx's own React tree - App.tsx also imports
// @/i18n, which pulls in a .po file bun's test runtime has no loader
// for, so this is the real logic under test, not a reimplementation
// of it for testing's sake.
describe("shouldRedirectRootToNext", () => {
  test('"/" redirects once the flag is on', () => {
    expect(shouldRedirectRootToNext("/", "on")).toBe(true);
  });
  test('"/" does not redirect while the flag is off', () => {
    expect(shouldRedirectRootToNext("/", "off")).toBe(false);
  });
  test('"/" does not redirect while the flag is still loading', () => {
    expect(shouldRedirectRootToNext("/", "loading")).toBe(false);
  });
  test("no other old-shell path redirects, flag on or off", () => {
    expect(shouldRedirectRootToNext("/chat", "on")).toBe(false);
    expect(shouldRedirectRootToNext("/settings", "on")).toBe(false);
  });
});

describe("isRootStillResolving", () => {
  test('"/" waits on a skeleton while the flag is loading', () => {
    expect(isRootStillResolving("/", "loading")).toBe(true);
  });
  test('"/" does not wait once the flag has resolved either way', () => {
    expect(isRootStillResolving("/", "on")).toBe(false);
    expect(isRootStillResolving("/", "off")).toBe(false);
  });
  test("no other old-shell path waits on the flag at all", () => {
    expect(isRootStillResolving("/chat", "loading")).toBe(false);
  });
});

describe("signOutDestination", () => {
  test("lands on /next/sign-in once the flag is on", () => {
    expect(signOutDestination("on")).toBe("/next/sign-in");
  });
  test("stays in place (null - the old shell's own inline sign-in takes over) with the flag off", () => {
    expect(signOutDestination("off")).toBeNull();
  });
  test("stays in place while the flag is still loading, same as off", () => {
    expect(signOutDestination("loading")).toBeNull();
  });
});
