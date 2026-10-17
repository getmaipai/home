import { expect, test } from "bun:test";
import type { PersonRow } from "@/types";
import { offlineProvider, registerOfflineProvider, type OfflineProvider } from "../src/lib/offline/registry";

test("offline providers dispatch by kind and pass the actor, entry and request unchanged", async () => {
  const actor = { id: "person-atlas" } as PersonRow;
  const request = new Request("https://example.com/api/offline/file/fixture/nova", { headers: { Range: "bytes=1-2" } });
  const calls: unknown[][] = [];
  const provider: OfflineProvider = {
    kind: "fixture",
    refuse: () => null,
    manifest(person, id) { calls.push([person, id]); return null; },
    file(person, entry, req) { calls.push([person, entry, req]); return new Response("nova"); },
  };
  registerOfflineProvider(provider);
  expect(offlineProvider("fixture")).toBe(provider);
  expect(await offlineProvider("fixture")!.manifest(actor, "nova")).toBeNull();
  expect(await (await offlineProvider("fixture")!.file(actor, "nova", request)).text()).toBe("nova");
  expect(calls).toEqual([[actor, "nova"], [actor, "nova", request]]);
  expect(offlineProvider("unregistered")).toBeUndefined();
  expect(() => registerOfflineProvider(provider)).toThrow("already registered");
  expect(() => registerOfflineProvider({ ...provider, kind: "../fixture" })).toThrow("invalid");
  expect(() => registerOfflineProvider({ ...provider, kind: "norefuse", refuse: undefined } as unknown as OfflineProvider)).toThrow("refuse check");
});
