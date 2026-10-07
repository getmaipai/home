import { describe, expect, test, afterEach } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { LegacyShellRedirect } from "@/shell/LegacyShellRedirect";

afterEach(cleanup);

function CurrentUrl() {
  const { pathname, search, hash } = useLocation();
  return <output>{`${pathname}${search}${hash}`}</output>;
}

describe("LegacyShellRedirect", () => {
  test("moves preview-era routes to the root while preserving query and hash", () => {
    render(
      <MemoryRouter initialEntries={["/next/chat?conversation=conv-1#latest"]}>
        <Routes>
          <Route path="/next/*" element={<LegacyShellRedirect />} />
          <Route path="/*" element={<CurrentUrl />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(document.querySelector("output")?.textContent).toBe("/chat?conversation=conv-1#latest");
  });

  test("moves the preview dashboard URL to the root", () => {
    render(
      <MemoryRouter initialEntries={["/next"]}>
        <Routes>
          <Route path="/next/*" element={<LegacyShellRedirect />} />
          <Route path="/*" element={<CurrentUrl />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(document.querySelector("output")?.textContent).toBe("/");
  });

  test("maps old nested settings bookmarks to the migrated flat route", () => {
    render(
      <MemoryRouter initialEntries={["/settings/backups?tab=household#history"]}>
        <Routes>
          <Route path="/settings/*" element={<LegacyShellRedirect />} />
          <Route path="/*" element={<CurrentUrl />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(document.querySelector("output")?.textContent).toBe("/backups?tab=household#history");
  });

  test("keeps the Conversations bookmark pointed at Chat with its list open", () => {
    render(
      <MemoryRouter initialEntries={["/conversations?filter=recent"]}>
        <Routes>
          <Route path="/conversations" element={<LegacyShellRedirect />} />
          <Route path="/*" element={<CurrentUrl />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(document.querySelector("output")?.textContent).toBe("/chat?filter=recent&list=1");
  });
});
