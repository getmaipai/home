import { afterEach, expect, spyOn, test } from "bun:test";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { usePlaceAdapter } from "@/shell/pages/settings/placeAdapter";
import { api } from "@/lib/api";

afterEach(cleanup);

const rows = [
  { id: "ent-mine", kind: "place", name: "Cabin", scope: "person" },
  { id: "ent-home", kind: "place", name: "Home", scope: "household" },
];

function setup(scope: "household" | "person", incognito = false) {
  const entities = spyOn(api, "entities").mockResolvedValue(rows as never);
  const del = spyOn(api, "deleteEntity").mockResolvedValue({ id: "x" });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => usePlaceAdapter(scope, { incognito }), { wrapper });
  return { hook, entities, del };
}

test("removing a person's own saved place deletes the record", async () => {
  const { hook, entities, del } = setup("person");
  try {
    await waitFor(() => expect(hook.result.current.labelFor("ent-mine")).toBe("Cabin"));
    expect(await hook.result.current.remove!("ent-mine")).toBe(true);
    expect(del).toHaveBeenCalledWith("ent-mine");
  } finally { entities.mockRestore(); del.mockRestore(); }
});

test("the household home is never deleted from a person's list, and Incognito deletes nothing", async () => {
  const a = setup("person");
  try {
    await waitFor(() => expect(a.hook.result.current.labelFor("ent-home")).toBe("Home"));
    expect(await a.hook.result.current.remove!("ent-home")).toBe(false);
    expect(a.del).not.toHaveBeenCalled();
  } finally { a.entities.mockRestore(); a.del.mockRestore(); cleanup(); }
  const b = setup("person", true);
  try {
    await waitFor(() => expect(b.hook.result.current.labelFor("ent-mine")).toBe("Cabin"));
    expect(await b.hook.result.current.remove!("ent-mine")).toBe(false);
    expect(b.del).not.toHaveBeenCalled();
  } finally { b.entities.mockRestore(); b.del.mockRestore(); }
});
