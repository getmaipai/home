import { afterEach, expect, test, mock, spyOn } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { APP_CATALOG } from "@/shell/appCatalog";
import { AmbientPageContextProvider, ambientPageContextForRoute, useAmbientPageContext, useSetPageContext } from "@/shell/pageContext";

function ContextView() {
  const context = useAmbientPageContext();
  return <output data-testid="context">{JSON.stringify(context)}</output>;
}

function EnrichedPage({ title = "Record title" }: { title?: string }) {
  useSetPageContext({ record_kind: "photo", record_id: "photo-17", title });
  return <ContextView />;
}

afterEach(() => { cleanup(); mock.restore(); localStorage.clear(); });

test("shell defaults use the matching app catalog route and pathname", () => {
  expect(ambientPageContextForRoute("/chat", APP_CATALOG)).toEqual({ app_id: "chat", route: "/chat" });
  expect(ambientPageContextForRoute("/settings/chat", APP_CATALOG)).toEqual({ app_id: "settings", route: "/settings/chat" });
});

test("page enrichment merges over the shell default and is removed when its app unmounts", () => {
  const view = render(<AmbientPageContextProvider base={{ app_id: "library", route: "/files/photo-17" }}><EnrichedPage /></AmbientPageContextProvider>);
  expect(view.getByTestId("context").textContent).toBe(JSON.stringify({ app_id: "library", route: "/files/photo-17", record_kind: "photo", record_id: "photo-17", title: "Record title" }));
  view.rerender(<AmbientPageContextProvider base={{ app_id: "library", route: "/files/photo-17" }}><ContextView /></AmbientPageContextProvider>);
  expect(view.getByTestId("context").textContent).toBe(JSON.stringify({ app_id: "library", route: "/files/photo-17" }));
});

test("page route and title are never logged or stored", () => {
  const logs = [spyOn(console, "debug"), spyOn(console, "info"), spyOn(console, "log"), spyOn(console, "warn"), spyOn(console, "error")];
  for (const log of logs) log.mockImplementation(() => undefined);
  render(<AmbientPageContextProvider base={{ app_id: "settings", route: "/settings/secret" }}><EnrichedPage title="Private title" /></AmbientPageContextProvider>);
  for (const log of logs) expect(log).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(0);
});
