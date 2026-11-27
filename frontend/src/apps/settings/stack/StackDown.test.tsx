import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { withStackDown } from "./StackDown";
import type { SettingsViewProps } from "@/shell/pages/settings/settingsViews";

const realFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = realFetch; });

const Page = () => <p>the real page</p>;
const props = { person: { role: "owner" } } as unknown as SettingsViewProps;
const mount = (answer: unknown) => {
  globalThis.fetch = (async () => new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } })) as never;
  const Guarded = withStackDown(Page);
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Guarded {...props} /></QueryClientProvider>);
};

describe("Stack tabs when the Stack is down", () => {
  test("shows the one down card with the Stack's sentence and a Check now step, not the page", async () => {
    const view = mount({ where: "this_computer", reachable: false, version: null, problems: null, reason: "The Stack is stopped." });
    await waitFor(() => expect(view.getByTestId("stack-down")).toBeTruthy());
    expect(view.getByText("The Stack is not answering")).toBeTruthy();
    expect(view.getByText("The Stack is stopped.")).toBeTruthy();
    expect(view.getByRole("button", { name: "Check now" })).toBeTruthy();
    expect(view.queryByText("the real page")).toBeNull();
  });
  test("draws the page when the Stack answers", async () => {
    const view = mount({ where: "this_computer", reachable: true, version: "1", problems: 0, reason: null });
    await waitFor(() => expect(view.getByText("the real page")).toBeTruthy());
  });
});

describe("status cards draw their state icon (no blank circle)", () => {
  test("the down card's lead circle holds an icon", async () => {
    const view = mount({ where: "this_computer", reachable: false, version: null, problems: null, reason: "The Stack is stopped." });
    await waitFor(() => expect(view.getByTestId("stack-down")).toBeTruthy());
    const card = view.getByRole("alert");
    expect(card.querySelector("svg")).not.toBeNull();
  });
});
