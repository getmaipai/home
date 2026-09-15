import { describe, expect, test } from "bun:test";
import { StatusChannel } from "@/lib/statusChannel";

describe("StatusChannel", () => {
  const event = { type: "status", text: "Checking that for you.", stage: "lookup" } as const;
  test("emit before next", async () => { const channel = new StatusChannel(); channel.emit(event); expect(await channel.next()).toEqual(event); });
  test("next before emit", async () => { const channel = new StatusChannel(); const pending = channel.next(); channel.emit(event); expect(await pending).toEqual(event); });
  test("close drains then nulls", async () => { const channel = new StatusChannel(); channel.emit(event); channel.close(); expect(await channel.next()).toEqual(event); expect(await channel.next()).toBeNull(); });
});
