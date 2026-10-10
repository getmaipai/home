import { describe, expect, test, afterEach } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { AliasRedirect } from "@/shell/AliasRedirect";

afterEach(cleanup);

function CurrentUrl() {
  const { pathname, search, hash } = useLocation();
  return <output>{`${pathname}${search}${hash}`}</output>;
}

function landing(entry: string, path: string) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path={path} element={<AliasRedirect />} />
        <Route path="/*" element={<CurrentUrl />} />
      </Routes>
    </MemoryRouter>,
  );
  return document.querySelector("output")?.textContent;
}

describe("AliasRedirect", () => {
  test("maps an old nested settings bookmark to the flat route, keeping query and hash", () => {
    expect(landing("/settings/backups?tab=household#history", "/settings/backups")).toBe("/backups?tab=household#history");
  });

  test("keeps the Conversations bookmark pointed at Chat with its list open", () => {
    expect(landing("/conversations?filter=recent", "/conversations")).toBe("/chat?filter=recent&list=1");
  });

  test("a trailing slash on an alias still lands on the current route instead of redirecting to itself", () => {
    expect(landing("/settings/backups/?tab=household", "/settings/backups")).toBe("/backups?tab=household");
  });

  test("a trailing slash on the Conversations bookmark still opens Chat with its list", () => {
    expect(landing("/conversations/", "/conversations")).toBe("/chat?list=1");
  });
});
