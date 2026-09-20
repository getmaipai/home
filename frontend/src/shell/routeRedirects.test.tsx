import { describe, expect, test, afterEach } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { MemoriesRedirect } from "@/shell/MemoriesRedirect";

afterEach(cleanup);

function Location() {
  return <div data-testid="location">{useLocation().pathname + useLocation().search}</div>;
}

// Owner ruling, "Navigation, corrected," 2026-09-20: three destinations
// left the rail, each replaced by a redirect so nothing bookmarked
// breaks. These mirror App.tsx's own route table exactly (the same
// path patterns and elements), not a re-implementation - App.tsx's
// `MemoriesRedirect` is imported directly; `/conversations`'s own
// target is a bare literal `<Navigate>`, reproduced verbatim below so a
// typo in that string is a real, caught regression.
describe("route redirects", () => {
  test("/conversations redirects to Chat with its list open", () => {
    render(
      <MemoryRouter initialEntries={["/conversations"]}>
        <Location />
        <Routes>
          <Route path="/conversations" element={<Navigate to="/chat?list=1" replace />} />
          <Route path="/chat" element={<div>Chat</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(document.querySelector('[data-testid="location"]')?.textContent).toBe("/chat?list=1");
  });

  test("/memory redirects to the signed-in person's own Memories tab", () => {
    render(
      <MemoryRouter initialEntries={["/memory"]}>
        <Location />
        <Routes>
          <Route path="/memory" element={<MemoriesRedirect selfId="person-sage" />} />
          <Route path="/people/:id" element={<div>Profile</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(document.querySelector('[data-testid="location"]')?.textContent).toBe("/people/person-sage?tab=memories");
  });

  test("/memories (the other spelling) redirects the same way", () => {
    render(
      <MemoryRouter initialEntries={["/memories"]}>
        <Location />
        <Routes>
          <Route path="/memories" element={<MemoriesRedirect selfId="person-sage" />} />
          <Route path="/people/:id" element={<div>Profile</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(document.querySelector('[data-testid="location"]')?.textContent).toBe("/people/person-sage?tab=memories");
  });

  // Chat's "memory updated" chip and the header search's memory results
  // both deep-link with `?ids=<memory ids>` - the redirect has to carry
  // that through, or the deep link breaks the moment it passes through
  // the old `/memory` URL.
  test("/memory?ids=... carries the ids param through to the new URL", () => {
    render(
      <MemoryRouter initialEntries={["/memory?ids=mem-1,mem-2"]}>
        <Location />
        <Routes>
          <Route path="/memory" element={<MemoriesRedirect selfId="person-sage" />} />
          <Route path="/people/:id" element={<div>Profile</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(document.querySelector('[data-testid="location"]')?.textContent).toBe("/people/person-sage?tab=memories&ids=mem-1,mem-2");
  });
});
