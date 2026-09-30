import { writeFileSync } from "node:fs";

const markerPath = process.argv[2]!;
// These mirror the module signal hooks: synchronous cleanup runs first,
// then the hub's signal hook must be allowed to finish async shutdown.
const registerModuleExitHook = (): void => {
  process.on("exit", () => {});
  process.on("SIGINT", () => {});
  process.on("SIGTERM", () => {});
};
registerModuleExitHook();
registerModuleExitHook();
const shutdownEngines = async (stops: Array<() => void | Promise<void>>): Promise<void> => {
  for (const stop of stops) await stop();
};
process.on("SIGTERM", () => {
  void (async () => {
    await shutdownEngines([
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        writeFileSync(markerPath, "stopped");
      },
    ]);
    process.exit(0);
  })();
});

console.log("ready");
setInterval(() => {}, 60_000);
