import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createQueryClient } from "@/lib/queryClient";
import { api } from "@/lib/api";
import { i18n, activateLocale } from "@/i18n";
import { chooseLocale, usePersonLocale } from "./usePersonLocale";

afterEach(async () => { cleanup(); await activateLocale("en-US"); });

describe("chooseLocale", () => {
  test("person value, the household sentinel, the household, then en-US", () => {
    expect(chooseLocale("es", "en-GB")).toBe("es");
    expect(chooseLocale("household", "en-GB")).toBe("en-GB");
    expect(chooseLocale(undefined, "es")).toBe("es");
    expect(chooseLocale(undefined, undefined)).toBe("en-US");
  });
});

describe("usePersonLocale", () => {
  let values: { person: string; household: string };
  beforeEach(() => {
    values = { person: "es", household: "en-GB" };
    spyOn(api, "locale").mockImplementation(async () => ({ locale: "en-GB" }));
    spyOn(api, "settingsValues").mockImplementation((async (scope: string) => scope === "household"
      ? [{ key: "household.locale", value: values.household }]
      : [{ key: "person.locale", value: values.person }]) as never);
  });

  const wrap = (client = createQueryClient()) => ({ client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });

  test("signed out shows the household language", async () => {
    const { wrapper } = wrap();
    renderHook(() => usePersonLocale(null), { wrapper });
    await waitFor(() => expect(i18n.locale).toBe("en-GB"));
  });

  test("signed in activates the person's own language and re-activates on a change without a reload", async () => {
    const { client, wrapper } = wrap();
    renderHook(() => usePersonLocale({ id: "p1" }), { wrapper });
    await waitFor(() => expect(i18n.locale).toBe("es"));
    expect(i18n._("Search")).toBe("Buscar");
    act(() => { client.setQueryData(["settings-values", "person:p1"], [{ key: "person.locale", value: "household" }]); });
    await waitFor(() => expect(i18n.locale).toBe("en-GB"));
    act(() => { client.setQueryData(["settings-values", "household"], [{ key: "household.locale", value: "en-US" }]); });
    await waitFor(() => expect(i18n.locale).toBe("en-US"));
  });

  test("a failed settings read keeps English", async () => {
    (api.settingsValues as unknown as ReturnType<typeof spyOn>).mockImplementation(async () => { throw new Error("offline"); });
    const { wrapper } = wrap();
    renderHook(() => usePersonLocale({ id: "p1" }), { wrapper });
    await waitFor(() => expect(i18n.locale).toBe("en-US"));
  });

  test("returns false while who is signed in is unknown, true once the first language is active", async () => {
    const { wrapper } = wrap();
    const { result, rerender } = renderHook(({ person }: { person: { id: string } | null | undefined }) => usePersonLocale(person), { wrapper, initialProps: { person: undefined as { id: string } | null | undefined } });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(result.current).toBe(false);
    expect(i18n.locale).toBe("en-US");
    rerender({ person: null });
    await waitFor(() => expect(result.current).toBe(true));
    expect(i18n.locale).toBe("en-GB");
  });

  test("a newer choice wins even when an older language's catalog is slower", async () => {
    const { wrapper } = wrap();
    // The household answers es slowly; the person's own setting (en-GB) is read after it and must be the one left active.
    (api.locale as unknown as ReturnType<typeof spyOn>).mockImplementation(async () => ({ locale: "es" }));
    values = { person: "en-GB", household: "es" };
    const { rerender } = renderHook(({ person }: { person: { id: string } | null }) => usePersonLocale(person), { wrapper, initialProps: { person: null as { id: string } | null } });
    rerender({ person: { id: "p1" } });
    await waitFor(() => expect(i18n.locale).toBe("en-GB"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
    expect(i18n.locale).toBe("en-GB");
  });
});
