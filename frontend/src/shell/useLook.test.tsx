// The selected theme stays on the page when the screen unmounts, so a blank or crashed screen is never drawn in the kit's generic default.
import { afterEach, describe, expect, test } from "bun:test";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useLook } from "@/shell/useLook";
import { writeShellCache } from "@/shell/shellCache";

afterEach(() => { document.body.className = ""; });

describe("useLook", () => {
  test("keeps the style class on the page after the screen unmounts", () => {
    writeShellCache({ look: "neutral", dark: true });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { unmount } = renderHook(() => useLook("person-1"), { wrapper });
    const before = [...document.body.classList].filter((name) => name.startsWith("style-"));
    expect(before.length).toBe(1);
    unmount();
    expect([...document.body.classList].filter((name) => name.startsWith("style-"))).toEqual(before);
  });
});
