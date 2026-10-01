// #73: the hub's one shutdown path (lib/hubShutdown.ts).
import { describe, expect, test, afterEach } from "bun:test";
import { shutdownEngines, __resetHubShutdownForTests } from "@/lib/hubShutdown";

afterEach(() => __resetHubShutdownForTests());

describe("hub shutdown", () => {
  test("stops chat, embed, and background engines once, in order, and a second call joins the first", async () => {
    const stopped: string[] = [];
    const stops = ["chat", "embed", "background"].map((name) => async () => {
      stopped.push(name);
    });
    await Promise.all([shutdownEngines(stops), shutdownEngines(stops)]);
    await shutdownEngines(stops);
    expect(stopped).toEqual(["chat", "embed", "background"]);
  });

  test("a stop that throws is logged and the next engines still stop; the promise never rejects", async () => {
    const stopped: string[] = [];
    const stops = [
      async () => {
        throw new Error("chat stop exploded");
      },
      async () => {
        stopped.push("embed");
      },
      async () => {
        stopped.push("background");
      },
    ];
    await expect(shutdownEngines(stops)).resolves.toBeUndefined();
    expect(stopped).toEqual(["embed", "background"]);
  });

  test("a stop that never resolves cannot hold the process past the deadline", async () => {
    const started = Date.now();
    await shutdownEngines([() => new Promise<void>(() => undefined)], 50);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
