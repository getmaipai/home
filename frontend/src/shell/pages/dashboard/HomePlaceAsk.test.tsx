import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { HomePlaceAsk } from "./HomePlaceAsk";

afterEach(() => cleanup());
const view = (role: string) => {
  const person = { id: "p", display_name: "Sam", role } as never;
  const out = render(<QueryClientProvider client={new QueryClient()}><HomePlaceAsk person={person} /></QueryClientProvider>);
  return { ...out, screen: out };
};

test("an owner with no home sees the use-my-location button and the typed field", async () => {
  api.settingsValues = mock(async () => []) as never;
  const { screen } = view("owner");
  await waitFor(() => expect(screen.getByText("Use my location")).toBeTruthy());
  expect(screen.getByLabelText("Your city")).toBeTruthy();
});

test("a teen is told to ask a grown-up and gets no field", async () => {
  api.settingsValues = mock(async () => []) as never;
  const { screen } = view("teen");
  await waitFor(() => expect(screen.getByText(/Ask a grown-up to set the home location/)).toBeTruthy());
  expect(screen.queryByText("Use my location")).toBeNull();
});

test("nothing shows once the household home is set", async () => {
  api.settingsValues = mock(async () => [{ key: "household.home", value: "ent-1" }]) as never;
  const { container } = view("owner");
  await waitFor(() => expect((api.settingsValues as never as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThan(0));
  expect(container.querySelector("[data-testid=home-place-card]")).toBeNull();
});
