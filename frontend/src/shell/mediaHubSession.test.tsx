// MEDIA-HUB-06: the tab remembers it came in through Media. A media app page shows the flag only while the person's path
// still leads back to the hub: "/media" sets it, a media app page honors it, and any other path clears it.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { enterMediaHub, useMediaHubActive } from "@/shell/mediaHubSession";

beforeEach(() => { sessionStorage.clear(); });
afterEach(() => { cleanup(); });

function Flag() { return <p data-testid="flag">{String(useMediaHubActive())}</p>; }
function GoTo({ to }: { to: string }) {
  const navigate = useNavigate();
  return <button data-testid="go" onClick={() => navigate(to)}>go</button>;
}

function renderAt(pathname: string, extra: ReactNode = null) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route path="*" element={<><Flag />{extra}</>} />
      </Routes>
    </MemoryRouter>,
  );
}

test("a media app page shows no flag unless the person came in through Media", () => {
  const view = renderAt("/apps/music");
  expect(view.getByTestId("flag").textContent).toBe("false");
});

test("the Media home is active and records the flag", async () => {
  const view = renderAt("/media");
  await waitFor(() => expect(view.getByTestId("flag").textContent).toBe("true"));
  expect(sessionStorage.getItem("maipai.media-hub")).toBe("1");
});

test("Media search is active and records the flag", async () => {
  const view = renderAt("/media/search?q=moon");
  await waitFor(() => expect(view.getByTestId("flag").textContent).toBe("true"));
  expect(sessionStorage.getItem("maipai.media-hub")).toBe("1");
});

test("after the Media home, a media app page still shows the flag", async () => {
  const view = renderAt("/media", <GoTo to="/apps/music" />);
  await waitFor(() => expect(view.getByTestId("flag").textContent).toBe("true"));
  fireEvent.click(view.getByTestId("go"));
  await waitFor(() => expect(view.getByTestId("flag").textContent).toBe("true"));
  expect(sessionStorage.getItem("maipai.media-hub")).toBe("1");
});

test("any other path is not active and clears the flag", async () => {
  sessionStorage.setItem("maipai.media-hub", "1");
  const view = renderAt("/chat");
  await waitFor(() => expect(view.getByTestId("flag").textContent).toBe("false"));
  expect(sessionStorage.getItem("maipai.media-hub")).toBeNull();
});

test("a non-media app page is not active", () => {
  sessionStorage.setItem("maipai.media-hub", "1");
  const view = renderAt("/apps/weather");
  expect(view.getByTestId("flag").textContent).toBe("false");
});

test("enterMediaHub marks the tab so its media app pages show the flag", () => {
  enterMediaHub();
  const view = renderAt("/apps/videos");
  expect(view.getByTestId("flag").textContent).toBe("true");
});
